// Signal-quality assessment of a raw recording (imu-csv v1 frames), per sensor and for the recording.
//
// Every check answers "can the derived values from this sensor be trusted for analysis?" — it never repairs data.
// Thresholds are engineering conditions for valid processing, NOT clinical norms; each is documented in
// research/measurement-model.md §4 with its rationale.

import { INT16_MAX } from '../core/imu';
import type { Placement, RawFrame } from '../devices/types';
import { PLACEMENTS } from '../devices/types';
import { quantile } from './numeric';
import { BIAS_WINDOW_SEC, findStill } from './signals';
import { toPhysical } from '../core/imu';
import type { Vec3 } from '../lib/vec3';

export type Confidence = 'high' | 'medium' | 'low' | 'unusable';

export const QC_LIMITS = {
  /** Completeness (received / expected samples). */
  completenessHigh: 0.98,
  completenessMedium: 0.9,
  /** Longest gap: the orientation filter restarts after 0.5 s (core/pipeline.ts). */
  longestGapSec: 0.5,
  /** Fraction of saturated samples (any axis at ±32767/−32768): ±4 g, ±1000 °/s ranges. */
  saturationMedium: 0.005,
  saturationLow: 0.02,
  /** Accelerometer norm at rest: |a| − 1 g beyond this suggests a calibration (offset/scale) problem. */
  restNormDev: 0.03,
  /** Gyroscope bias difference between the first and last still period (°/s): bias drift over the recording. */
  biasDriftDps: 1,
  /** Sampling interval considered irregular when it deviates from nominal by more than this fraction. */
  dtTolerance: 0.5,
} as const;

export interface SensorQC {
  placement: Placement;
  samples: number;
  expected: number;
  completeness: number;
  gaps: number;
  longestGapSec: number;
  dtMedianMs: number;
  dtP95Ms: number;
  irregularFraction: number;
  saturatedSamples: number;
  saturatedFraction: number;
  /** Axes that hit the range limit at least once: ax ay az gx gy gz. */
  saturatedAxes: boolean[];
  /** Axes whose value never changes (stuck sensor or disconnected axis). */
  flatAxes: boolean[];
  restAccNorm: number | null;
  biasFirst: Vec3 | null;
  biasLast: Vec3 | null;
  biasDriftDps: number | null;
  confidence: Confidence;
  reasons: string[];
}

export interface RecordingQC {
  durationSec: number;
  rateHz: number;
  frames: number;
  /** Frames missing by sequence number (packet loss detectable from seq gaps). */
  seqMissing: number;
  /** Fraction of frames that carry every sensor present in the recording (the three modules share one clock). */
  syncFraction: number;
  placements: Placement[];
  sensors: SensorQC[];
  confidence: Confidence;
  notes: string[];
}

const rank: Record<Confidence, number> = { high: 0, medium: 1, low: 2, unusable: 3 };
const worst = (a: Confidence, b: Confidence): Confidence => (rank[a] >= rank[b] ? a : b);

export function assessRecording(frames: readonly RawFrame[], rateHz: number): RecordingQC {
  const notes: string[] = [];
  if (frames.length < 2) {
    return { durationSec: 0, rateHz, frames: frames.length, seqMissing: 0, syncFraction: 0, placements: [], sensors: [], confidence: 'unusable', notes: ['too_few_frames'] };
  }
  const first = frames[0] as RawFrame;
  const lastF = frames[frames.length - 1] as RawFrame;
  const expectedFrames = lastF.seq - first.seq + 1;
  const placements = PLACEMENTS.filter((p) => frames.some((f) => f.data[p]));
  let all = 0;
  for (const f of frames) if (placements.every((p) => f.data[p])) all += 1;
  const sensors = placements.map((p) => assessSensor(frames, p, rateHz, expectedFrames));
  let conf: Confidence = 'high';
  for (const s of sensors) conf = worst(conf, s.confidence);
  if (!sensors.length) conf = 'unusable';
  const syncFraction = all / frames.length;
  if (syncFraction < 0.98) notes.push('sensors_not_in_every_frame');
  // The firmware reads all modules in one loop and sends one line per sample: sensors share one timestamp by
  // construction. Inter-sensor synchronisation is therefore a property of the frame, not estimated here.
  notes.push('shared_clock_by_construction');
  return {
    durationSec: lastF.t - first.t,
    rateHz,
    frames: frames.length,
    seqMissing: Math.max(0, expectedFrames - frames.length),
    syncFraction,
    placements,
    sensors,
    confidence: conf,
    notes,
  };
}

function assessSensor(frames: readonly RawFrame[], p: Placement, rateHz: number, expectedFrames: number): SensorQC {
  const reasons: string[] = [];
  const idx: number[] = [];
  frames.forEach((f, i) => {
    if (f.data[p]) idx.push(i);
  });
  const nominal = 1 / rateHz;
  const dts: number[] = [];
  let gaps = 0;
  let longest = 0;
  for (let j = 1; j < idx.length; j++) {
    const a = frames[idx[j - 1] as number] as RawFrame;
    const b = frames[idx[j] as number] as RawFrame;
    const dt = b.t - a.t;
    dts.push(dt);
    if (b.seq - a.seq > 1) {
      gaps += 1;
      longest = Math.max(longest, dt);
    }
  }
  const sorted = [...dts].sort((a, b) => a - b);
  const irregular = dts.filter((d) => Math.abs(d - nominal) > QC_LIMITS.dtTolerance * nominal).length / Math.max(1, dts.length);
  const satAxes = [false, false, false, false, false, false];
  const minV = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
  const maxV = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
  let sat = 0;
  for (const i of idx) {
    const raw = (frames[i] as RawFrame).data[p] as Int16Array;
    let any = false;
    for (let a = 0; a < 6; a++) {
      const v = raw[a] as number;
      if (v >= INT16_MAX || v <= -INT16_MAX - 1) {
        satAxes[a] = true;
        any = true;
      }
      if (v < (minV[a] as number)) minV[a] = v;
      if (v > (maxV[a] as number)) maxV[a] = v;
    }
    if (any) sat += 1;
  }
  const flatAxes = minV.map((lo, a) => idx.length > rateHz && lo === maxV[a]);
  const phys = idx.map((i) => toPhysical((frames[i] as RawFrame).data[p] as Int16Array));
  const gyro = phys.map((s) => s.gyro);
  const acc = phys.map((s) => s.acc);
  const firstStill = findStill(gyro, acc, rateHz, BIAS_WINDOW_SEC);
  // last still period: search the reversed signals
  const revStill = findStill([...gyro].reverse(), [...acc].reverse(), rateHz, BIAS_WINDOW_SEC);
  const meanOver = (xs: readonly Vec3[], s: number, e: number): Vec3 => {
    const m: Vec3 = [0, 0, 0];
    for (let i = s; i < e; i++) for (let a = 0; a < 3; a++) m[a] = (m[a] as number) + ((xs[i] as Vec3)[a] as number) / (e - s);
    return m;
  };
  let restAccNorm: number | null = null;
  let biasFirst: Vec3 | null = null;
  let biasLast: Vec3 | null = null;
  if (firstStill) {
    biasFirst = meanOver(gyro, firstStill.start, firstStill.end);
    const a = meanOver(acc, firstStill.start, firstStill.end);
    restAccNorm = Math.hypot(a[0], a[1], a[2]);
  }
  if (revStill) {
    const s = gyro.length - revStill.end;
    const e = gyro.length - revStill.start;
    if (!firstStill || s >= firstStill.end) biasLast = meanOver(gyro, s, e);
  }
  const biasDrift = biasFirst && biasLast ? Math.hypot(biasLast[0] - biasFirst[0], biasLast[1] - biasFirst[1], biasLast[2] - biasFirst[2]) : null;
  const completeness = idx.length / Math.max(1, expectedFrames);
  const satFrac = sat / Math.max(1, idx.length);

  let conf: Confidence = 'high';
  const down = (c: Confidence, r: string) => {
    conf = worst(conf, c);
    reasons.push(r);
  };
  if (idx.length < rateHz) down('unusable', 'under_one_second_of_data');
  if (completeness < QC_LIMITS.completenessMedium) down('low', 'completeness_below_90');
  else if (completeness < QC_LIMITS.completenessHigh) down('medium', 'completeness_below_98');
  if (longest > QC_LIMITS.longestGapSec) down('medium', 'gap_longer_than_0_5_s');
  if (satFrac > QC_LIMITS.saturationLow) down('low', 'saturation_above_2_percent');
  else if (satFrac > QC_LIMITS.saturationMedium) down('medium', 'saturation_above_0_5_percent');
  if (flatAxes.some(Boolean)) down('low', 'axis_never_changes');
  if (!firstStill) down('medium', 'no_still_period_for_bias');
  if (restAccNorm !== null && Math.abs(restAccNorm - 1) > QC_LIMITS.restNormDev) down('medium', 'rest_acceleration_not_1g');
  if (biasDrift !== null && biasDrift > QC_LIMITS.biasDriftDps) down('medium', 'gyro_bias_drift');
  if (irregular > 0.05) down('medium', 'irregular_sampling');

  return {
    placement: p,
    samples: idx.length,
    expected: expectedFrames,
    completeness,
    gaps,
    longestGapSec: longest,
    dtMedianMs: sorted.length ? quantile(sorted, 0.5) * 1000 : NaN,
    dtP95Ms: sorted.length ? quantile(sorted, 0.95) * 1000 : NaN,
    irregularFraction: irregular,
    saturatedSamples: sat,
    saturatedFraction: satFrac,
    saturatedAxes: satAxes,
    flatAxes,
    restAccNorm,
    biasFirst,
    biasLast,
    biasDriftDps: biasDrift,
    confidence: conf,
    reasons,
  };
}
