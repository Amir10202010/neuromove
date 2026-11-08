// Motor-learning study protocols (Study Designer): versioned, immutable once frozen, with an explicit analysis
// plan fixed before data collection — and a simulation-based power check of the planned schedule.
//
// Stored in the IndexedDB store `lab` (kind 'learning_protocol'). This extends — does not replace — the
// goniometer Protocol Studio (research/protocols.ts) and rehab Studies (rehab/study.ts): those define
// measurement-validation protocols and ethics/enrolment; this defines a learning experiment's design.

import type { ExerciseId } from '../core/exercises';
import { EXERCISE_IDS } from '../core/exercises';
import type { Workspace } from '../data/models';
import { createRng } from '../lib/random';
import { LEARNING_METRICS, type LearningMetric } from './dataset';
import { compareModels } from './fit';
import { hashOf } from './hash';
import { DOSE_MODES, MODEL_IDS, type DoseMode, type ModelId } from './models';
import type { AnalysisConfig } from './analysis';

export const TASK_ROLES = ['trained', 'transfer', 'assessment_only'] as const;
export type TaskRole = (typeof TASK_ROLES)[number];
export const TASK_SIDES = ['left', 'right', 'affected', 'less_affected'] as const;
export type TaskSide = (typeof TASK_SIDES)[number];
export const FEEDBACK_KINDS = ['none', 'knowledge_of_results', 'knowledge_of_performance', 'live_sensor_feedback'] as const;
export const PRACTICE_STRUCTURES = ['constant', 'blocked', 'random'] as const;

export interface LearningProtocolDef {
  title: string;
  researchQuestion: string;
  hypothesis: string;
  eligibility: string;
  exclusionCriteria: string;
  tasks: { exercise: ExerciseId; side: TaskSide; role: TaskRole }[];
  primaryMetric: LearningMetric;
  secondaryMetrics: LearningMetric[];
  sensorConfiguration: string;
  calibration: { standStill: boolean; sixPoseAccelerometer: boolean };
  trial: { repetitionsPerAssessment: number; practiceBlocksPerSession: number; repetitionsPerBlock: number };
  practice: { feedback: (typeof FEEDBACK_KINDS)[number]; feedbackFrequencyPercent: number; structure: (typeof PRACTICE_STRUCTURES)[number]; doseUnit: 'minutes' | 'sessions' };
  schedule: { acquisitionSessions: number; intervalDays: number; retentionDelayDays: number; retentionTests: number };
  transferConditions: string;
  requiredMeasurements: { raw100Hz: boolean; practiceLog: boolean; goniometerReference: boolean };
  analysisPlan: {
    candidateModels: ModelId[];
    doseMode: DoseMode | 'auto';
    /** Smallest change of interest, metric units per week — for the power check. */
    smallestEffectPerWeek: number | null;
    externalMdc: number | null;
    bootstrapReplicates: number;
    notes: string;
  };
}

export interface LearningProtocolVersion {
  id: string;
  kind: 'learning_protocol';
  workspace: Workspace;
  participantId: null;
  /** Stable id across versions. */
  protocolId: string;
  version: number;
  status: 'draft' | 'frozen' | 'archived';
  def: LearningProtocolDef;
  /** SHA-256 of the canonical definition — recorded in every analysis run that uses this version. */
  defHash: string;
  createdAt: string;
  createdBy: string;
}

export function emptyProtocol(): LearningProtocolDef {
  return {
    title: '',
    researchQuestion: '',
    hypothesis: '',
    eligibility: '',
    exclusionCriteria: '',
    tasks: [{ exercise: 'shoulder_flexion', side: 'affected', role: 'trained' }],
    primaryMetric: 'rom',
    secondaryMetrics: ['peak_velocity', 'sparc'],
    sensorConfiguration: '3 × MPU-6050 (trunk, upper arm, forearm), 100 Hz, ±4 g, ±1000 °/s',
    calibration: { standStill: true, sixPoseAccelerometer: false },
    trial: { repetitionsPerAssessment: 3, practiceBlocksPerSession: 0, repetitionsPerBlock: 0 },
    practice: { feedback: 'none', feedbackFrequencyPercent: 0, structure: 'constant', doseUnit: 'minutes' },
    schedule: { acquisitionSessions: 8, intervalDays: 7, retentionDelayDays: 28, retentionTests: 1 },
    transferConditions: '',
    requiredMeasurements: { raw100Hz: true, practiceLog: true, goniometerReference: false },
    analysisPlan: { candidateModels: [...MODEL_IDS], doseMode: 'auto', smallestEffectPerWeek: null, externalMdc: null, bootstrapReplicates: 200, notes: '' },
  };
}

export type ProtocolProblem =
  | 'title_required'
  | 'question_required'
  | 'hypothesis_required'
  | 'task_required'
  | 'duplicate_task'
  | 'primary_metric_invalid'
  | 'repetitions_invalid'
  | 'sessions_invalid'
  | 'interval_invalid'
  | 'retention_delay_not_longer_than_interval'
  | 'no_candidate_model'
  | 'stationary_model_required'
  | 'transfer_needs_trained_task'
  | 'feedback_frequency_invalid'
  | 'dose_mode_invalid';

export function validateProtocol(d: LearningProtocolDef): ProtocolProblem[] {
  const out: ProtocolProblem[] = [];
  if (!d.title.trim()) out.push('title_required');
  if (!d.researchQuestion.trim()) out.push('question_required');
  if (!d.hypothesis.trim()) out.push('hypothesis_required');
  if (!d.tasks.length || d.tasks.some((t) => !EXERCISE_IDS.includes(t.exercise))) out.push('task_required');
  const keys = d.tasks.map((t) => `${t.exercise}:${t.side}`);
  if (new Set(keys).size !== keys.length) out.push('duplicate_task');
  if (!LEARNING_METRICS.includes(d.primaryMetric)) out.push('primary_metric_invalid');
  if (!(Number.isInteger(d.trial.repetitionsPerAssessment) && d.trial.repetitionsPerAssessment >= 1 && d.trial.repetitionsPerAssessment <= 50)) out.push('repetitions_invalid');
  if (!(Number.isInteger(d.schedule.acquisitionSessions) && d.schedule.acquisitionSessions >= 2 && d.schedule.acquisitionSessions <= 200)) out.push('sessions_invalid');
  if (!(d.schedule.intervalDays > 0 && d.schedule.intervalDays <= 365)) out.push('interval_invalid');
  if (d.schedule.retentionTests > 0 && !(d.schedule.retentionDelayDays > d.schedule.intervalDays)) out.push('retention_delay_not_longer_than_interval');
  if (!d.analysisPlan.candidateModels.length) out.push('no_candidate_model');
  // "No detectable change" must always be a possible answer
  if (!d.analysisPlan.candidateModels.includes('stationary')) out.push('stationary_model_required');
  if (d.tasks.some((t) => t.role === 'transfer') && !d.tasks.some((t) => t.role === 'trained')) out.push('transfer_needs_trained_task');
  if (!(d.practice.feedbackFrequencyPercent >= 0 && d.practice.feedbackFrequencyPercent <= 100)) out.push('feedback_frequency_invalid');
  if (d.analysisPlan.doseMode !== 'auto' && !DOSE_MODES.includes(d.analysisPlan.doseMode)) out.push('dose_mode_invalid');
  return out;
}

export function makeVersion(prev: LearningProtocolVersion | null, def: LearningProtocolDef, o: { workspace: Workspace; author: string; now: string; id: string; protocolId?: string }): LearningProtocolVersion {
  return {
    id: o.id,
    kind: 'learning_protocol',
    workspace: o.workspace,
    participantId: null,
    protocolId: prev?.protocolId ?? o.protocolId ?? o.id,
    version: (prev?.version ?? 0) + 1,
    status: 'draft',
    def,
    defHash: hashOf(def),
    createdAt: o.now,
    createdBy: o.author,
  };
}

/** A frozen version can only be archived; its definition never changes (a new version is made instead). */
export function canTransition(from: LearningProtocolVersion['status'], to: LearningProtocolVersion['status']): boolean {
  return (from === 'draft' && (to === 'frozen' || to === 'archived')) || (from === 'frozen' && to === 'archived');
}

/** Same definition hash as stored ⇒ untampered. */
export const protocolIntact = (v: LearningProtocolVersion): boolean => hashOf(v.def) === v.defHash;

// ── simulation-based power of the planned schedule ─────────────────────────────────────────────

export interface PowerPlan {
  effectPerWeek: number;
  sessions: number;
  intervalDays: number;
  repetitions: number;
  sigmaE: number;
  sigmaS: number;
  noiseSource: 'workspace_estimate' | 'assumed';
  seeds: number;
  /** P(selected model ≠ stationary | true linear change of effectPerWeek). */
  power: number;
  /** P(selected model ≠ stationary | no change). */
  falseChange: number;
}

export function planPower(def: LearningProtocolDef, noise: { sigmaE: number; sigmaS: number; source: PowerPlan['noiseSource'] }, seeds = 60): PowerPlan | null {
  const eff = def.analysisPlan.smallestEffectPerWeek;
  if (eff === null || !(Math.abs(eff) > 0)) return null;
  const K = def.schedule.acquisitionSessions;
  const reps = def.trial.repetitionsPerAssessment;
  const t = Array.from({ length: K }, (_, i) => i * def.schedule.intervalDays);
  const models: ModelId[] = def.analysisPlan.candidateModels.filter((m) => m === 'stationary' || m === 'linear' || m === 'local_level');
  const run = (slope: number, seed: number) => {
    const rng = createRng(seed);
    const y: number[] = [];
    const ss: number[] = [];
    t.forEach((x) => {
      const eta = rng.normal(0, noise.sigmaS);
      const r = Array.from({ length: reps }, () => 100 + (slope * x) / 7 + eta + rng.normal(0, noise.sigmaE));
      const m = r.reduce((a, b) => a + b, 0) / reps;
      y.push(m);
      ss.push(r.reduce((a, v) => a + (v - m) ** 2, 0));
    });
    const c = compareModels({ t, y, n: t.map(() => reps), dose: t.map(() => 0), ss, sessionIds: t.map((_, i) => `s${i}`) }, { doseMode: 'per_visit', models: models.length ? models : ['stationary', 'linear'] });
    return c.selected !== null && c.selected !== 'stationary';
  };
  let hit = 0;
  let fp = 0;
  for (let s = 0; s < seeds; s++) {
    if (run(eff, 100 + s)) hit += 1;
    if (run(0, 10_000 + s)) fp += 1;
  }
  return { effectPerWeek: eff, sessions: K, intervalDays: def.schedule.intervalDays, repetitions: reps, sigmaE: noise.sigmaE, sigmaS: noise.sigmaS, noiseSource: noise.source, seeds, power: hit / seeds, falseChange: fp / seeds };
}

// ── protocol → analysis configuration ─────────────────────────────────────────────────────────

/** Concrete sides of a protocol task for one participant (affected / less affected resolved from the profile). */
export function resolveTaskSides(side: TaskSide, affected: 'left' | 'right' | 'both' | 'none'): ('left' | 'right')[] {
  if (side === 'left' || side === 'right') return [side];
  if (affected !== 'left' && affected !== 'right') return []; // ambiguous: not mapped, never guessed
  const other = affected === 'left' ? 'right' : 'left';
  return [side === 'affected' ? affected : other];
}

/** The analysis configuration a frozen protocol pre-specifies (its analysis plan, schedule and task roles). */
export function analysisConfigFromProtocol(v: LearningProtocolVersion, affected: 'left' | 'right' | 'both' | 'none', base: AnalysisConfig): AnalysisConfig {
  const d = v.def;
  const transfer = d.tasks.filter((t) => t.role === 'transfer').flatMap((t) => resolveTaskSides(t.side, affected).map((s) => `${t.exercise}:${s}`));
  return {
    ...base,
    models: [...d.analysisPlan.candidateModels],
    doseMode: d.analysisPlan.doseMode,
    bootstrap: d.analysisPlan.bootstrapReplicates,
    forecastRepetitions: d.trial.repetitionsPerAssessment,
    learning: { ...base.learning, retentionDelayDays: d.schedule.retentionDelayDays, transferTasks: transfer, externalMdc: d.analysisPlan.externalMdc },
  };
}
