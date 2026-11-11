// Motor Recovery Digital Twin — the layered computational representation of one participant, and an honest label
// of how far it has got.
//
//   1 measurement   what was actually recorded: sessions, raw availability and verification, signal quality
//   2 kinematic     derived quantities per task and metric, each traced to the observability registry
//   3 strategy      movement organisation (needs raw frames; reported as not available otherwise)
//   4 learning      baseline envelope, estimated state, selected model, change detection, what is estimable
//   5 predictive    prediction RECORDS (issued or refused) — never mixed into layers 1–4
//   6 experimental  what hypothetical simulation the fitted models can support — availability only; scenarios are
//                   run in the sandbox and are always labelled hypothetical
//
// Layers 1–2 are observations and deterministic derivations; 3–4 are estimates; 5 predictions; 6 hypotheses. A value
// never moves to a "more certain" layer than the one it was computed in.
//
// Maturity (fixed criteria, evaluated from the data that exist — the software cannot promote itself):
//   0  reproducible measurement representation
//   1  individualised descriptive longitudinal model
//   2  predictive model with evaluated uncertainty and calibration
//   3  research simulation of explicitly defined hypothetical conditions
//   4  clinically validated decision-support system — NEVER attainable by software evidence alone
// A level counts only if every lower level is met. Levels reached on simulated data are marked "synthetic only".

import type { Session } from '../../data/models';
import { isSimulatedSession } from '../../data/models';
import type { PracticeRecord } from '../../rehab/model';
import { wilson } from '../benchmark';
import type { MotorStrategyProfile } from '../coord/profile';
import type { AnalysisConfig, SeriesAnalysis } from '../analysis';
import { DEFAULT_ANALYSIS_CONFIG } from '../analysis';
import type { LearningSeries } from '../dataset';
import { hashOf } from '../hash';
import { assessAgainstEnvelope, buildEnvelope, envelopeInterval, type EnvelopeStatus, BASELINE_SESSIONS } from '../measure/envelope';
import { registryEntry, type ProvenanceLabel } from '../measure/registry';
import type { ModelId } from '../models';
import { detectChange } from '../observatory/changeDetection';
import { assessEstimability, type LearningTerm } from '../observatory/estimability';
import { buildTwin, type MotorTwin } from '../twin';
import { COORD_VERSION, FRONTIER_VERSIONS, LAB_ENGINE_VERSION } from '../version';
import { predictSeries, type PredictionRecord } from './prediction';

export const MATURITY_RULE = { l1MinSessions: 5, l2MinForecasts: 30, l2CoverageLower: 0.8, baselineSessions: BASELINE_SESSIONS } as const;

export interface MaturityLevel {
  level: 0 | 1 | 2 | 3 | 4;
  name: string;
  met: boolean;
  evidence: string[];
  missing: string[];
}

export interface TwinMaturity {
  /** Highest level whose criteria and all lower levels' criteria are met; −1 when not even level 0. */
  level: number;
  levels: MaturityLevel[];
  /** The evidence comes from simulated sessions: the level describes the software, not a real participant. */
  syntheticOnly: boolean;
}

export interface LearningLayerEntry {
  seriesKey: string;
  task: string;
  metric: string;
  unit: string;
  included: number;
  baseline: { status: EnvelopeStatus; sessions: number; centre: number | null; interval: [number, number] | null; latest: { mean: number; outside: boolean; direction: 'above' | 'below' | 'inside' } | null; assumption: string };
  selectedModel: ModelId | null;
  /** Latent state at the last included session with its 95 % band (model estimate). */
  state: { mean: number; lo: number; hi: number } | null;
  detection: { status: string; alarmSession: number | null; corroborated: boolean; pChange: number | null };
  retention: string;
  estimable: LearningTerm[];
  notEstimable: LearningTerm[];
  warnings: string[];
}

export interface TwinLayers {
  participantId: string;
  versions: { engine: string; coord: string; twin: string; measure: string; observatory: string };
  simulated: boolean;
  /** How many items of each provenance class the twin holds — the classes are never merged. */
  provenance: Partial<Record<ProvenanceLabel, number>>;
  measurement: { sessions: number; firstDate: string | null; lastDate: string | null; withRaw: number; rawWithManifest: number; signalBelow90: number; incomplete: number; algorithmVersions: string[]; externalAssessments: number };
  kinematic: { task: string; metric: string; unit: string; registry: string; status: string; sessions: number; latest: { mean: number; n: number } | null }[];
  strategy: { status: 'available' | 'not_available'; reason: string | null; profiles: { recordingId: string; task: string; repetitions: number; placement: string; flags: string[] }[] };
  learning: LearningLayerEntry[];
  predictive: PredictionRecord[];
  experimental: { doseScenarios: boolean; doseScenarioReason: string; designAdvice: boolean; note: string };
  maturity: TwinMaturity;
  /** SHA-256 of the layers without this field: identifies a snapshot. */
  hash: string;
}

export interface LayersInput {
  participantId: string;
  sessions: readonly Session[];
  includeSimulated: boolean;
  practice?: readonly PracticeRecord[];
  /** Number of independently recorded clinical assessments of the participant (manual entries; never computed). */
  externalAssessments?: number;
  config?: AnalysisConfig;
  /** Precomputed twin (per-task analyses), to avoid fitting twice. */
  twin?: MotorTwin;
  profiles?: readonly MotorStrategyProfile[];
  /** Forecast horizon in days (default: the median interval between sessions of each series). */
  horizonDays?: number;
  transferTasks?: readonly string[];
  retentionSessionIds?: readonly string[];
  /** Valid repetitions per stored practice sitting, by task key `exercise:side`. */
  practiceSittings?: Readonly<Record<string, readonly number[]>>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2) : NaN;
};

function learningEntry(series: LearningSeries, a: SeriesAnalysis, family: number, input: LayersInput): LearningLayerEntry {
  const inc = series.sessions.filter((s) => s.included);
  const nb = Math.min(inc.length, MATURITY_RULE.baselineSessions);
  const t0 = inc[0]?.day ?? 0;
  const env = buildEnvelope(inc.slice(0, nb).map((s) => ({ sessionId: s.sessionId, day: s.day - t0, mean: s.mean, n: s.n, ss: s.reps.reduce((q, v) => q + (v - s.mean) ** 2, 0) })));
  const last = inc[inc.length - 1];
  const iv = last ? envelopeInterval(env, last.n) : null;
  const as = last && inc.length > nb ? assessAgainstEnvelope(env, last.mean, last.n) : null;
  const det = detectChange(inc.map((s) => s.mean), { family });
  const row = a.comparison.rows.find((r) => r.model === a.selected);
  const lat = row?.fit.latent;
  const k = lat ? lat.mean.length - 1 : -1;
  const tr = a.trajectory[a.trajectory.length - 1];
  const est = assessEstimability({
    series,
    analysis: a,
    practiceSittings: input.practiceSittings?.[`${series.exercise}:${series.side}`] ?? [],
    practiceLog: series.doseSource === 'practice_records',
    transferTasks: input.transferTasks ?? [],
    retentionSessionIds: input.retentionSessionIds ?? [],
    sessionsWithSeveralConditions: 0,
    externalMdc: (input.config ?? DEFAULT_ANALYSIS_CONFIG).learning.externalMdc !== null,
    rawAvailable: input.sessions.some((s) => s.patientId === input.participantId && s.hasRaw),
  });
  return {
    seriesKey: series.key,
    task: `${series.exercise}:${series.side}`,
    metric: series.metric,
    unit: series.unit,
    included: inc.length,
    baseline: { status: env.status, sessions: nb, centre: env.sessions ? env.centre : null, interval: iv ? [iv.lo, iv.hi] : null, latest: as && last ? { mean: last.mean, outside: as.outside, direction: as.direction } : null, assumption: `the first ${nb} included sessions are taken as the baseline (no protocol designates one)` },
    selectedModel: a.selected,
    state: lat && k >= 0 && tr ? { mean: lat.mean[k] as number, lo: tr.lo, hi: tr.hi } : null,
    detection: { status: det.status, alarmSession: det.cusum.alarmAt, corroborated: det.corroborated, pChange: det.bayes ? det.bayes.pChange : null },
    retention: a.retention.status,
    estimable: est.filter((e) => e.status === 'estimable').map((e) => e.term),
    notEstimable: est.filter((e) => e.status === 'not_estimable').map((e) => e.term),
    warnings: [...a.warnings],
  };
}

export function assessMaturity(o: { sessions: number; simulated: boolean; learning: readonly LearningLayerEntry[]; predictive: readonly PredictionRecord[]; doseModelSupported: boolean }): TwinMaturity {
  const levels: MaturityLevel[] = [];
  // 0
  levels.push({
    level: 0, name: 'Reproducible measurement representation', met: o.sessions >= 1,
    evidence: o.sessions ? [`${o.sessions} session(s), each with its algorithm and app version; analyses are deterministic and hashed`] : [],
    missing: o.sessions ? [] : ['at least one recorded sensor session'],
  });
  // 1
  const described = o.learning.filter((l) => l.included >= MATURITY_RULE.l1MinSessions && l.selectedModel !== null && (l.baseline.status === 'usable' || l.baseline.status === 'provisional'));
  levels.push({
    level: 1, name: 'Individualised descriptive longitudinal model', met: described.length > 0,
    evidence: described.length ? [`${described.length} series with ≥ ${MATURITY_RULE.l1MinSessions} sessions, a fitted model selected against "no change", and a stable individual baseline`] : [],
    missing: described.length ? [] : [`a series with at least ${MATURITY_RULE.l1MinSessions} included sessions, a selected model and a stable baseline`],
  });
  // 2
  const issued = o.predictive.filter((p) => p.calibration.status === 'evaluated');
  const folds = issued.reduce((a, p) => a + p.calibration.folds, 0);
  const inside = issued.reduce((a, p) => a + Math.round((p.calibration.coverage95 ?? 0) * p.calibration.folds), 0);
  const ci = folds ? wilson(inside, folds) : null;
  const calibrated = folds >= MATURITY_RULE.l2MinForecasts && ci !== null && ci[0] >= MATURITY_RULE.l2CoverageLower && ci[1] >= 0.95;
  const m2: string[] = [];
  if (folds < MATURITY_RULE.l2MinForecasts) m2.push(`at least ${MATURITY_RULE.l2MinForecasts} out-of-sample forecasts of this participant (has ${folds})`);
  else if (!calibrated) m2.push(`coverage of the 95 % intervals compatible with 0.95 (observed ${(inside / folds).toFixed(2)}, 95 % CI ${ci ? `[${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}]` : 'n/a'}; the lower bound must reach ${MATURITY_RULE.l2CoverageLower})`);
  if (o.simulated) m2.push('evaluation on REAL sessions (these are simulated)');
  levels.push({
    level: 2, name: 'Predictive model with evaluated uncertainty and calibration', met: calibrated,
    evidence: folds ? [`${folds} leave-future-out forecasts, ${inside} inside their 95 % interval${ci ? ` (coverage 95 % CI [${ci[0].toFixed(2)}, ${ci[1].toFixed(2)}])` : ''}`] : [],
    missing: m2,
  });
  // 3
  levels.push({
    level: 3, name: 'Research simulation of explicitly defined hypothetical conditions', met: o.doseModelSupported,
    evidence: o.doseModelSupported ? ['a dose–response model with identifiable parameters is supported against saturation for at least one series: schedule scenarios have a fitted basis (still hypothetical)'] : [],
    missing: o.doseModelSupported ? [] : ['a dose–response model whose parameters are identifiable and supported by the data (needs a practice log, breaks of different length or varying dose)'],
  });
  // 4
  levels.push({
    level: 4, name: 'Clinically validated decision-support system', met: false, evidence: [],
    missing: ['prospective validation against independently measured functional outcomes in the target population', 'a documented positive ethics decision and study approval', 'regulatory assessment as clinical decision-support software', 'this level cannot be reached by software evidence — and closed-loop or autonomous treatment selection is outside NeuroMove\'s scope'],
  });
  let level = -1;
  for (const l of levels) {
    if (!l.met) break;
    level = l.level;
  }
  return { level, levels, syntheticOnly: o.simulated };
}

export function buildLayers(input: LayersInput): TwinLayers {
  const cfg = input.config ?? DEFAULT_ANALYSIS_CONFIG;
  const twin = input.twin ?? buildTwin(input.participantId, input.sessions, { includeSimulated: input.includeSimulated, practice: input.practice ?? [], config: cfg, metrics: ['rom'] });
  const mine = input.sessions.filter((s) => s.patientId === input.participantId && (input.includeSimulated || !isSimulatedSession(s))).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const simulated = mine.some((s) => isSimulatedSession(s));
  const pairs = twin.tasks.flatMap((t) => t.series.map((s, i) => ({ series: s, analysis: t.analyses[i] as SeriesAnalysis })));
  const family = Math.max(1, pairs.length);
  const learning = pairs.map((p) => learningEntry(p.series, p.analysis, family, input));
  const predictive: PredictionRecord[] = [];
  for (const p of pairs) {
    const inc = p.series.sessions.filter((s) => s.included);
    const gaps = inc.slice(1).map((s, i) => s.day - (inc[i] as { day: number }).day);
    const horizon = input.horizonDays ?? (gaps.length ? median(gaps) : 7);
    const noExclusions = Object.keys(cfg.excluded).length === 0;
    predictive.push(predictSeries(p.series, { horizonDays: horizon > 0 ? horizon : 7, repetitions: cfg.forecastRepetitions, doseMode: p.analysis.doseMode, models: cfg.models, seed: cfg.seed, ...(noExclusions ? { comparison: p.analysis.comparison } : {}) }));
  }
  const kinematic = pairs.map((p) => {
    const inc = p.series.sessions.filter((s) => s.included);
    const last = inc[inc.length - 1];
    const reg = registryEntry(`metric.${p.series.metric}`);
    return { task: `${p.series.exercise}:${p.series.side}`, metric: p.series.metric, unit: p.series.unit, registry: reg?.id ?? `metric.${p.series.metric}`, status: reg?.status ?? 'derived', sessions: inc.length, latest: last ? { mean: last.mean, n: last.n } : null };
  });
  const profiles = input.profiles ?? [];
  const doseModelSupported = pairs.some((p) => {
    const lr = p.analysis.comparison.rows.find((r) => r.model === 'learning_retention');
    return p.analysis.retention.status === 'supported' && !!lr && lr.fit.status === 'ok' && lr.fit.identifiable && p.series.doseSource === 'practice_records';
  });
  const maturity = assessMaturity({ sessions: mine.length, simulated, learning, predictive, doseModelSupported });
  const prov: Partial<Record<ProvenanceLabel, number>> = {};
  const bump = (k: ProvenanceLabel, n: number) => {
    if (n > 0) prov[k] = (prov[k] ?? 0) + n;
  };
  bump(simulated ? 'synthetic_simulation' : 'real_measurement', mine.length);
  bump('external_assessment', input.externalAssessments ?? 0);
  bump('manual_entry', (input.practice ?? []).filter((r) => r.participantId === input.participantId).length);
  if (!simulated) {
    bump('model_estimate', learning.filter((l) => l.state !== null).length);
    bump('model_prediction', predictive.filter((p) => p.status === 'issued').length);
  }
  const body: Omit<TwinLayers, 'hash'> = {
    participantId: input.participantId,
    versions: { engine: LAB_ENGINE_VERSION, coord: COORD_VERSION, twin: FRONTIER_VERSIONS.twin, measure: FRONTIER_VERSIONS.measure, observatory: FRONTIER_VERSIONS.observatory },
    simulated,
    provenance: prov,
    measurement: {
      sessions: mine.length,
      firstDate: mine[0]?.startedAt ?? null,
      lastDate: mine[mine.length - 1]?.startedAt ?? null,
      withRaw: mine.filter((s) => s.hasRaw).length,
      rawWithManifest: mine.filter((s) => s.hasRaw && s.rawManifest).length,
      signalBelow90: mine.filter((s) => !(s.quality.percent >= 90)).length,
      incomplete: mine.filter((s) => s.status !== 'completed').length,
      algorithmVersions: [...new Set(mine.map((s) => s.algorithmVersion))],
      externalAssessments: input.externalAssessments ?? 0,
    },
    kinematic,
    strategy: profiles.length
      ? { status: 'available', reason: null, profiles: profiles.map((p) => ({ recordingId: p.recordingId, task: `${p.task.exercise}:${p.task.side}`, repetitions: p.repetitions, placement: p.placement?.level ?? 'unknown', flags: p.quality.flags })) }
      : { status: 'not_available', reason: mine.some((s) => s.hasRaw) ? 'raw frames exist but no strategy profile was computed (open the Strategy Atlas)' : 'no session of this participant has raw 100 Hz frames — movement organisation cannot be derived from stored summaries', profiles: [] },
    learning,
    predictive,
    experimental: {
      doseScenarios: doseModelSupported,
      doseScenarioReason: doseModelSupported ? 'a supported, identifiable dose–response model exists' : 'no supported dose–response model: schedule scenarios would rest on an assumption, not on a fit',
      designAdvice: pairs.some((p) => p.analysis.selected !== null && p.analysis.selected !== 'stationary' && p.analysis.selected !== 'local_level'),
      note: 'scenarios are hypothetical model consequences, never recommendations and never evidence that a schedule works',
    },
    maturity,
  };
  return { ...body, hash: hashOf(body) };
}
