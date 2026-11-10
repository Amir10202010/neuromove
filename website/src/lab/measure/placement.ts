// Sensor placement: what a recording itself can tell about how the sensors were strapped on, what it cannot, and
// how much a different placement can change each metric.
//
// Three facts drive this module (shown by the re-attachment study below and in research/SCIENTIFIC_VALIDATION.md):
//   1. Calibration-referenced quantities (segment inclination, angular-rate norms, durations) are INVARIANT to any
//      fixed rotation of the sensor on the limb: the reference direction is recorded in the same rotated frame.
//   2. Quantities that use a sensor AXIS by convention are not: elbow flexion (hinge axis = upper-arm sensor Z) and the
//      trunk pitch/roll split (forward = trunk sensor Z).
//   3. A calibration POSTURE that is not reproduced (arm not hanging the same way) shifts every calibration-referenced
//      angle by about the posture difference — and the sensors cannot tell posture from mount tilt.
// So the recording yields bounds, not corrections: nothing here "normalises" a session to hide placement uncertainty.
//
// Observable per recording (mountDiagnostics):
//   tiltDeg          angle of the calibration "up" direction from the nominal −X axis: mount tilt + posture, confounded
//   functional axis  dominant rotation axis of the moving segment in its sensor frame during the outbound phase;
//                    its deviation from the axis the mount rule predicts = rotation of the sensor about the bone
//                    + out-of-plane movement, confounded
// Between two recordings (comparePlacement): how far these moved. That difference bounds the placement-induced bias.

import { toPhysical } from '../../core/imu';
import { INT16_MAX } from '../../core/imu';
import type { Placement, RawFrame, Side } from '../../devices/types';
import { DEG, applyT, type Mat3, type Vec3 } from '../../lib/vec3';
import type { ChannelSet } from '../coord/channels';
import { DEFAULT_DISSOCIATION, REPLACEMENT_MARGIN_DEG } from '../coord/dissociation';
import type { SensorRole } from './registry';
import type { RepFeatureRecord } from './repFeatures';

// ── virtual re-mounting ───────────────────────────────────────────────────────────────────────────────────

/**
 * The same movement as it would have been recorded with one sensor strapped on rotated by R (columns of R = the
 * axes of the rotated sensor expressed in the nominal sensor frame). Exact for a rotation: a rotated rigid sensor at
 * the same place measures Rᵀ·(acc, gyro). Re-quantised to int16 with range clipping, as the real sensor would.
 */
export function virtualRemount(frames: readonly RawFrame[], placement: Placement, R: Mat3): RawFrame[] {
  const q = (v: number) => Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, Math.round(v)));
  return frames.map((f) => {
    const raw = f.data[placement];
    if (!raw) return f;
    const a = applyT(R, [raw[0] as number, raw[1] as number, raw[2] as number]);
    const g = applyT(R, [raw[3] as number, raw[4] as number, raw[5] as number]);
    return { ...f, data: { ...f.data, [placement]: Int16Array.from([q(a[0]), q(a[1]), q(a[2]), q(g[0]), q(g[1]), q(g[2])]) } };
  });
}

// ── what one recording shows about its mount ──────────────────────────────────────────────────────────────

export interface FunctionalAxis {
  /** Unit vector in the sensor frame, signed like the mean angular velocity of the outbound phase. */
  axis: Vec3;
  /** Axis predicted by the mount rule for this exercise and side. */
  expected: Vec3;
  /** Angle between them, degrees. */
  deviationDeg: number;
  /** Share of the angular-rate energy along the axis (1 = pure single-axis rotation). */
  planarity: number;
  repetitions: number;
}

export interface SensorMount {
  role: SensorRole;
  placement: Placement;
  /** Calibration "up" in the sensor frame (unit vector). */
  up: Vec3;
  /** Angle of `up` from the nominal −X: mount tilt and calibration posture together. */
  tiltDeg: number;
  functionalAxis: FunctionalAxis | null;
}

export interface MountDiagnostics {
  recordingId: string;
  exercise: string;
  side: Side;
  calibration: ChannelSet['calibration']['source'];
  sensors: SensorMount[];
  notes: string[];
}

/** Rotation axis (sensor frame) the mount rule predicts for the segment that moves in each exercise. */
export function expectedAxis(exercise: string, side: Side): { role: SensorRole; axis: Vec3 } | null {
  const s = side === 'right' ? 1 : -1;
  // COORDINATES.md §2 / simulation/kinematics.ts: flexion turns the arm about the sensor's Z (outwards) axis,
  // signed by side; abduction about −Y; elbow flexion turns the forearm about its own Z, signed by side.
  if (exercise === 'shoulder_flexion') return { role: 'upper', axis: [0, 0, s] };
  if (exercise === 'shoulder_abduction') return { role: 'upper', axis: [0, -1, 0] };
  if (exercise === 'elbow_flexion') return { role: 'fore', axis: [0, 0, s] };
  return null;
}

/** Principal eigenvector of a symmetric 3 × 3 matrix by power iteration (the matrix is a sum of outer products). */
function principalAxis(M: number[][]): { v: Vec3; share: number } | null {
  const tr = (M[0]![0] as number) + (M[1]![1] as number) + (M[2]![2] as number);
  if (!(tr > 0)) return null;
  let v: Vec3 = [1, 1, 1];
  for (let it = 0; it < 200; it++) {
    const w: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w[i] = (w[i] as number) + (M[i]![j] as number) * (v[j] as number);
    const n = Math.hypot(w[0], w[1], w[2]);
    if (!(n > 0)) return null;
    const nv: Vec3 = [w[0] / n, w[1] / n, w[2] / n];
    const d = Math.abs(nv[0] - v[0]) + Math.abs(nv[1] - v[1]) + Math.abs(nv[2] - v[2]);
    v = nv;
    if (d < 1e-12) break;
  }
  let lam = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) lam += (v[i] as number) * (M[i]![j] as number) * (v[j] as number);
  return { v, share: lam / tr };
}

const angleDeg = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;

/** Minimum outbound repetitions and minimum planarity for a functional axis to be reported. */
export const AXIS_RULE = { minReps: 3, minPlanarity: 0.9 } as const;

export function mountDiagnostics(frames: readonly RawFrame[], cs: ChannelSet, reps: readonly RepFeatureRecord[], exercise: string): MountDiagnostics {
  const notes: string[] = [];
  const exp = expectedAxis(exercise, cs.meta.side);
  const sensors: SensorMount[] = [];
  for (const role of ['trunk', 'upper', 'fore'] as const) {
    const p = cs.placements[role];
    const up = p ? cs.calibration.up[p] : undefined;
    if (!p || !up) continue;
    let fa: FunctionalAxis | null = null;
    if (exp && exp.role === role) {
      const bias = cs.calibration.biasDps[p] ?? [0, 0, 0];
      const M = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const sum: Vec3 = [0, 0, 0];
      let used = 0;
      for (const r of reps) {
        const a = r.rep.onset?.i;
        const b = r.rep.arrival?.i;
        if (a === undefined || b === undefined) continue;
        used++;
        for (let i = a; i <= b; i++) {
          const raw = (frames[i] as RawFrame | undefined)?.data[p];
          if (!raw) continue;
          const g = toPhysical(raw, bias, cs.meta.accCal?.[p]).gyro;
          for (let x = 0; x < 3; x++) {
            sum[x] = (sum[x] as number) + (g[x] as number);
            for (let y = 0; y < 3; y++) M[x]![y] = (M[x]![y] as number) + (g[x] as number) * (g[y] as number);
          }
        }
      }
      const pa = principalAxis(M);
      if (pa && used >= AXIS_RULE.minReps && pa.share >= AXIS_RULE.minPlanarity) {
        const sgn = pa.v[0] * sum[0] + pa.v[1] * sum[1] + pa.v[2] * sum[2] < 0 ? -1 : 1;
        const axis: Vec3 = [sgn * pa.v[0], sgn * pa.v[1], sgn * pa.v[2]];
        fa = { axis, expected: exp.axis, deviationDeg: angleDeg(axis, exp.axis), planarity: pa.share, repetitions: used };
      } else if (used < AXIS_RULE.minReps) notes.push(`functional_axis_needs_${AXIS_RULE.minReps}_repetitions_(has_${used})`);
      else notes.push('movement_not_about_one_axis:_functional_axis_not_reported');
    }
    sensors.push({ role, placement: p, up, tiltDeg: angleDeg(up, [-1, 0, 0]), functionalAxis: fa });
  }
  if (cs.calibration.source === 'none') notes.push('no_calibration_window');
  if (!sensors.some((s) => s.role === 'trunk')) notes.push('no_trunk_sensor');
  // A rotation of the trunk sensor about the vertical changes neither its calibration "up" nor (the trunk barely
  // moving) any functional axis: it is not observable from the recording.
  notes.push('trunk_sensor_rotation_about_the_vertical_is_not_observable');
  return { recordingId: cs.meta.id, exercise, side: cs.meta.side, calibration: cs.calibration.source, sensors, notes };
}

// ── placement confidence ──────────────────────────────────────────────────────────────────────────────────

/**
 * How far a re-attachment moves the quantities that are NOT invariant to it. MEASURED by reattachmentStudy()
 * (measure/reattachment.ts) through the app's IMU measurement model on synthetic shoulder flexion / abduction to
 * ≈ 120° (experiments M2–M4, research/data/measurement-validation.json, 2026-11-10) and copied here;
 * measure.node.test.ts recomputes them and fails if they no longer bound the measured values.
 *
 *   M3  calibration posture: calibration-referenced angles and excursions shift by 0.9–1.4° per degree of posture
 *       difference (in the movement plane ≈ 1.1, out of plane up to 1.4 for excursions) — the upper bound is used.
 *   M2  elbow flexion: 95th percentile over 144 repetitions (12 movement seeds, 20261110…21) of the excursion error
 *       when the upper-arm sensor is rotated about the bone (the assumed hinge axis turns with it). Strongly
 *       non-linear and heavy-tailed: single repetitions reached 6° at 10° and 16° at 20°. Confirmed on 144
 *       repetitions of disjoint seeds (benchmark M2b).
 *   M2  trunk pitch/roll split: a rotation ψ of the trunk sensor about the vertical leaks sin ψ of the pitch
 *       excursion into roll (measured 0.16° per degree at ≈ 18° of pitch) — NOT observable from a recording.
 *   M4  moving a sensor 4 cm along the bone changed no angle by more than 0.3° (elbow 0.8°): negligible next to M3.
 *   Everything else (segment inclination, rates, durations, smoothness, onset lags) is invariant to rotation.
 */
export const REATTACHMENT_SENSITIVITY = {
  anglePerPostureDeg: 1.4,
  /** [upper-arm sensor rotation about the bone °, 95th percentile of the elbow excursion error °]. */
  elbowP95ErrorByAxialDeg: [
    [2, 0.38],
    [5, 1.04],
    [10, 4.05],
    [20, 13.0],
  ],
} as const;

/** 95th-percentile elbow-flexion excursion error for a given rotation of the upper-arm sensor about the bone (interpolated). */
export function elbowErrorBound(axialDeg: number): number {
  const t = REATTACHMENT_SENSITIVITY.elbowP95ErrorByAxialDeg;
  const x = Math.abs(axialDeg);
  let x0 = 0;
  let y0 = 0;
  for (const [x1, y1] of t) {
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    x0 = x1;
    y0 = y1;
  }
  const [xa, ya] = t[t.length - 2] as readonly [number, number];
  return y0 + ((x - x0) * (y0 - ya)) / (x0 - xa);
}

export type PlacementLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface PlacementConfidence {
  level: PlacementLevel;
  reference: string | null;
  sensors: {
    role: SensorRole;
    /** Angle between the calibration "up" directions of the two recordings in the sensor frame, degrees. */
    deltaTiltDeg: number | null;
    /** Angle between the functional axes, degrees (null when either is missing). */
    deltaAxisDeg: number | null;
  }[];
  /** Worst-case bias each difference could cause, in the units of the affected quantity. */
  expectedBias: { quantity: string; value: number; unit: string; basis: string }[];
  reasons: string[];
}

/** Thresholds are the engine's existing margins — no new constant: re-placement margin (2.5°) and equivalence margin (5°). */
export const PLACEMENT_RULE = { highDeg: REPLACEMENT_MARGIN_DEG, mediumDeg: DEFAULT_DISSOCIATION.marginDeg } as const;

export function comparePlacement(reference: MountDiagnostics | null, current: MountDiagnostics): PlacementConfidence {
  const reasons: string[] = [];
  if (!reference) {
    return { level: 'unknown', reference: null, sensors: current.sensors.map((s) => ({ role: s.role, deltaTiltDeg: null, deltaAxisDeg: null })), expectedBias: [], reasons: ['no_reference_recording:_placement_can_only_be_compared_between_recordings'] };
  }
  if (reference.side !== current.side) reasons.push('different_arm:_placement_not_comparable');
  const sensors = current.sensors.map((s) => {
    const r = reference.sensors.find((x) => x.role === s.role);
    const sameTask = reference.exercise === current.exercise;
    return {
      role: s.role,
      deltaTiltDeg: r ? angleDeg(r.up, s.up) : null,
      deltaAxisDeg: r && sameTask && r.functionalAxis && s.functionalAxis ? angleDeg(r.functionalAxis.axis, s.functionalAxis.axis) : null,
    };
  });
  const expectedBias: PlacementConfidence['expectedBias'] = [];
  let worst = 0;
  let known = false;
  for (const s of sensors) {
    if (s.deltaTiltDeg !== null) {
      known = true;
      const v = REATTACHMENT_SENSITIVITY.anglePerPostureDeg * s.deltaTiltDeg;
      expectedBias.push({ quantity: s.role === 'trunk' ? 'trunk tilt' : `${s.role === 'upper' ? 'upper-arm' : 'forearm'} inclination and range of motion`, value: v, unit: '°', basis: 'if the calibration-pose difference is posture rather than strap tilt (the two cannot be told apart), in-plane angles shift by up to this much' });
      worst = Math.max(worst, v);
    }
    if (s.deltaAxisDeg !== null && s.role === 'upper') {
      const v = elbowErrorBound(s.deltaAxisDeg);
      expectedBias.push({ quantity: 'elbow flexion excursion', value: v, unit: '°', basis: 'if the axis difference is rotation of the upper-arm sensor about the bone rather than a different movement plane' });
      worst = Math.max(worst, v);
    }
  }
  if (!known || reasons.length) return { level: 'unknown', reference: reference.recordingId, sensors, expectedBias, reasons: reasons.length ? reasons : ['no_common_calibrated_sensor'] };
  if (sensors.some((s) => s.deltaAxisDeg === null && s.role !== 'trunk')) reasons.push('functional_axis_not_comparable_(needs_the_same_exercise_with_≥_3_repetitions_in_both_recordings)');
  reasons.push('trunk_sensor_rotation_about_the_vertical_is_not_observable');
  const level: PlacementLevel = worst <= PLACEMENT_RULE.highDeg ? 'high' : worst <= PLACEMENT_RULE.mediumDeg ? 'medium' : 'low';
  if (level !== 'high') reasons.push(`worst_case_bias_${worst.toFixed(1)}°_exceeds_${level === 'medium' ? PLACEMENT_RULE.highDeg : PLACEMENT_RULE.mediumDeg}°`);
  return { level, reference: reference.recordingId, sensors, expectedBias, reasons };
}
