// Velocity-based movement events at 100 Hz — onset, peak and offset of each movement of one segment,
// movement direction (raise / lower by inclination change), pauses and incomplete movements.
//
// Method (research/measurement-model.md §5): angular speed |ω| of the segment, zero-phase low-pass 6 Hz;
// a movement is a run where speed exceeds a HIGH threshold, extended backwards and forwards to where speed falls
// below a LOW threshold (5 % of the movement's own peak, at least the noise floor) — the convention used for
// movement segmentation in the smoothness literature (Balasubramanian et al. 2015). Runs closer than the merge gap
// are merged; runs shorter than the minimum duration are discarded as noise.
//
// This complements — does not replace — the existing repetition detector (core/reps.ts), which segments on the
// joint ANGLE with hysteresis. The Analysis Lab shows both so that a researcher can compare them.

import { lowpassZeroPhase, type SensorSignals } from './signals';

export interface EventConfig {
  lowpassHz: number;
  /** High threshold: max(highFloorDps, highFraction × 99th percentile of speed). */
  highFloorDps: number;
  highFraction: number;
  /** Onset/offset: lowFraction × the movement's peak, at least lowFloorDps. */
  lowFraction: number;
  lowFloorDps: number;
  mergeGapSec: number;
  minDurationSec: number;
  /** A still period at least this long between movements is reported as a pause. */
  pauseSec: number;
  /** Minimum inclination change (°) for a movement to get a direction; smaller ones are 'other'. */
  directionDeg: number;
}

export const DEFAULT_EVENT_CONFIG: EventConfig = {
  lowpassHz: 6,
  highFloorDps: 20,
  highFraction: 0.15,
  lowFraction: 0.05,
  lowFloorDps: 3,
  mergeGapSec: 0.12,
  minDurationSec: 0.25,
  pauseSec: 1,
  directionDeg: 10,
};

export interface MovementEvent {
  index: number;
  onset: number;
  peak: number;
  offset: number;
  /** Indices into the signal arrays. */
  iOnset: number;
  iPeak: number;
  iOffset: number;
  peakSpeed: number;
  direction: 'raise' | 'lower' | 'other';
  /** Touches the start/end of the recording or a data gap: features may be truncated. */
  incomplete: boolean;
}

export interface EventResult {
  events: MovementEvent[];
  pauses: { start: number; end: number }[];
  /** Filtered speed used for detection (°/s). */
  speedFiltered: number[];
  highThreshold: number;
  config: EventConfig;
}

export function detectMovements(sig: SensorSignals, rateHz: number, cfg: EventConfig = DEFAULT_EVENT_CONFIG): EventResult {
  const sp = lowpassZeroPhase(sig.speed, cfg.lowpassHz, rateHz);
  const n = sp.length;
  const sorted = [...sp].sort((a, b) => a - b);
  const p99 = sorted[Math.min(n - 1, Math.floor(0.99 * n))] ?? 0;
  const hi = Math.max(cfg.highFloorDps, cfg.highFraction * p99);
  // gap boundaries in the signal (sample index where a > 0.5 s or seq gap begins)
  const gapAt = new Set<number>();
  for (let i = 1; i < n; i++) if ((sig.t[i] as number) - (sig.t[i - 1] as number) > 0.5) gapAt.add(i);
  // runs above the high threshold
  const runs: { s: number; e: number }[] = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    const above = (sp[i] as number) > hi;
    if (above && s < 0) s = i;
    if ((!above || gapAt.has(i)) && s >= 0) {
      runs.push({ s, e: i - 1 });
      s = above ? i : -1;
    }
  }
  if (s >= 0) runs.push({ s, e: n - 1 });
  // extend each run to low-threshold crossings
  const ext = runs.map((r) => {
    let pk = r.s;
    for (let i = r.s; i <= r.e; i++) if ((sp[i] as number) > (sp[pk] as number)) pk = i;
    const lo = Math.max(cfg.lowFloorDps, cfg.lowFraction * (sp[pk] as number));
    let a = r.s;
    while (a > 0 && (sp[a - 1] as number) > lo && !gapAt.has(a)) a -= 1;
    let b = r.e;
    while (b < n - 1 && (sp[b + 1] as number) > lo && !gapAt.has(b + 1)) b += 1;
    return { s: a, e: b, pk };
  });
  // merge overlapping / close runs
  const merged: { s: number; e: number; pk: number }[] = [];
  for (const r of ext) {
    const prev = merged[merged.length - 1];
    if (prev && ((sig.t[r.s] as number) - (sig.t[prev.e] as number) <= cfg.mergeGapSec || r.s <= prev.e) && !rangeHasGap(gapAt, prev.e, r.s)) {
      prev.e = Math.max(prev.e, r.e);
      if ((sp[r.pk] as number) > (sp[prev.pk] as number)) prev.pk = r.pk;
    } else merged.push({ ...r });
  }
  const events: MovementEvent[] = [];
  for (const r of merged) {
    const dur = (sig.t[r.e] as number) - (sig.t[r.s] as number);
    if (dur < cfg.minDurationSec) continue;
    const dElev = (sig.elevation[r.e] as number) - (sig.elevation[r.s] as number);
    events.push({
      index: events.length,
      onset: sig.t[r.s] as number,
      peak: sig.t[r.pk] as number,
      offset: sig.t[r.e] as number,
      iOnset: r.s,
      iPeak: r.pk,
      iOffset: r.e,
      peakSpeed: sp[r.pk] as number,
      direction: dElev > cfg.directionDeg ? 'raise' : dElev < -cfg.directionDeg ? 'lower' : 'other',
      incomplete: r.s === 0 || r.e === n - 1 || gapAt.has(r.s) || gapAt.has(r.e + 1),
    });
  }
  const pauses: { start: number; end: number }[] = [];
  for (let k = 1; k < events.length; k++) {
    const a = events[k - 1] as MovementEvent;
    const b = events[k] as MovementEvent;
    if (b.onset - a.offset >= cfg.pauseSec) pauses.push({ start: a.offset, end: b.onset });
  }
  return { events, pauses, speedFiltered: sp, highThreshold: hi, config: cfg };
}

function rangeHasGap(gapAt: ReadonlySet<number>, a: number, b: number): boolean {
  for (let i = a + 1; i <= b; i++) if (gapAt.has(i)) return true;
  return false;
}

/** Pair raise → lower movements into repetitions (raise followed by the next lower before another raise). */
export function pairRepetitions(events: readonly MovementEvent[]): { raise: MovementEvent; lower: MovementEvent | null }[] {
  const out: { raise: MovementEvent; lower: MovementEvent | null }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as MovementEvent;
    if (e.direction !== 'raise') continue;
    const next = events.slice(i + 1).find((x) => x.direction !== 'other');
    out.push({ raise: e, lower: next && next.direction === 'lower' ? next : null });
  }
  return out;
}
