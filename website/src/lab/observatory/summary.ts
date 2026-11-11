// One-call summary of the Learning Observatory for a series: what the workspace shows, assembled from the engine
// pieces so that the page computes nothing itself and the assembly is unit-tested.
//
//   change detection          self-starting CUSUM / EWMA / Shewhart + Bayesian change point (changeDetection.ts)
//   personal envelope         the first sessions as baseline, the latest session against it (measure/envelope.ts)
//   within-session dynamics   the latest sitting with enough repetitions (withinSession.ts)
//   estimability              which learning terms these data can and cannot separate (estimability.ts)
//   competing explanations    for the latest session's difference from baseline (discovery/explanations.ts)
//   falsification             attempts to break a signalled change (discovery/explanations.ts)
//   planning                  what more repetitions or more sessions would buy (design/planning.ts)
//
// Baseline rule: the first BASELINE_SESSIONS included sessions (the same assumption as the twin's learning layer —
// no protocol designates a baseline yet). It is stated wherever the envelope is shown.

import type { Session } from '../../data/models';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG, type AnalysisConfig, type SeriesAnalysis } from '../analysis';
import type { LearningSeries, SessionObservation } from '../dataset';
import { allocation, repetitionsWorthAdding, type Allocation, type RepetitionAdvice } from '../design/planning';
import { competingExplanations, falsifyChange, type ExplanationReport, type FalsificationReport } from '../discovery/explanations';
import { assessAgainstEnvelope, BASELINE_SESSIONS, buildEnvelope, envelopeInterval, type EnvelopeAssessment, type EnvelopeInterval, type MeasurementEnvelope } from '../measure/envelope';
import { comparability, contextOfSession } from '../tasks/library';
import { detectChange, type ChangeDetection } from './changeDetection';
import { assessEstimability, type TermEstimability } from './estimability';
import { transferMatrix, type TransferMatrix } from './transfer';
import { sittingDynamics, WITHIN_RULE, type SittingDynamics, type WithinFeature } from './withinSession';

export { BASELINE_SESSIONS };

/** Which stored metric feeds which within-session feature. */
const WITHIN_METRIC: Record<string, WithinFeature> = { rom: 'amplitude', peak_velocity: 'peak_rate', rep_duration: 'duration', sparc: 'smoothness' };

export interface ObservatorySummary {
  seriesKey: string;
  analysis: SeriesAnalysis;
  included: SessionObservation[];
  detection: ChangeDetection;
  baseline: { sessions: number; envelope: MeasurementEnvelope; interval: EnvelopeInterval | null; latest: EnvelopeAssessment | null };
  sitting: { sessionId: string; repetitions: number; dynamics: SittingDynamics } | null;
  estimability: TermEstimability[];
  explanations: ExplanationReport | null;
  falsification: FalsificationReport | null;
  planning: { repetitions: number; sessions: number; options: Allocation[]; advice: RepetitionAdvice } | null;
}

export interface ObserveInput {
  /** Every series of the participant (the sibling metrics of the same task feed the within-session analysis). */
  all: readonly LearningSeries[];
  sessions: readonly Session[];
  /** Valid repetitions of each stored practice sitting of this task. */
  practiceSittings?: readonly number[];
  /** Number of series examined together (multiplicity of the change detection). */
  family?: number;
  config?: AnalysisConfig;
}

const ssOf = (s: SessionObservation) => s.reps.reduce((q, v) => q + (v - s.mean) ** 2, 0);

export function observeSeries(series: LearningSeries, input: ObserveInput): ObservatorySummary {
  const cfg = { ...(input.config ?? DEFAULT_ANALYSIS_CONFIG), bootstrap: 0 };
  const analysis = analyzeSeries(series, cfg);
  const inc = series.sessions.filter((s) => s.included);
  const detection = detectChange(inc.map((s) => s.mean), { family: input.family ?? 1 });

  const nb = Math.min(inc.length, BASELINE_SESSIONS);
  const t0 = inc[0]?.day ?? 0;
  const envelope = buildEnvelope(inc.slice(0, nb).map((s) => ({ sessionId: s.sessionId, day: s.day - t0, mean: s.mean, n: s.n, ss: ssOf(s) })));
  const last = inc[inc.length - 1];
  const beyond = last && inc.length > nb ? last : null;
  const interval = last ? envelopeInterval(envelope, last.n) : null;
  const latest = beyond ? assessAgainstEnvelope(envelope, beyond.mean, beyond.n) : null;

  // the latest sitting that has enough repetitions for a trend, with the sibling metrics of the same task
  const siblings = input.all.filter((s) => s.participantId === series.participantId && s.exercise === series.exercise && s.side === series.side);
  const candidate = [...inc].reverse().find((s) => s.n >= WITHIN_RULE.minTrend) ?? null;
  let sitting: ObservatorySummary['sitting'] = null;
  if (candidate) {
    const feats: Partial<Record<WithinFeature, readonly number[]>> = {};
    for (const sib of siblings) {
      const f = WITHIN_METRIC[sib.metric];
      const obs = sib.sessions.find((x) => x.sessionId === candidate.sessionId);
      if (f && obs && obs.reps.length >= WITHIN_RULE.minTrend) feats[f] = obs.reps;
    }
    sitting = { sessionId: candidate.sessionId, repetitions: candidate.n, dynamics: sittingDynamics(feats) };
  }

  const estimability = assessEstimability({
    series,
    analysis,
    practiceSittings: input.practiceSittings ?? [],
    practiceLog: series.doseSource === 'practice_records',
    transferTasks: [],
    retentionSessionIds: [],
    sessionsWithSeveralConditions: 0,
    externalMdc: cfg.learning.externalMdc !== null,
    rawAvailable: input.sessions.some((s) => s.patientId === series.participantId && s.hasRaw),
  });

  let explanations: ExplanationReport | null = null;
  if (beyond && latest) {
    const first = inc[0] as SessionObservation;
    const sa = input.sessions.find((s) => s.id === first.sessionId);
    const sb = input.sessions.find((s) => s.id === beyond.sessionId);
    explanations = competingExplanations({
      feature: series.metric,
      unit: series.unit,
      delta: beyond.mean - envelope.centre,
      envelope: latest,
      // stored session aggregates carry no propagated sensor budget and no mount diagnostics: both stay open
      sensorExpandedUncertainty: null,
      placement: null,
      placementBound: null,
      comparability: sa && sb ? comparability(contextOfSession(sa, series.exercise, series.side), contextOfSession(sb, series.exercise, series.side)) : null,
      algorithmVersions: { baseline: first.algorithmVersion, later: beyond.algorithmVersion },
      qualityIssues: beyond.signalPercent < 90 ? ['signal_below_90_percent'] : [],
      amplitudeRelativeChange: null,
      isRatioFeature: false,
      withinSession: sitting && sitting.sessionId === beyond.sessionId ? sitting.dynamics.pattern : null,
      baselineIsFirstSessions: true,
      independentSupport: null,
    });
  }
  const falsification = falsifyChange({ sessions: inc.map((s) => ({ mean: s.mean, reps: s.reps })), sensorExpandedUncertainty: null, independentSupport: null });

  const { sigmaE, sigmaS } = analysis.decomposition;
  const reps = inc.length ? Math.max(1, Math.round(inc.reduce((a, s) => a + s.n, 0) / inc.length)) : 0;
  const planning =
    inc.length >= 2 && Number.isFinite(sigmaE) && Number.isFinite(sigmaS) && reps > 0
      ? {
          repetitions: reps,
          sessions: inc.length,
          options: [...new Set([1, 3, 5, 10, reps])].sort((a, b) => a - b).map((r) => allocation(sigmaE, sigmaS, r, inc.length)),
          advice: repetitionsWorthAdding(sigmaE, sigmaS, reps, inc.length),
        }
      : null;

  return { seriesKey: series.key, analysis, included: inc, detection, baseline: { sessions: nb, envelope, interval, latest }, sitting, estimability, explanations, falsification, planning };
}

/**
 * Task Transfer Matrix of a participant from the first-to-last change of one metric in every task. No task is
 * designated as trained or as a transfer task anywhere in the stored data, so every node is 'undesignated' and the
 * matrix can show co-change only — never transfer (transfer.ts explains why).
 */
export function participantTransfer(all: readonly LearningSeries[], metric: string, config: AnalysisConfig = DEFAULT_ANALYSIS_CONFIG): TransferMatrix {
  const cfg = { ...config, bootstrap: 0 };
  return transferMatrix(
    all
      .filter((s) => s.metric === metric)
      .map((s) => ({ task: `${s.exercise}:${s.side}`, role: 'undesignated' as const, sessions: s.sessions.filter((x) => x.included).length, change: analyzeSeries(s, cfg).decomposition.overall, up: 1 as const })),
  );
}
