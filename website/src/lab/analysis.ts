// One complete, deterministic analysis of one learning series:
//   included observations → model comparison (+ leave-future-out) → selected model → bootstrap → forecasts →
//   learning decomposition → retention evidence → warnings.
// Same input + same configuration + same engine version ⇒ byte-identical output (checked by runs.ts).

import { modelData, type LearningSeries } from './dataset';
import { bootstrap, compareModels, diagnostics, predictiveBands, trajectoryBand, type BootstrapResult, type Comparison, type Diagnostics, type PredictiveBand } from './fit';
import { hashOf } from './hash';
import { decompose, scheduleVariation, DEFAULT_LEARNING_CONFIG, type LearningConfig, type LearningDecomposition } from './learning';
import { MODEL_IDS, type DoseMode, type ModelId } from './models';
import { LAB_VERSIONS } from './version';

export interface AnalysisConfig {
  /** 'auto': practice minutes when practice records exist, otherwise one unit per visit (an assumption, flagged). */
  doseMode: DoseMode | 'auto';
  models: ModelId[];
  bootstrap: number;
  seed: number;
  /** Future sessions to forecast, at the median observed interval and median dose. */
  forecastSessions: number;
  /** Repetitions assumed in a future session (for the observation interval). */
  forecastRepetitions: number;
  learning: LearningConfig;
  /** Session id → reason. Part of the configuration, so exclusions are reproducible and audited. */
  excluded: Record<string, string>;
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  doseMode: 'auto',
  models: [...MODEL_IDS],
  bootstrap: 200,
  seed: 20261108,
  forecastSessions: 3,
  forecastRepetitions: 3,
  learning: DEFAULT_LEARNING_CONFIG,
  excluded: {},
};

export type Warning =
  | 'simulated_data'
  | 'dose_assumed_per_visit'
  | 'dose_from_practice_records'
  | 'few_sessions'
  | 'no_model_selected'
  | 'selected_not_identifiable'
  | 'residual_autocorrelation'
  | 'outlying_session'
  | 'excluded_sessions'
  | 'retention_confounded_with_saturation'
  | 'model_worse_than_persistence'
  | 'no_within_session_replicates';

export interface RetentionEvidence {
  /** AICc(exponential) − AICc(learning–retention): > 2 means the data favour forgetting over saturation. */
  deltaAicc: number | null;
  cvInterval: number;
  cvDose: number;
  /**
   * supported: forgetting beats saturation (ΔAICc > 2) AND learning–retention is within ΔAICc ≤ 2 of the best model;
   * relative_only: forgetting beats saturation, but simpler models (e.g. no change) are better supported overall.
   */
  status: 'supported' | 'relative_only' | 'not_distinguishable' | 'confounded_by_schedule' | 'not_assessable';
}

export interface SeriesAnalysis {
  seriesKey: string;
  dataHash: string;
  configHash: string;
  versions: typeof LAB_VERSIONS;
  doseMode: DoseMode;
  included: number;
  excluded: number;
  comparison: Comparison;
  selected: ModelId | null;
  bootstrap: BootstrapResult | null;
  diagnostics: Diagnostics | null;
  forecast: PredictiveBand[];
  /** Latent trajectory of the selected model on a grid over the observed span (days since first included session). */
  trajectory: { t: number; mean: number; lo: number; hi: number }[];
  decomposition: LearningDecomposition;
  retention: RetentionEvidence;
  warnings: Warning[];
  /** Day of the first included session in series time (days since the series' first session). */
  dayOffset: number;
}

export function resolveDoseMode(series: LearningSeries, mode: AnalysisConfig['doseMode']): DoseMode {
  if (mode !== 'auto') return mode;
  return series.doseSource === 'practice_records' ? 'practice_minutes' : 'per_visit';
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Future schedule: n sessions at the median observed interval, each carrying the median observed dose. */
export function defaultFutureSchedule(t: readonly number[], dose: readonly number[], n: number, mode: DoseMode): { t: number; dose: number }[] {
  const dts = t.slice(1).map((x, i) => x - (t[i] as number));
  const dt = Number.isFinite(median(dts)) ? median(dts) : 7;
  const dd = mode === 'time_on_program' ? dt : Number.isFinite(median(dose.slice(1))) ? median(dose.slice(1)) : 1;
  const last = t[t.length - 1] ?? 0;
  return Array.from({ length: n }, (_, i) => ({ t: last + dt * (i + 1), dose: dd }));
}

export function analyzeSeries(series: LearningSeries, cfg: AnalysisConfig = DEFAULT_ANALYSIS_CONFIG): SeriesAnalysis {
  // Exclusions from the configuration are applied on a copy (the stored series is never modified). Practice that
  // happened before a newly excluded session is carried to the next included one, so no dose is lost.
  let carryMin = 0;
  let carryN = 0;
  const s: LearningSeries = {
    ...series,
    sessions: series.sessions.map((o) => {
      const why = cfg.excluded[o.sessionId];
      if (why !== undefined && o.included) {
        carryMin += o.doseBefore ?? 0;
        carryN += o.practiceCountBefore ?? 0;
        return { ...o, included: false, exclusions: [...o.exclusions, `excluded_by_analyst: ${why}`] };
      }
      if (!o.included) return { ...o };
      const out = { ...o, doseBefore: o.doseBefore === null ? null : o.doseBefore + carryMin, practiceCountBefore: o.practiceCountBefore === null ? null : o.practiceCountBefore + carryN };
      carryMin = 0;
      carryN = 0;
      return out;
    }),
  };
  const doseMode = resolveDoseMode(s, cfg.doseMode);
  const data = modelData(s);
  const counts = s.sessions.filter((o) => o.included).map((o, i) => (i === 0 ? 0 : o.practiceCountBefore));
  const comparison = compareModels(data, { doseMode, sessionsCount: counts, models: cfg.models });
  const d = comparison.prepared;
  const selRow = comparison.rows.find((r) => r.model === comparison.selected) ?? null;
  const fit = selRow?.fit ?? null;
  const boot = fit && fit.status === 'ok' && cfg.bootstrap > 0 ? bootstrap(fit, d, cfg.bootstrap, cfg.seed) : null;
  const future = defaultFutureSchedule(d.t, d.dose, cfg.forecastSessions, doseMode);
  const forecast = fit && fit.status === 'ok' ? predictiveBands(fit, d, boot, future, cfg.forecastRepetitions, cfg.seed) : [];
  const span = d.t[d.t.length - 1] ?? 0;
  const grid = Array.from({ length: 61 }, (_, i) => (span * i) / 60);
  const trajectory = fit && fit.status === 'ok' ? trajectoryBand(fit, d, boot, grid) : [];
  const diag = fit && fit.status === 'ok' ? diagnostics(fit, boot) : null;
  const stat = comparison.rows.find((r) => r.model === 'stationary')?.fit;
  const sigmaS = fit && fit.status === 'ok' ? (fit.params[fit.params.length - 1] as number) : stat && stat.status === 'ok' ? (stat.params[1] as number) : 0;
  const decomposition = decompose(s, sigmaS, cfg.learning);

  // forgetting vs saturation
  const lrRow = comparison.rows.find((r) => r.model === 'learning_retention');
  const lr = lrRow?.fit;
  const ex = comparison.rows.find((r) => r.model === 'exponential')?.fit;
  const sv = scheduleVariation(d.t, d.dose);
  let retention: RetentionEvidence;
  if (!lr || lr.status !== 'ok' || !ex || ex.status !== 'ok') retention = { deltaAicc: null, cvInterval: sv.cvInterval, cvDose: sv.cvDose, status: 'not_assessable' };
  else {
    const delta = ex.aicc - lr.aicc;
    retention = { deltaAicc: Number.isFinite(delta) ? delta : null, cvInterval: sv.cvInterval, cvDose: sv.cvDose, status: sv.confounded ? 'confounded_by_schedule' : delta > 2 ? (lrRow && lrRow.deltaAicc <= 2 ? 'supported' : 'relative_only') : 'not_distinguishable' };
  }

  const warnings: Warning[] = [];
  if (s.sessions.some((o) => o.simulated)) warnings.push('simulated_data');
  if (doseMode === 'per_visit' || doseMode === 'time_on_program') warnings.push('dose_assumed_per_visit');
  else warnings.push('dose_from_practice_records');
  if (d.y.length < 5) warnings.push('few_sessions');
  if (!comparison.selected) warnings.push('no_model_selected');
  if (fit && fit.status === 'ok' && !fit.identifiable && fit.model !== 'stationary') warnings.push('selected_not_identifiable');
  if (diag && diag.pLag1 !== null && diag.pLag1 < 0.05) warnings.push('residual_autocorrelation');
  if (diag && diag.maxAbs > 3) warnings.push('outlying_session');
  if (s.sessions.some((o) => !o.included)) warnings.push('excluded_sessions');
  if (retention.status === 'confounded_by_schedule' && lr?.status === 'ok') warnings.push('retention_confounded_with_saturation');
  if (selRow?.lfo && comparison.persistenceMae !== null && selRow.lfo.folds.length >= 2 && selRow.lfo.mae > comparison.persistenceMae) warnings.push('model_worse_than_persistence');
  if (decomposition.notes.includes('no_within_session_replicates')) warnings.push('no_within_session_replicates');

  const included = s.sessions.filter((o) => o.included);
  return {
    seriesKey: s.key,
    dataHash: hashOf({ series: s.key, sessions: s.sessions.map((o) => ({ id: o.sessionId, date: o.date, reps: o.reps, included: o.included, exclusions: o.exclusions, dose: o.doseBefore, count: o.practiceCountBefore, alg: o.algorithmVersion })) }),
    configHash: hashOf(cfg),
    versions: LAB_VERSIONS,
    doseMode,
    included: included.length,
    excluded: s.sessions.length - included.length,
    comparison,
    selected: comparison.selected,
    bootstrap: boot,
    diagnostics: diag,
    forecast,
    trajectory,
    decomposition,
    retention,
    warnings,
    dayOffset: included[0]?.day ?? 0,
  };
}
