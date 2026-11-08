// Quaternions and a 6-axis (gyroscope + accelerometer) orientation filter for the coordination engine.
//
// Why a full-orientation filter at all: the existing GravityTracker (core/orientation.ts) tracks only the 2-DOF
// gravity direction. That is the right tool for segment INCLINATION and stays the source of every inclination
// channel. One MCSE channel — the angle between the upper-arm and trunk long axes (humerothoracic elevation) — needs
// the RELATIVE heading of two sensors, which only full orientation propagation provides.
//
// Filter: Madgwick, Harrison & Vaidyanathan 2011 (doi:10.1109/ICORR.2011.5975346), IMU (6-axis) gradient-descent
// form — ADAPTED line by line from the reference C implementation as also used by gaitmap (MIT part,
// gaitmap/trajectory_reconstruction/orientation_methods/_madgwick.py). Conventions here:
//   q = [w, x, y, z] (scalar first), q maps SENSOR → WORLD vectors (v_w = q v_s q*), world Z up,
//   gyroscope in rad/s, accelerometer in any unit (normalised), beta = gradient step.
// With 6 axes the heading (rotation about world Z) is NOT corrected by any measurement: it is pure gyroscope
// integration and drifts with residual gyroscope bias. Benchmarked against `ahrs` (Python) in
// research/algorithm-benchmarking.md.

import type { Vec3 } from '../../lib/vec3';

export type Quat = [number, number, number, number];

export const qIdentity = (): Quat => [1, 0, 0, 0];

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export const qConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate a vector by q (sensor → world when q is a filter output). */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const p = qMul(qMul(q, [0, v[0], v[1], v[2]]), qConj(q));
  return [p[1], p[2], p[3]];
}

export function qFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angleRad / 2) / n;
  return [Math.cos(angleRad / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** Rotation angle between two orientations, radians (0…π). */
export function qAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

/**
 * Orientation whose sensor-frame "up" (the accelerometer at rest) maps to world +Z, with zero heading
 * convention: the smallest rotation taking the measured up vector to +Z.
 */
export function qFromGravity(acc: Vec3): Quat {
  const n = Math.hypot(acc[0], acc[1], acc[2]) || 1;
  const u: Vec3 = [acc[0] / n, acc[1] / n, acc[2] / n];
  // rotation u → z: axis u × z, angle acos(u·z)
  const axis: Vec3 = [u[1], -u[0], 0];
  const s = Math.hypot(axis[0], axis[1]);
  if (s < 1e-9) return u[2] > 0 ? qIdentity() : [0, 1, 0, 0];
  return qFromAxisAngle(axis, Math.atan2(s, u[2]));
}

/** Heading (yaw about world Z) of a world vector's horizontal projection, radians; NaN when near vertical. */
export function headingOf(vWorld: Vec3): number {
  const h = Math.hypot(vWorld[0], vWorld[1]);
  return h < 0.2 ? NaN : Math.atan2(vWorld[1], vWorld[0]);
}

/** Default gradient step. 0.033 rad/s is Madgwick's suggested IMU value (also the default of `ahrs`). */
export const MADGWICK_BETA = 0.033;

/** One Madgwick IMU update. gyro rad/s, acc any unit, dt seconds. */
export function madgwickStep(q: Quat, gyro: Vec3, acc: Vec3, dt: number, beta = MADGWICK_BETA): Quat {
  const [q0, q1, q2, q3] = q;
  const [gx, gy, gz] = gyro;
  let qd0 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
  let qd1 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
  let qd2 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
  let qd3 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);
  const an = Math.hypot(acc[0], acc[1], acc[2]);
  if (beta > 0 && an > 0) {
    const ax = acc[0] / an;
    const ay = acc[1] / an;
    const az = acc[2] / an;
    const _2q0 = 2 * q0;
    const _2q1 = 2 * q1;
    const _2q2 = 2 * q2;
    const _2q3 = 2 * q3;
    const _4q0 = 4 * q0;
    const _4q1 = 4 * q1;
    const _4q2 = 4 * q2;
    const _8q1 = 8 * q1;
    const _8q2 = 8 * q2;
    const q0q0 = q0 * q0;
    const q1q1 = q1 * q1;
    const q2q2 = q2 * q2;
    const q3q3 = q3 * q3;
    let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
    let s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
    let s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
    let s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;
    const sn = Math.hypot(s0, s1, s2, s3);
    if (sn > 0) {
      s0 /= sn;
      s1 /= sn;
      s2 /= sn;
      s3 /= sn;
      qd0 -= beta * s0;
      qd1 -= beta * s1;
      qd2 -= beta * s2;
      qd3 -= beta * s3;
    }
  }
  return qNormalize([q0 + qd0 * dt, q1 + qd1 * dt, q2 + qd2 * dt, q3 + qd3 * dt]);
}

/**
 * Run the filter over a series. gyroDps in °/s (bias already removed), acc in g, t in seconds.
 * Initial orientation from the first accelerometer sample (heading 0). A gap > 0.5 s restarts from gravity, as in
 * the existing pipeline; the restart indices are returned so that heading-dependent quantities can be invalidated.
 */
export function madgwickSeries(t: readonly number[], gyroDps: readonly Vec3[], acc: readonly Vec3[], beta = MADGWICK_BETA, rateHz = 100): { q: Quat[]; restarts: number[] } {
  const out: Quat[] = [];
  const restarts: number[] = [];
  let q: Quat | null = null;
  const k = Math.PI / 180;
  for (let i = 0; i < t.length; i++) {
    const g = gyroDps[i] as Vec3;
    const a = acc[i] as Vec3;
    const dt = i === 0 ? 1 / rateHz : (t[i] as number) - (t[i - 1] as number);
    if (!q || dt > 0.5 || dt <= 0) {
      q = qFromGravity(a);
      restarts.push(i);
    } else q = madgwickStep(q, [g[0] * k, g[1] * k, g[2] * k], a, dt, beta);
    out.push(q);
  }
  return { q: out, restarts };
}
