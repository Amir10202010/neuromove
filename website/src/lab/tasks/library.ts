// Task framework: movements are studied IN CONTEXT. A task is a movement plus the constraints under which it was
// performed; two measurements may be compared only when every constraint that was not deliberately varied is the
// same. Nothing here is a clinical assessment: the library names research tasks NeuroMove's three IMUs can observe
// (and, explicitly, those they cannot), and never claims equivalence to a standardised test.
//
// What exists in recorded data today:
//   assessment step      exercise × side, self-paced, no target, standard instruction        (Session.steps)
//   practice sitting     exercise × side with a professional-set target angle and live feedback (PracticeTrialSet)
// The other constraint dimensions (speed instruction, object, support, start position) are part of the model so that
// a protocol can declare them; a dimension that was not recorded is `null` ("not recorded"), never assumed equal.

import type { ExerciseId } from '../../core/exercises';
import type { Session } from '../../data/models';
import type { Side } from '../../devices/types';
import type { PracticeTrialSet } from '../records';
import type { SensorRole } from '../measure/registry';

export const CONSTRAINT_DIMENSIONS = ['targetDeg', 'direction', 'distance', 'speed', 'object', 'startPosition', 'support', 'feedback'] as const;
export type ConstraintDimension = (typeof CONSTRAINT_DIMENSIONS)[number];

export type SpeedInstruction = 'self_paced' | 'as_fast_as_possible' | 'slow_and_controlled' | 'accurate';
export type SupportCondition = 'none' | 'trunk_restrained' | 'arm_supported';
export type FeedbackCondition = 'none' | 'live_angle_with_target' | 'knowledge_of_results';

/** `null` = not recorded. A recorded "none" (e.g. no target) is a value, not null. */
export interface TaskConstraints {
  /** Target of the task angle, degrees; 'none' when the movement is to the participant's own maximum. */
  targetDeg: number | 'none' | null;
  direction: 'forward' | 'sideways' | 'upward' | 'to_body' | null;
  /** Target distance as a share of arm length (reaching tasks). */
  distance: number | null;
  speed: SpeedInstruction | null;
  object: string | null;
  startPosition: 'arms_hanging' | 'hand_on_table' | 'forearm_horizontal' | null;
  support: SupportCondition | null;
  feedback: FeedbackCondition | null;
}

export interface TaskContext {
  exercise: string;
  side: Side;
  /** How the recording was made. */
  setting: 'assessment' | 'practice' | 'synthetic';
  protocolId: string | null;
  constraints: TaskConstraints;
}

export const UNRECORDED: TaskConstraints = { targetDeg: null, direction: null, distance: null, speed: null, object: null, startPosition: null, support: null, feedback: null };

const DIRECTION: Record<string, TaskConstraints['direction']> = { shoulder_flexion: 'forward', shoulder_abduction: 'sideways', elbow_flexion: 'to_body' };

/** Context of an assessment step: the clinic test is self-paced, to the child's own maximum, from the calibration pose. */
export function contextOfSession(s: Pick<Session, 'protocolId'>, exercise: ExerciseId, side: Side): TaskContext {
  return {
    exercise,
    side,
    setting: 'assessment',
    protocolId: s.protocolId,
    constraints: { ...UNRECORDED, targetDeg: 'none', direction: DIRECTION[exercise] ?? null, speed: 'self_paced', startPosition: exercise === 'forearm_rotation' ? 'forearm_horizontal' : 'arms_hanging', feedback: 'none' },
  };
}

/** Context of a practice sitting: the same movement towards a target line with live feedback. */
export function contextOfPractice(set: Pick<PracticeTrialSet, 'exercise' | 'side' | 'targetDeg' | 'feedback'>): TaskContext {
  return {
    exercise: set.exercise,
    side: set.side,
    setting: 'practice',
    protocolId: null,
    constraints: { ...UNRECORDED, targetDeg: set.targetDeg ?? 'none', direction: DIRECTION[set.exercise] ?? null, speed: 'self_paced', startPosition: 'arms_hanging', feedback: set.targetDeg === null ? 'none' : set.feedback },
  };
}

export interface Comparability {
  comparable: boolean;
  /** Dimensions whose recorded values differ. */
  differing: ConstraintDimension[];
  /** Dimensions not recorded in at least one of the two: equality cannot be shown. */
  unknown: ConstraintDimension[];
  reasons: string[];
}

/**
 * May two measurements be compared as "the same task"? Only if exercise, side and setting agree and no constraint
 * differs — except those listed in `varied` (the protocol's deliberate manipulation). Unrecorded dimensions are
 * reported; they do not block the comparison but they are named, because they may differ.
 */
export function comparability(a: TaskContext, b: TaskContext, varied: readonly ConstraintDimension[] = []): Comparability {
  const reasons: string[] = [];
  if (a.exercise !== b.exercise) reasons.push('different_movement');
  if (a.side !== b.side) reasons.push('different_arm');
  if (a.setting !== b.setting) reasons.push(`different_setting_(${a.setting}_vs_${b.setting})`);
  const differing: ConstraintDimension[] = [];
  const unknown: ConstraintDimension[] = [];
  for (const d of CONSTRAINT_DIMENSIONS) {
    const x = a.constraints[d];
    const y = b.constraints[d];
    if (x === null || y === null) {
      unknown.push(d);
      continue;
    }
    if (x !== y && !varied.includes(d)) differing.push(d);
  }
  for (const d of differing) reasons.push(`constraint_differs:_${d}`);
  return { comparable: reasons.length === 0, differing, unknown, reasons };
}

/** Stable key of a task condition (movement + every recorded constraint) — groups repetitions by condition. */
export function conditionKey(c: TaskContext): string {
  const k = c.constraints;
  return [c.exercise, c.side, c.setting, ...CONSTRAINT_DIMENSIONS.map((d) => `${d}=${k[d] ?? '?'}`)].join('|');
}

// ── research task library ─────────────────────────────────────────────────────────────────────────────────

export interface TaskDefinition {
  id: string;
  name: string;
  /** Existing pipeline movement that records it, or null when the current sensors/pipeline cannot. */
  exercise: ExerciseId | null;
  sensors: SensorRole[];
  /** What the three IMUs give for this task, and what they do not. */
  observable: string;
  notObservable: string;
  /** Constraint dimensions a protocol may vary for this task (safely, by a professional's decision). */
  variable: ConstraintDimension[];
  status: 'recordable' | 'partially_observable' | 'not_recordable';
  /** Source of the task definition in the literature (keys of research/references.bib); empty = NeuroMove convention. */
  references: string[];
}

/**
 * Tasks for research protocols. "recordable" = the existing pipeline records and segments it. The reach tasks are
 * the ones the paediatric upper-limb literature uses most (51 of 76 instrumented CP studies used reach or
 * reach-to-grasp; Rozaire et al. 2024, rozaire2024) — and exactly the ones whose defining outcome (hand path,
 * endpoint) three segment IMUs cannot observe. That gap is stated, not papered over.
 */
export const TASK_LIBRARY: readonly TaskDefinition[] = [
  { id: 'arm_raise_forward', name: 'Arm raise forward (shoulder flexion)', exercise: 'shoulder_flexion', sensors: ['trunk', 'upper', 'fore'], observable: 'upper-arm and forearm inclination, trunk pitch/roll, elbow flexion, segment rates, phase timing', notObservable: 'plane of elevation, humeral axial rotation angle, hand position', variable: ['targetDeg', 'speed', 'support'], status: 'recordable', references: [] },
  { id: 'arm_raise_sideways', name: 'Arm raise sideways (shoulder abduction)', exercise: 'shoulder_abduction', sensors: ['trunk', 'upper', 'fore'], observable: 'as arm raise forward; elbow flexion NOT observable (hinge axis near vertical)', notObservable: 'elbow flexion, plane of elevation, hand position', variable: ['targetDeg', 'speed', 'support'], status: 'recordable', references: [] },
  { id: 'elbow_flexion_extension', name: 'Elbow flexion and extension, upper arm at the side', exercise: 'elbow_flexion', sensors: ['upper', 'fore'], observable: 'elbow hinge angle, forearm rate, upper-arm lift (protocol check)', notObservable: 'elbow axis itself (assumed), wrist motion', variable: ['targetDeg', 'speed'], status: 'recordable', references: [] },
  { id: 'forearm_rotation', name: 'Forearm pronation and supination, forearm horizontal', exercise: 'forearm_rotation', sensors: ['fore'], observable: 'forearm roll about its long axis from gravity (valid while the forearm is near horizontal)', notObservable: 'rotation when the forearm is near vertical, wrist motion', variable: ['speed'], status: 'recordable', references: [] },
  { id: 'hand_to_shoulder', name: 'Hand to shoulder', exercise: 'elbow_flexion', sensors: ['upper', 'fore'], observable: 'elbow flexion and upper-arm inclination when performed as an elbow-flexion step', notObservable: 'whether the hand reached the shoulder (no hand or contact sensing)', variable: ['speed'], status: 'partially_observable', references: ['rozaire2024'] },
  { id: 'reach_forward', name: 'Reach forward to a target', exercise: null, sensors: ['trunk', 'upper', 'fore'], observable: 'segment inclinations, trunk contribution and timing during the reach if recorded as a free movement', notObservable: 'hand path, straightness, endpoint error — the outcomes that define a reaching task', variable: ['distance', 'direction', 'speed', 'support', 'object'], status: 'not_recordable', references: ['rozaire2024', 'bagesteiro2023'] },
  { id: 'reach_to_grasp', name: 'Reach to grasp', exercise: null, sensors: ['trunk', 'upper', 'fore'], observable: 'as reach forward', notObservable: 'grasp, hand opening, object contact and force', variable: ['distance', 'direction', 'object', 'speed'], status: 'not_recordable', references: ['rozaire2024'] },
  { id: 'object_placement', name: 'Controlled object placement', exercise: null, sensors: ['trunk', 'upper', 'fore'], observable: 'as reach forward', notObservable: 'object position, release, accuracy', variable: ['distance', 'direction', 'object'], status: 'not_recordable', references: [] },
];

export function taskDefinition(id: string): TaskDefinition | null {
  return TASK_LIBRARY.find((t) => t.id === id) ?? null;
}
