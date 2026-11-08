// Computational Motor Twin — an individual, task-specific computational model of observed movement performance
// and its change. Not an avatar, not a model of the nervous system: for each (movement, side, metric) it holds the
// selected longitudinal model, its latent-state estimates, parameters with uncertainty, diagnostics and
// predictions — all traceable to the sessions they came from.

import type { ExerciseId } from '../core/exercises';
import type { Session } from '../data/models';
import type { Side } from '../devices/types';
import type { PracticeRecord } from '../rehab/model';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG, type AnalysisConfig, type SeriesAnalysis } from './analysis';
import { buildParticipantSeries, type LearningMetric, type LearningSeries } from './dataset';
import { LAB_ENGINE_VERSION, LAB_VERSIONS } from './version';

/** What the twin represents and — as important — what it cannot observe (shown on every twin page). */
export const TWIN_SCOPE = {
  represents: [
    'task_performance_state',
    'session_to_session_variability',
    'repetition_variability',
    'change_parameters_with_uncertainty',
    'model_conditional_predictions',
  ],
  cannotObserve: [
    'neural_activity',
    'muscle_activity_and_joint_torques',
    'rotation_about_vertical',
    'absolute_position',
    'daily_life_function',
    'causes_of_change',
  ],
} as const;

export interface TwinTask {
  exercise: ExerciseId;
  side: Side;
  series: LearningSeries[];
  analyses: SeriesAnalysis[];
}

export interface MotorTwin {
  participantId: string;
  engine: string;
  versions: typeof LAB_VERSIONS;
  tasks: TwinTask[];
  simulated: boolean;
  sessions: number;
}

export interface TwinOptions {
  includeSimulated: boolean;
  practice?: readonly PracticeRecord[];
  metrics?: readonly LearningMetric[];
  config?: AnalysisConfig;
  /** Analyse only these tasks (`exercise:side`); default all. */
  tasks?: readonly string[];
}

export function buildTwin(participantId: string, sessions: readonly Session[], o: TwinOptions): MotorTwin {
  const series = buildParticipantSeries(participantId, sessions, { includeSimulated: o.includeSimulated, practice: o.practice ?? [], excluded: o.config?.excluded ?? {} });
  const metrics = o.metrics ?? ['rom'];
  const byTask = new Map<string, TwinTask>();
  for (const s of series) {
    if (!metrics.includes(s.metric)) continue;
    const key = `${s.exercise}:${s.side}`;
    if (o.tasks && !o.tasks.includes(key)) continue;
    let t = byTask.get(key);
    if (!t) {
      t = { exercise: s.exercise, side: s.side, series: [], analyses: [] };
      byTask.set(key, t);
    }
    t.series.push(s);
    t.analyses.push(analyzeSeries(s, o.config ?? DEFAULT_ANALYSIS_CONFIG));
  }
  const mine = sessions.filter((s) => s.patientId === participantId);
  return {
    participantId,
    engine: LAB_ENGINE_VERSION,
    versions: LAB_VERSIONS,
    tasks: [...byTask.values()],
    simulated: mine.some((s) => s.demo || s.device.simulated),
    sessions: mine.length,
  };
}
