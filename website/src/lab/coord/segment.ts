// Repetition and movement-phase segmentation with explicit boundary uncertainty.
//
// Two independent layers, fused:
//  1. Coarse repetition windows on the TASK angle with the existing hysteresis detector (core/reps.ts countReps):
//     the same definition of "a repetition" as the clinical test, thresholds from the step's own amplitude.
//  2. Phase boundaries inside each window from the angular VELOCITY of the task angle (zero-phase 6 Hz low-pass):
//       rest → onset → acceleration → (peak outbound velocity) → deceleration → endpoint arrival
//       → endpoint hold → departure → return → offset → rest
//     Onset / arrival / departure / offset are threshold crossings at a fraction θ of the phase's own peak speed
//     (θ = 5 %, the convention of Balasubramanian et al. 2015 used by lab/events.ts). The SAME boundary is also
//     located with θ = 3 % and 10 %, and onset additionally by a least-squares single change point in the mean
//     velocity (Killick et al. 2012 cost, one change point), so every boundary carries an uncertainty interval
//     instead of a single fragile threshold.
//  3. Per-segment onsets (trunk, upper arm, forearm) from each segment's own angular speed — the basis of
//     intersegment timing.
// A boundary that cannot be located (gap, recording edge, never returns) is null and the repetition is flagged
// incomplete; nothing is extrapolated.

import { countReps } from '../../core/reps';
import { lowpassZeroPhase } from '../signals';
import type { ChannelId, ChannelSet } from './channels';

export const PHASES = ['acceleration', 'deceleration', 'hold', 'return'] as const;
export type PhaseId = (typeof PHASES)[number];

export interface Boundary {
  /** Sample index (θ = 5 %). */
  i: number;
  /** Seconds from the first frame. */
  t: number;
  /** Earliest and latest estimate across θ ∈ {3, 5, 10 %} (and the change-point estimate for onset), seconds. */
  lo: number;
  hi: number;
}

export interface SegmentOnsets {
  trunk: number | null;
  upper: number | null;
  fore: number | null;
}

export interface Repetition {
  index: number;
  exercise: string;
  /** Coarse hysteresis window (sample indices). */
  window: { start: number; end: number };
  onset: Boundary | null;
  peakVelOut: Boundary | null;
  arrival: Boundary | null;
  departure: Boundary | null;
  peakVelRet: Boundary | null;
  offset: Boundary | null;
  /** Index of the task-angle maximum. */
  iPeak: number;
  /** Observed task outcome: task-angle excursion onset → maximum, degrees. */
  outcome: number;
  /** Task-angle value at onset (posture before the movement), degrees. */
  startAngle: number;
  /** Seconds from the first frame; each segment's own movement onset (5 % of its peak |ω| in the outbound phase). */
  segmentOnsets: SegmentOnsets;
  /** Onset by the change-point method minus the threshold onset, ms (method disagreement). */
  onsetMethodDiffMs: number | null;
  complete: boolean;
  flags: string[];
}

export interface SegmentConfig {
  lowpassHz: number;
  theta: number;
  thetaLo: number;
  thetaHi: number;
  /** Fraction of the maximum angle that still counts as the endpoint plateau. */
  plateau: number;
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = { lowpassHz: 6, theta: 0.05, thetaLo: 0.03, thetaHi: 0.1, plateau: 0.9 };

export function taskChannel(exercise: string): ChannelId | null {
  if (exercise === 'shoulder_flexion' || exercise === 'shoulder_abduction') return 'upper_elev';
  if (exercise === 'elbow_flexion') return 'elbow_flex';
  return null;
}

function finiteRuns(x: readonly number[]): boolean {
  return x.every(Number.isFinite);
}

/** Last index ≤ from (searching backwards) where |v| drops below thr; null if a NaN or the limit is hit first. */
function crossBack(v: readonly number[], from: number, limit: number, thr: number): number | null {
  for (let i = from; i >= limit; i--) {
    const x = v[i] as number;
    if (!Number.isFinite(x)) return null;
    if (Math.abs(x) < thr) return i;
  }
  return null;
}

function crossFwd(v: readonly number[], from: number, limit: number, thr: number): number | null {
  for (let i = from; i <= limit; i++) {
    const x = v[i] as number;
    if (!Number.isFinite(x)) return null;
    if (Math.abs(x) < thr) return i;
  }
  return null;
}

/** Single change point in the mean of v[a..b] (least squares); returns the first index of the second segment. */
export function meanChangePoint(v: readonly number[], a: number, b: number): number | null {
  const n = b - a + 1;
  if (n < 6) return null;
  for (let i = a; i <= b; i++) if (!Number.isFinite(v[i] as number)) return null;
  let tot = 0;
  for (let i = a; i <= b; i++) tot += v[i] as number;
  let best = -Infinity;
  let arg: number | null = null;
  let left = (v[a] as number) + (v[a + 1] as number);
  for (let k = a + 2; k <= b - 2; k++) {
    if (k > a + 2) left += v[k - 1] as number;
    const nl = k - a;
    const nr = n - nl;
    // between-segment sum of squares (maximising it minimises the two-segment residual SS)
    const ml = left / nl;
    const mr = (tot - left) / nr;
    const g = nl * nr * (ml - mr) ** 2;
    if (g > best) {
      best = g;
      arg = k;
    }
  }
  return arg;
}

export function segmentRepetitions(cs: ChannelSet, exercise: string, span: { start: number; end: number }, cfg: SegmentConfig = DEFAULT_SEGMENT_CONFIG): Repetition[] {
  const ch = taskChannel(exercise);
  const angle = ch ? cs.channels[ch] : undefined;
  if (!ch || !angle) return [];
  const rate = cs.meta.rateHz;
  const a = angle.slice(span.start, span.end + 1);
  const finite = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (finite.length < rate) return [];
  // thresholds from the step's own amplitude (as repThresholds, but data-driven: 90th percentile of the step)
  const p90 = finite[Math.floor(0.9 * (finite.length - 1))] as number;
  const high = Math.max(25, 0.45 * p90);
  const low = Math.max(10, 0.2 * p90);
  // NaN samples (missing sensor) must not create or close repetitions: hold the last value for windowing only
  let last = 0;
  const held = a.map((x) => (Number.isFinite(x) ? (last = x) : last));
  const wins = countReps(held, low, high);
  // velocity of the task angle (deg/s), zero-phase low-pass; NaN where the angle is NaN
  const vel = derivative(lowpassNaN(angle, cfg.lowpassHz, rate), rate);
  const reps: Repetition[] = [];
  const nextStart = (k: number) => (k + 1 < wins.length ? span.start + (wins[k + 1] as { start: number }).start : span.end);
  wins.forEach((w, k) => {
    const s = span.start + w.start;
    const e = span.start + w.end;
    const prevEnd = k > 0 ? span.start + (wins[k - 1] as { end: number }).end : span.start;
    const flags: string[] = [];
    // maximum of the angle in the window
    let iPeak = s;
    for (let i = s; i <= e; i++) if ((angle[i] as number) > (angle[iPeak] as number) || !Number.isFinite(angle[iPeak] as number)) iPeak = i;
    if (!finiteRuns(angle.slice(s, e + 1))) flags.push('missing_samples');
    // outbound: peak positive velocity between the search start and the angle maximum
    const searchFrom = Math.max(prevEnd, s - Math.round(1.5 * rate));
    let iVo = -1;
    for (let i = searchFrom; i <= iPeak; i++) if (Number.isFinite(vel[i] as number) && (iVo < 0 || (vel[i] as number) > (vel[iVo] as number))) iVo = i;
    let iVr = -1;
    const searchTo = Math.min(nextStart(k), e + Math.round(1.5 * rate), angle.length - 1);
    for (let i = iPeak; i <= searchTo; i++) if (Number.isFinite(vel[i] as number) && (iVr < 0 || (vel[i] as number) < (vel[iVr] as number))) iVr = i;
    const vO = iVo >= 0 ? (vel[iVo] as number) : NaN;
    const vR = iVr >= 0 ? -(vel[iVr] as number) : NaN;
    const bnd = (find: (th: number) => number | null, peak: number): Boundary | null => {
      if (!(peak > 0)) return null;
      const i = find(cfg.theta * peak);
      if (i === null) return null;
      const alt = [find(cfg.thetaLo * peak), find(cfg.thetaHi * peak)].filter((x): x is number => x !== null).map((x) => cs.t[x] as number);
      const ts = [cs.t[i] as number, ...alt];
      return { i, t: cs.t[i] as number, lo: Math.min(...ts), hi: Math.max(...ts) };
    };
    const onset = iVo >= 0 ? bnd((th) => crossBack(vel, iVo, searchFrom, th), vO) : null;
    const arrival = iVo >= 0 ? bnd((th) => crossFwd(vel, iVo, iPeak, th), vO) : null;
    const departure = iVr >= 0 ? bnd((th) => crossBack(vel, iVr, iPeak, th), vR) : null;
    const offset = iVr >= 0 ? bnd((th) => crossFwd(vel, iVr, searchTo, th), vR) : null;
    // change-point corroboration of the onset
    let cpDiff: number | null = null;
    if (onset && iVo > searchFrom + 6) {
      const cp = meanChangePoint(vel, searchFrom, iVo);
      if (cp !== null) {
        const tc = cs.t[cp] as number;
        cpDiff = Math.round((tc - onset.t) * 1000);
        onset.lo = Math.min(onset.lo, tc);
        onset.hi = Math.max(onset.hi, tc);
      }
    }
    if (!onset) flags.push('onset_not_found');
    if (!offset) flags.push('offset_not_found');
    if (iPeak === e) flags.push('peak_at_window_end');
    const i0 = onset?.i ?? s;
    const outcome = (angle[iPeak] as number) - (angle[i0] as number);
    reps.push({
      index: reps.length,
      exercise,
      window: { start: s, end: e },
      onset,
      peakVelOut: iVo >= 0 ? { i: iVo, t: cs.t[iVo] as number, lo: cs.t[iVo] as number, hi: cs.t[iVo] as number } : null,
      arrival,
      departure,
      peakVelRet: iVr >= 0 ? { i: iVr, t: cs.t[iVr] as number, lo: cs.t[iVr] as number, hi: cs.t[iVr] as number } : null,
      offset,
      iPeak,
      outcome,
      startAngle: angle[i0] as number,
      segmentOnsets: segmentOnsets(cs, searchFrom, iPeak, cfg),
      onsetMethodDiffMs: cpDiff,
      complete: !!onset && !!arrival && !!departure && !!offset && !flags.includes('missing_samples'),
      flags,
    });
  });
  return reps;
}

/** Each segment's onset: last crossing of 5 % of its own outbound peak |ω| before that peak. */
function segmentOnsets(cs: ChannelSet, from: number, to: number, cfg: SegmentConfig): SegmentOnsets {
  const out: SegmentOnsets = { trunk: null, upper: null, fore: null };
  const rate = cs.meta.rateHz;
  for (const [role, id] of [['trunk', 'trunk_rate'], ['upper', 'upper_rate'], ['fore', 'fore_rate']] as const) {
    const r = cs.channels[id];
    if (!r) continue;
    const f = lowpassNaN(r, cfg.lowpassHz, rate);
    let ip = -1;
    for (let i = from; i <= to; i++) if (Number.isFinite(f[i] as number) && (ip < 0 || (f[i] as number) > (f[ip] as number))) ip = i;
    // a segment that barely moves (peak < 10 °/s) has no defined onset
    if (ip < 0 || !((f[ip] as number) >= 10)) continue;
    const thr = Math.max(3, cfg.theta * (f[ip] as number));
    const i = crossBack(f, ip, from, thr);
    if (i !== null) out[role] = cs.t[i] as number;
  }
  return out;
}

/** Zero-phase low-pass over finite runs only (NaN gaps split the signal; never bridged). */
export function lowpassNaN(x: readonly number[], fc: number, fs: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = -1;
  for (let i = 0; i <= x.length; i++) {
    const ok = i < x.length && Number.isFinite(x[i] as number);
    if (ok && s < 0) s = i;
    if (!ok && s >= 0) {
      const seg = lowpassZeroPhase(x.slice(s, i), fc, fs);
      for (let k = 0; k < seg.length; k++) out[s + k] = seg[k] as number;
      s = -1;
    }
  }
  return out;
}

/** Central difference, deg/s; NaN next to NaN. */
export function derivative(x: readonly number[], fs: number): number[] {
  return x.map((_, i) => {
    const a = x[Math.max(0, i - 1)] as number;
    const b = x[Math.min(x.length - 1, i + 1)] as number;
    const h = (Math.min(x.length - 1, i + 1) - Math.max(0, i - 1)) / fs;
    return Number.isFinite(a) && Number.isFinite(b) && h > 0 ? (b - a) / h : NaN;
  });
}

/** Phase durations of a repetition, seconds (null when a boundary is missing). */
export function phaseDurations(r: Repetition): Record<PhaseId, number | null> {
  const d = (a: Boundary | null, b: Boundary | null) => (a && b ? b.t - a.t : null);
  return { acceleration: d(r.onset, r.peakVelOut), deceleration: d(r.peakVelOut, r.arrival), hold: d(r.arrival, r.departure), return: d(r.departure, r.offset) };
}
