// Raw frames → per-sensor physical signals at the device rate (100 Hz), for the Movement Analysis Lab.
//
// Layers (research/measurement-model.md):
//   measured    accelerometer (g) and gyroscope (°/s) per axis — after the documented LSB conversion only
//   derived     angular speed |ω| with a still-period bias removed; segment inclination from gravity
//               (the EXISTING complementary filter, core/orientation.ts — not a new orientation algorithm)
//
// Not derived, by design: absolute position (double integration of accelerometers drifts quadratically;
// Kok, Hol & Schön 2017, doi:10.1561/2000000094) and heading/yaw (no magnetometer on MPU-6050).

import { toPhysical } from '../core/imu';
import { GravityTracker, angleBetween, elevation } from '../core/orientation';
import type { Placement, RawFrame } from '../devices/types';
import type { Vec3 } from '../lib/vec3';

export interface SensorSignals {
  placement: Placement;
  /** Seconds from the first frame of the recording. */
  t: number[];
  acc: Vec3[];
  gyro: Vec3[];
  /** |ω| (°/s) after subtracting the gyroscope bias estimated in still periods (biasDps). */
  speed: number[];
  /** Inclination of the sensor X axis from "hanging down", degrees (0 down, 90 horizontal, 180 up). */
  elevation: number[];
  /** Tilt of the sensor from its orientation in the first still period, degrees (used for the trunk). */
  tiltFromStart: number[];
  saturated: boolean[];
  /** Gyroscope bias used (°/s), from the first still period; zeros when none was found. */
  biasDps: Vec3;
  biasSource: 'first_still_period' | 'none_found';
}

/** Window for gyroscope-bias estimation: 3 s, as the session calibration (core/pipeline.ts) — long enough to average out body sway. */
export const BIAS_WINDOW_SEC = 3;

/** First window of `sec` seconds where the gyroscope range per axis stays below `rangeDps` (the Calibrator's rule). */
export function findStill(gyro: readonly Vec3[], acc: readonly Vec3[], rateHz: number, sec = 1, rangeDps = 16, accDev = 0.15, maxTiltDeg = 1): { start: number; end: number } | null {
  const w = Math.max(2, Math.round(sec * rateHz));
  for (let s = 0; s + w <= gyro.length; s += Math.max(1, Math.floor(w / 4))) {
    let ok = true;
    for (let ax = 0; ax < 3 && ok; ax++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = s; i < s + w; i++) {
        const v = (gyro[i] as Vec3)[ax] as number;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > rangeDps) ok = false;
    }
    for (let i = s; i < s + w && ok; i++) {
      const a = acc[i] as Vec3;
      if (Math.abs(Math.hypot(a[0], a[1], a[2]) - 1) > accDev) ok = false;
    }
    // A slow steady rotation passes the range test (its rate is constant) but turns gravity in the sensor frame:
    // require the mean gravity direction of the first and last quarter to differ by less than maxTiltDeg.
    // Without this, the rotation rate would be read as gyroscope bias.
    if (ok) {
      const q = Math.max(1, Math.floor(w / 4));
      const mean = (a: number, b: number): Vec3 => {
        const m: Vec3 = [0, 0, 0];
        for (let i = a; i < b; i++) for (let k = 0; k < 3; k++) m[k] = (m[k] as number) + ((acc[i] as Vec3)[k] as number);
        return m;
      };
      const g0 = mean(s, s + q);
      const g1 = mean(s + w - q, s + w);
      const cos = (g0[0] * g1[0] + g0[1] * g1[1] + g0[2] * g1[2]) / (Math.hypot(...g0) * Math.hypot(...g1) || 1);
      if ((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI > maxTiltDeg) ok = false;
    }
    if (ok) return { start: s, end: s + w };
  }
  return null;
}

export function sensorSignals(frames: readonly RawFrame[], placement: Placement, rateHz: number): SensorSignals | null {
  const idx: number[] = [];
  frames.forEach((f, i) => {
    if (f.data[placement]) idx.push(i);
  });
  if (idx.length < 2) return null;
  const t0 = (frames[0] as RawFrame).t;
  const raw = idx.map((i) => toPhysical((frames[i] as RawFrame).data[placement] as Int16Array));
  const acc = raw.map((s) => s.acc);
  const gyroRaw = raw.map((s) => s.gyro);
  const still = findStill(gyroRaw, acc, rateHz, BIAS_WINDOW_SEC);
  const bias: Vec3 = [0, 0, 0];
  if (still) {
    for (let i = still.start; i < still.end; i++) for (let a = 0; a < 3; a++) bias[a] = (bias[a] as number) + ((gyroRaw[i] as Vec3)[a] as number) / (still.end - still.start);
  }
  const gyro = gyroRaw.map((g) => [g[0] - bias[0], g[1] - bias[1], g[2] - bias[2]] as Vec3);
  const tr = new GravityTracker();
  const t: number[] = [];
  const elev: number[] = [];
  const tilt: number[] = [];
  let refUp: Vec3 | null = null;
  let prevT: number | null = null;
  idx.forEach((fi, j) => {
    const ft = (frames[fi] as RawFrame).t;
    let dt = prevT === null ? 1 / rateHz : ft - prevT;
    // Same rule as the pipeline: a gap > 0.5 s invalidates the previous orientation
    if (dt > 0.5 || dt <= 0) {
      tr.reset();
      dt = 1 / rateHz;
    }
    const up = tr.update(acc[j] as Vec3, gyro[j] as Vec3, dt);
    prevT = ft;
    if (still && j === still.end - 1) refUp = up;
    t.push(ft - t0);
    elev.push(elevation(up));
    tilt.push(refUp ? angleBetween(refUp, up) : NaN);
  });
  // Tilt before the reference exists is undefined (NaN), never back-filled with a guess
  return {
    placement,
    t,
    acc,
    gyro,
    speed: gyro.map((g) => Math.hypot(g[0], g[1], g[2])),
    elevation: elev,
    tiltFromStart: tilt,
    saturated: raw.map((s) => s.saturated),
    biasDps: bias,
    biasSource: still ? 'first_still_period' : 'none_found',
  };
}

// ── zero-phase low-pass filter (2nd-order Butterworth, forward–backward) ──────────────────────

function biquadLowpass(fc: number, fs: number): { b: [number, number, number]; a: [number, number] } {
  const k = Math.tan((Math.PI * fc) / fs);
  const q = Math.SQRT1_2;
  const norm = 1 / (1 + k / q + k * k);
  const b0 = k * k * norm;
  return { b: [b0, 2 * b0, b0], a: [2 * (k * k - 1) * norm, (1 - k / q + k * k) * norm] };
}

function runBiquad(x: readonly number[], c: ReturnType<typeof biquadLowpass>): number[] {
  const y = new Array<number>(x.length);
  // initialise at steady state of the first sample to avoid a start-up transient
  let x1 = x[0] ?? 0;
  let x2 = x1;
  let y1 = x1;
  let y2 = x1;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = c.b[0] * xi + c.b[1] * x1 + c.b[2] * x2 - c.a[0] * y1 - c.a[1] * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Zero-phase (filtfilt) 2nd-order Butterworth low-pass; effective order 4, no phase lag (onsets are not shifted). */
export function lowpassZeroPhase(x: readonly number[], fc: number, fs: number): number[] {
  if (x.length < 3 || !(fc > 0) || fc >= fs / 2) return [...x];
  const c = biquadLowpass(fc, fs);
  const fwd = runBiquad(x, c);
  return runBiquad(fwd.reverse(), c).reverse();
}
