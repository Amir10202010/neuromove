// What the CURRENT hardware configuration can measure.
//
// Physical setup (hardware frozen, see docs/research/ENGINEERING_REPORT.md, "Hardware scope"): one ESP32 + three MPU-6050
// modules (accelerometer + gyroscope, no magnetometer), streamed as imu-csv v1 at the rate in the device
// passport. The existing firmware names placements trunk / upper_l|r / fore_l|r; with three modules the
// operator wears trunk + upper + forearm of ONE arm (or a single module for the single-sensor test).
//
// Measurements are "operational" only when the existing pipeline (core/pipeline.ts) computes them AND
// the needed placements can be worn with three modules. Everything else is a software-level definition
// for the future and is shown as unavailable — never as a working measurement.

import { EXERCISES, type ExerciseId } from '../core/exercises';
import { placementOf, type Placement, type Side } from '../devices/types';
import type { BodyRegion } from './model';

export interface MeasurementCapability {
  id: string;
  region: BodyRegion;
  joint: string;
  movement: string;
  /** Software angle definition when operational. */
  exercise: ExerciseId | null;
  /** Placements needed (for one side). */
  placements: (side: Side) => Placement[];
  status: 'operational' | 'experimental' | 'future';
  /** Why it is not operational / what limits it. */
  limitation: string;
}

const NO_MAG = 'MPU-6050 has no magnetometer: heading (yaw) is not observable and integrates gyro drift.';

export const CAPABILITIES: MeasurementCapability[] = [
  {
    id: 'shoulder_flexion',
    region: 'upper_limb',
    joint: 'shoulder',
    movement: 'flexion (arm elevation, sagittal)',
    exercise: 'shoulder_flexion',
    placements: (s) => [placementOf('upper', s), 'trunk'],
    status: 'operational',
    limitation: 'Elevation of the upper-arm sensor from its calibrated hanging pose (gravity-referenced). Plane of elevation is not separated from abduction. ' + NO_MAG,
  },
  {
    id: 'shoulder_abduction',
    region: 'upper_limb',
    joint: 'shoulder',
    movement: 'abduction (arm elevation, frontal)',
    exercise: 'shoulder_abduction',
    placements: (s) => [placementOf('upper', s), 'trunk'],
    status: 'operational',
    limitation: 'Same elevation angle as flexion; the protocol defines the plane, the sensor does not verify it.',
  },
  {
    id: 'elbow_flexion',
    region: 'upper_limb',
    joint: 'elbow',
    movement: 'flexion / extension',
    exercise: 'elbow_flexion',
    placements: (s) => [placementOf('upper', s), placementOf('fore', s)],
    status: 'operational',
    limitation: 'Relative upper-arm → forearm angle in the hinge plane from the stand-still calibration. Not an anatomically validated joint angle until compared against a goniometer (this module).',
  },
  {
    id: 'forearm_rotation',
    region: 'upper_limb',
    joint: 'forearm',
    movement: 'pronation / supination',
    exercise: 'forearm_rotation',
    placements: (s) => [placementOf('fore', s)],
    status: 'experimental',
    limitation: 'Roll of the forearm sensor about its long axis, measurable only with the forearm horizontal (gravity reference). ' + NO_MAG,
  },
  {
    id: 'knee_flexion',
    region: 'lower_limb',
    joint: 'knee',
    movement: 'flexion (thigh → shank)',
    exercise: null,
    placements: () => [],
    status: 'future',
    limitation: 'Needs a thigh/shank placement definition in firmware passport + a validated segment calibration. Firmware names only upper-limb placements today.',
  },
  {
    id: 'hip_flexion',
    region: 'lower_limb',
    joint: 'hip',
    movement: 'flexion (pelvis → thigh)',
    exercise: null,
    placements: () => [],
    status: 'future',
    limitation: 'Needs pelvis + thigh placements and segment calibration; not supported by the current placement contract.',
  },
  {
    id: 'ankle_dorsiflexion',
    region: 'lower_limb',
    joint: 'ankle',
    movement: 'dorsiflexion / plantarflexion (shank → foot)',
    exercise: null,
    placements: () => [],
    status: 'future',
    limitation: 'Needs shank + foot placements; foot sensor mounting not defined.',
  },
  {
    id: 'trunk_inclination',
    region: 'trunk',
    joint: 'trunk',
    movement: 'inclination (compensation)',
    exercise: null,
    placements: () => ['trunk'],
    status: 'experimental',
    limitation: 'Computed by the existing engine as compensation during arm tests; not offered as a stand-alone validated measurement yet.',
  },
];

/** Exercises selectable in a validation protocol (operational or experimental, i.e. computed today). */
export const VALIDATION_EXERCISES: ExerciseId[] = CAPABILITIES.filter((c) => c.exercise && c.status !== 'future').map((c) => c.exercise as ExerciseId);

export function capabilityOf(exercise: ExerciseId): MeasurementCapability {
  return CAPABILITIES.find((c) => c.exercise === exercise) as MeasurementCapability;
}

/** Placements that must stream for a validation session (no trunk needed for the joint angle itself). */
export function requiredForValidation(exercise: ExerciseId, side: Side): Placement[] {
  const def = EXERCISES[exercise];
  if (def.angle === 'elbow') return [placementOf('upper', side), placementOf('fore', side)];
  if (def.angle === 'rotation') return [placementOf('fore', side)];
  return [placementOf('upper', side)];
}
