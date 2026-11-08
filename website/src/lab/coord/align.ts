// Temporal alignment of repetitions: phase-aware landmark registration (default), plain linear time
// normalisation, and dynamic time warping (for comparison and alignment-sensitivity analysis).
//
//   landmark  piecewise-linear time warp: onset → 0 %, endpoint arrival → 45 %, departure → 55 %, offset → 100 %
//             (Ramsay & Silverman 2005, ch. 7 "landmark registration"). Removes phase-timing differences of the
//             landmarks while keeping within-phase shape — intersegment delays remain visible.
//             The task-angle MAXIMUM is deliberately not a landmark: on a flat endpoint plateau its position is set by
//             noise, which made registration bimodal and produced spurious "strategies" (validation run 1,
//             research/mcse-validation.md §3). Arrival/departure are velocity-defined and stable.
//   linear    onset → 0 %, offset → 100 % (removes duration only).
//   dtw       Sakoe & Chiba 1978 dynamic programming, squared-Euclidean local cost, symmetric step pattern,
//             Sakoe–Chiba band; returns √(accumulated cost) like tslearn.metrics.dtw (benchmarked).
//
// What normalisation removes is kept separately: every repetition retains its phase durations and its original
// time-domain samples, so no temporal information is silently discarded.

import type { ChannelId, ChannelSet } from './channels';
import type { Repetition } from './segment';

export const GRID = 101;
export type AlignMethod = 'landmark' | 'linear';

export interface AlignedRep {
  /** Per channel: GRID samples of (channel − value at onset), degrees. */
  curves: Partial<Record<ChannelId, number[]>>;
  /** Per channel: value at onset (posture before the movement). */
  start: Partial<Record<ChannelId, number>>;
  /** Original time-domain samples onset − 0.3 s … offset + 0.3 s (seconds relative to onset). */
  timeDomain: { t: number[]; values: Partial<Record<ChannelId, number[]>> };
  /** Outbound = onset → arrival, return = departure → offset, total = onset → offset (seconds). */
  durations: { outbound: number; return: number; total: number };
  /** Channels that could not be aligned (missing samples inside the repetition). */
  invalid: ChannelId[];
}

function sampleAt(x: readonly number[], fi: number): number {
  const i = Math.floor(fi);
  const f = fi - i;
  const a = x[i] as number;
  if (f < 1e-9) return a;
  const b = x[i + 1] as number;
  return a + f * (b - a);
}

/** Normalised positions of the landmarks onset, arrival, departure, offset. */
export const LANDMARKS = [0, 0.45, 0.55, 1] as const;

/** Map a normalised position u ∈ [0, 1] to a fractional sample index through the landmarks. */
function warp(u: number, marks: readonly [number, number, number, number], method: AlignMethod): number {
  const iOn = marks[0];
  const iOff = marks[3];
  if (method === 'linear') return iOn + u * (iOff - iOn);
  for (let s = 0; s < 3; s++) {
    const a = LANDMARKS[s] as number;
    const b = LANDMARKS[s + 1] as number;
    if (u <= b || s === 2) return (marks[s] as number) + ((u - a) / (b - a)) * ((marks[s + 1] as number) - (marks[s] as number));
  }
  return iOff;
}

export function alignRep(cs: ChannelSet, r: Repetition, channels: readonly ChannelId[], method: AlignMethod = 'landmark'): AlignedRep | null {
  if (!r.onset || !r.offset || !r.arrival || !r.departure) return null;
  const iOn = r.onset.i;
  const iOff = r.offset.i;
  const iArr = r.arrival.i;
  const iDep = Math.max(r.departure.i, iArr);
  if (!(iOn < iArr && iDep < iOff)) return null;
  const marks: [number, number, number, number] = [iOn, iArr, iDep, iOff];
  const curves: AlignedRep['curves'] = {};
  const start: AlignedRep['start'] = {};
  const invalid: ChannelId[] = [];
  const rate = cs.meta.rateHz;
  const pad = Math.round(0.3 * rate);
  const a0 = Math.max(0, iOn - pad);
  const a1 = Math.min(cs.t.length - 1, iOff + pad);
  const td: AlignedRep['timeDomain'] = { t: [], values: {} };
  for (let i = a0; i <= a1; i++) td.t.push((cs.t[i] as number) - (cs.t[iOn] as number));
  for (const c of channels) {
    const x = cs.channels[c];
    if (!x) {
      invalid.push(c);
      continue;
    }
    td.values[c] = x.slice(a0, a1 + 1);
    let ok = true;
    for (let i = iOn; i <= iOff; i++) if (!Number.isFinite(x[i] as number)) ok = false;
    if (!ok) {
      invalid.push(c);
      continue;
    }
    const x0 = x[iOn] as number;
    start[c] = x0;
    curves[c] = Array.from({ length: GRID }, (_, k) => sampleAt(x, warp(k / (GRID - 1), marks, method)) - x0);
  }
  return {
    curves,
    start,
    timeDomain: td,
    durations: { outbound: (cs.t[iArr] as number) - (cs.t[iOn] as number), return: (cs.t[iOff] as number) - (cs.t[iDep] as number), total: (cs.t[iOff] as number) - (cs.t[iOn] as number) },
    invalid,
  };
}

/** Concatenate the channel curves into one feature vector (channel-major). */
export function featureVector(a: AlignedRep, channels: readonly ChannelId[]): number[] | null {
  const out: number[] = [];
  for (const c of channels) {
    const v = a.curves[c];
    if (!v) return null;
    out.push(...v);
  }
  return out;
}

export interface DtwResult {
  /** √ of the accumulated squared-Euclidean cost along the optimal path (tslearn convention). */
  distance: number;
  path: [number, number][];
}

/**
 * Multivariate DTW. a: n × d, b: m × d. band: Sakoe–Chiba radius in samples (Infinity = unconstrained).
 * Implemented here (≈ 40 lines) rather than imported: no maintained JavaScript DTW package was found with tests
 * (research/software-dependency-decisions.md); agreement with tslearn 0.10.0 is checked in the benchmark.
 */
export function dtw(a: readonly (readonly number[])[], b: readonly (readonly number[])[], band = Infinity): DtwResult {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return { distance: NaN, path: [] };
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  (D[0] as Float64Array)[0] = 0;
  // band defined on the diagonal of the (possibly non-square) matrix
  const slope = m / n;
  for (let i = 1; i <= n; i++) {
    const c = i * slope;
    const jLo = Math.max(1, Math.floor(c - band));
    const jHi = Math.min(m, Math.ceil(c + band));
    const ai = a[i - 1] as readonly number[];
    for (let j = jLo; j <= jHi; j++) {
      const bj = b[j - 1] as readonly number[];
      let cost = 0;
      for (let k = 0; k < ai.length; k++) cost += ((ai[k] as number) - (bj[k] as number)) ** 2;
      const prev = Math.min((D[i - 1] as Float64Array)[j] as number, (D[i] as Float64Array)[j - 1] as number, (D[i - 1] as Float64Array)[j - 1] as number);
      (D[i] as Float64Array)[j] = cost + prev;
    }
  }
  const total = (D[n] as Float64Array)[m] as number;
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const d = (D[i - 1] as Float64Array)[j - 1] as number;
    const u = (D[i - 1] as Float64Array)[j] as number;
    const l = (D[i] as Float64Array)[j - 1] as number;
    if (d <= u && d <= l) {
      i--;
      j--;
    } else if (u <= l) i--;
    else j--;
  }
  path.reverse();
  return { distance: Math.sqrt(total), path };
}

/** Curves of a repetition as GRID × channels rows (for DTW). */
export function asRows(a: AlignedRep, channels: readonly ChannelId[]): number[][] {
  return Array.from({ length: GRID }, (_, k) => channels.map((c) => (a.curves[c] as number[])[k] as number));
}
