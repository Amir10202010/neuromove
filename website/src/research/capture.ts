// IMU value of one trial, computed from the session engine's live angle series (LiveSeries).
// The series holds the joint angle the existing pipeline computes (core/pipeline.ts) at the device rate,
// only while the engine is in its 'recording' phase (after stand-still calibration). Pure functions.

import type { LiveSeries } from '../session/LiveSeries';
import type { ImuCapture, MeasurementPointKind } from './model';

export type CaptureProblem = 'no_samples' | 'too_few_samples';

export interface SeriesView {
  size: number;
  t(i: number): number;
  angle(i: number): number;
  inRep(i: number): boolean;
}

export function viewOf(s: LiveSeries): SeriesView {
  return {
    size: s.size,
    t: (i) => s.t[s.index(i)] as number,
    angle: (i) => s.angle[s.index(i)] as number,
    inRep: (i) => s.inRep[s.index(i)] === 1,
  };
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const sdOf = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Hold capture: median of the joint angle over the last `windowSec` seconds of the series.
 * The median (not the mean) is robust to a single spike; the window SD is recorded so an unstable hold
 * is visible in the data instead of being silently accepted.
 */
export function holdCapture(v: SeriesView, windowSec: number, minSamples: number, now = new Date()): ImuCapture | CaptureProblem {
  if (v.size === 0) return 'no_samples';
  const tEnd = v.t(v.size - 1);
  const xs: number[] = [];
  let tFrom = tEnd;
  // Inclusive window [tEnd − windowSec, tEnd]; the epsilon absorbs floating-point error in device time
  for (let i = v.size - 1; i >= 0 && v.t(i) >= tEnd - windowSec - 1e-9; i--) {
    const a = v.angle(i);
    if (!Number.isFinite(a)) continue;
    xs.push(a);
    tFrom = v.t(i);
  }
  if (xs.length < minSamples) return 'too_few_samples';
  return {
    angleDeg: medianOf(xs),
    method: 'hold',
    tFrom,
    tTo: tEnd,
    samples: xs.length,
    windowSdDeg: sdOf(xs),
    windowMinDeg: Math.min(...xs),
    windowMaxDeg: Math.max(...xs),
    capturedAt: now.toISOString(),
  };
}

/**
 * Repetition-peak capture: the most recent completed repetition (contiguous inRep block that has ended)
 * → its extreme angle. Max for flexion-type points, min for extension-type points; neutral/custom use
 * the median of the last 0.5 s (the participant is expected to hold).
 * Experimental: the goniometer is read on a static joint, the peak is a dynamic value.
 */
export function repPeakCapture(v: SeriesView, point: MeasurementPointKind, minSamples: number, now = new Date()): ImuCapture | CaptureProblem {
  if (v.size === 0) return 'no_samples';
  let end = v.size - 1;
  while (end >= 0 && !v.inRep(end)) end--;
  if (end < 0) return 'no_samples';
  let start = end;
  while (start > 0 && v.inRep(start - 1)) start--;
  const xs: number[] = [];
  for (let i = start; i <= end; i++) if (Number.isFinite(v.angle(i))) xs.push(v.angle(i));
  if (xs.length < minSamples) return 'too_few_samples';
  if (point !== 'max_flexion' && point !== 'max_extension') return holdCapture(v, 0.5, minSamples, now);
  const angle = point === 'max_flexion' ? Math.max(...xs) : Math.min(...xs);
  return {
    angleDeg: angle,
    method: 'rep_peak',
    tFrom: v.t(start),
    tTo: v.t(end),
    samples: xs.length,
    windowSdDeg: sdOf(xs),
    windowMinDeg: Math.min(...xs),
    windowMaxDeg: Math.max(...xs),
    capturedAt: now.toISOString(),
  };
}

/** Number of completed repetition blocks in the series (used to detect "a repetition just ended"). */
export function completedRepBlocks(v: SeriesView): number {
  let n = 0;
  for (let i = 1; i < v.size; i++) if (v.inRep(i - 1) && !v.inRep(i)) n++;
  return n;
}
