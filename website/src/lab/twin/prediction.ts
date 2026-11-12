// Prediction engine of the Motor Twin — transparent, comparative, and allowed to say no.
//
// A prediction is a RECORD, not a line on a chart: what is predicted, from which observations, how far ahead, by
// which models with which weights, the point value, the interval, how well such predictions have been calibrated on
// this person's own past (leave-future-out), whether it extrapolates, and what it cannot account for.
//
// Combination: every fitted candidate model gives a predictive distribution for the mean of the future session
// (parametric bootstrap, lab/fit.ts predictiveBands — parameter uncertainty and day-to-day and repetition noise).
// The record carries each of them AND their Akaike-weighted mixture (Burnham & Anderson 2004): when the data do not
// separate "no change" from "linear change", the interval of the mixture spans both instead of following whichever
// model happened to win.
//
// Refusal (rules fixed before any data; a refused record still lists its reasons and per-model values):
//   too_few_sessions                  fewer than 5 included sessions
//   no_model_fitted
//   horizon_beyond_observed_span      the forecast time lies further ahead than the series is long
//   interval_uninformative            the 95 % interval is wider than twice the range of all observed session means
//   no_predictive_skill_demonstrated  ≥ 8 leave-future-out folds and the selected model was further off than
//                                     "same as last session" in significantly more of them (one-sided sign test,
//                                     p < 0.05). With fewer folds a negative skill is only noted: on 5 forecasts of
//                                     a truly linear series the estimated skill was negative in 5 of 12 development
//                                     series — refusing on that would discard valid forecasts by chance.
//   undercoverage                     ≥ 8 folds and the Wilson upper bound of the 95 % interval coverage is below 0.85
// A prediction is conditional on unchanged protocol, sensors and circumstances; it is never a prognosis.

import { wilson } from '../benchmark';
import type { LearningSeries } from '../dataset';
import { modelData } from '../dataset';
import { bootstrap, compareModels, predictiveBands, type Comparison } from '../fit';
import { hashOf } from '../hash';
import { provenanceOf, type ProvenanceLabel } from '../measure/registry';
import { MODEL_IDS, type DoseMode, type ModelId } from '../models';
import { normCdf } from '../numeric';
import { FRONTIER_VERSIONS, LAB_VERSIONS } from '../version';

export const PREDICTION_RULE = { minSessions: 5, maxHorizonOverSpan: 1, warnHorizonOverSpan: 0.25, uninformativeRangeFactor: 2, minFoldsSkill: 8, skillAlpha: 0.05, minFoldsCoverage: 8, coverageFloor: 0.85, minWeight: 0.01, bootstrap: 120 } as const;

export type Refusal = 'too_few_sessions' | 'no_model_fitted' | 'horizon_beyond_observed_span' | 'interval_uninformative' | 'no_predictive_skill_demonstrated' | 'undercoverage';

export interface ModelPrediction {
  model: ModelId;
  weight: number;
  mean: number;
  lo: number;
  hi: number;
  identifiable: boolean;
}

export interface PredictionRecord {
  id: string;
  status: 'issued' | 'refused';
  refusal: Refusal[];
  target: { seriesKey: string; exercise: string; side: string; metric: string; unit: string; quantity: 'mean of a future session'; repetitions: number };
  inputs: { sessionIds: string[]; included: number; dataHash: string; spanDays: number };
  horizon: { days: number; t: number; overSpan: number };
  /** Akaike-weighted mixture of the per-model predictive distributions (null when refused before any model exists). */
  point: number | null;
  interval95: [number, number] | null;
  models: ModelPrediction[];
  selected: ModelId | null;
  calibration: {
    status: 'not_assessable' | 'evaluated';
    /** One-step-ahead leave-future-out folds of the selected model on this series. */
    folds: number;
    coverage95: number | null;
    coverageCi: [number, number] | null;
    mae: number | null;
    persistenceMae: number | null;
    /** 1 − MAE / persistence MAE: > 0 = better than "same as last session". */
    skill: number | null;
    /** Folds in which the model was further off than "same as last session", and the one-sided sign-test p of "worse". */
    worseThanPersistence: number | null;
    pWorse: number | null;
  };
  extrapolation: { warning: 'none' | 'beyond_a_quarter_of_the_observed_span' | 'beyond_the_observed_span' };
  limitations: string[];
  provenance: ProvenanceLabel;
  versions: { twin: string; models: string };
}

export interface PredictOptions {
  /** Days after the last included session. */
  horizonDays: number;
  /** Repetitions the future session is assumed to have. */
  repetitions?: number;
  /** Dose in the interval to the future session, in the units of `doseMode` (default: the median observed dose). */
  dose?: number;
  doseMode?: DoseMode;
  models?: readonly ModelId[];
  seed?: number;
  /** Reuse an existing comparison of the same series and candidate set. */
  comparison?: Comparison;
}

/** Quantile of a mixture of normals by bisection on its CDF. */
function mixtureQuantile(parts: readonly { w: number; mean: number; sd: number }[], p: number): number {
  let lo = Math.min(...parts.map((x) => x.mean - 8 * x.sd));
  let hi = Math.max(...parts.map((x) => x.mean + 8 * x.sd));
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const c = parts.reduce((a, x) => a + x.w * (x.sd > 0 ? normCdf((mid - x.mean) / x.sd) : mid >= x.mean ? 1 : 0), 0);
    if (c < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function predictSeries(series: LearningSeries, o: PredictOptions): PredictionRecord {
  const data = modelData(series);
  const K = data.y.length;
  const doseMode: DoseMode = o.doseMode ?? (series.doseSource === 'practice_records' ? 'practice_minutes' : 'per_visit');
  const reps = o.repetitions ?? 3;
  const span = K ? (data.t[K - 1] as number) - (data.t[0] as number) : 0;
  const t = (data.t[K - 1] ?? 0) + o.horizonDays;
  const simulated = series.sessions.some((s) => s.simulated);
  const refusal: Refusal[] = [];
  const limitations = [
    'conditional_on_unchanged_protocol,_sensors,_placement_procedure_and_circumstances_of_the_child',
    'a_statement_about_a_measured_metric,_not_a_prognosis_and_not_a_treatment_recommendation',
    'day-to-day_variation_is_assumed_independent_between_sessions',
  ];
  const overSpan = span > 0 ? o.horizonDays / span : Infinity;
  const base = {
    target: { seriesKey: series.key, exercise: series.exercise, side: series.side, metric: series.metric, unit: series.unit, quantity: 'mean of a future session' as const, repetitions: reps },
    inputs: { sessionIds: data.sessionIds, included: K, dataHash: hashOf({ t: data.t, y: data.y, n: data.n, dose: data.dose, ss: data.ss }), spanDays: span },
    horizon: { days: o.horizonDays, t, overSpan },
    provenance: simulated ? provenanceOf('predicted', { simulated: true }) : provenanceOf('predicted', { simulated: false }),
    versions: { twin: FRONTIER_VERSIONS.twin, models: LAB_VERSIONS.models },
    extrapolation: { warning: overSpan > PREDICTION_RULE.maxHorizonOverSpan ? ('beyond_the_observed_span' as const) : overSpan > PREDICTION_RULE.warnHorizonOverSpan ? ('beyond_a_quarter_of_the_observed_span' as const) : ('none' as const) },
    limitations,
  };
  const noCal = { status: 'not_assessable' as const, folds: 0, coverage95: null, coverageCi: null, mae: null, persistenceMae: null, skill: null, worseThanPersistence: null, pWorse: null };
  const finish = (r: Omit<PredictionRecord, 'id' | 'status' | 'refusal'>): PredictionRecord => ({ ...r, id: hashOf({ target: r.target, inputs: r.inputs.dataHash, horizon: r.horizon, models: r.models.map((m) => m.model), versions: r.versions }).slice(0, 16), status: refusal.length ? 'refused' : 'issued', refusal });
  if (K < PREDICTION_RULE.minSessions) {
    refusal.push('too_few_sessions');
    return finish({ ...base, point: null, interval95: null, models: [], selected: null, calibration: noCal });
  }
  const cmp = o.comparison ?? compareModels(data, { doseMode, models: o.models ?? MODEL_IDS });
  const d = cmp.prepared;
  const medDose = [...d.dose.slice(1)].sort((a, b) => a - b)[Math.floor((d.dose.length - 1) / 2)] ?? 1;
  const dose = o.dose ?? (doseMode === 'time_on_program' ? o.horizonDays : medDose);
  const seed = o.seed ?? 20261110;
  const models: ModelPrediction[] = [];
  for (const row of cmp.rows) {
    if (row.fit.status !== 'ok' || !(row.weight >= PREDICTION_RULE.minWeight)) continue;
    const boot = bootstrap(row.fit, d, PREDICTION_RULE.bootstrap, seed);
    const band = predictiveBands(row.fit, d, boot, [{ t, dose }], reps, seed)[0];
    if (!band || !Number.isFinite(band.obsLo) || !Number.isFinite(band.obsHi)) continue;
    models.push({ model: row.model, weight: row.weight, mean: band.mean, lo: band.obsLo, hi: band.obsHi, identifiable: row.fit.identifiable || row.model === 'stationary' });
  }
  if (!models.length || !cmp.selected) {
    refusal.push('no_model_fitted');
    return finish({ ...base, point: null, interval95: null, models, selected: cmp.selected, calibration: noCal });
  }
  const wsum = models.reduce((a, m) => a + m.weight, 0);
  const parts = models.map((m) => ({ w: m.weight / wsum, mean: m.mean, sd: (m.hi - m.lo) / (2 * 1.959963984540054) }));
  const point = parts.reduce((a, x) => a + x.w * x.mean, 0);
  const interval95: [number, number] = [mixtureQuantile(parts, 0.025), mixtureQuantile(parts, 0.975)];
  // calibration of the selected model's one-step-ahead forecasts on this series
  const lfo = cmp.rows.find((r) => r.model === cmp.selected)?.lfo ?? null;
  const folds = lfo?.folds.length ?? 0;
  const inside = lfo ? lfo.folds.filter((f) => f.inside95).length : 0;
  // paired comparison with "same as last session", fold by fold
  const worse = lfo ? lfo.folds.filter((f) => f.absError > Math.abs((d.y[f.target] as number) - (d.y[f.target - 1] as number))).length : 0;
  let pWorse: number | null = null;
  if (folds) {
    // P(X ≥ worse) for X ~ Binomial(folds, ½)
    let p = 0;
    let c = 1;
    for (let k = 0; k <= folds; k++) {
      if (k >= worse) p += c;
      c = (c * (folds - k)) / (k + 1);
    }
    pWorse = p / 2 ** folds;
  }
  const calibration: PredictionRecord['calibration'] = folds
    ? { status: 'evaluated', folds, coverage95: inside / folds, coverageCi: wilson(inside, folds), mae: lfo?.mae ?? null, persistenceMae: cmp.persistenceMae, skill: lfo && cmp.persistenceMae !== null && cmp.persistenceMae > 0 ? 1 - lfo.mae / cmp.persistenceMae : null, worseThanPersistence: worse, pWorse }
    : noCal;
  if (overSpan > PREDICTION_RULE.maxHorizonOverSpan) refusal.push('horizon_beyond_observed_span');
  const range = Math.max(...data.y) - Math.min(...data.y);
  if (interval95[1] - interval95[0] > PREDICTION_RULE.uninformativeRangeFactor * range) refusal.push('interval_uninformative');
  if (folds >= PREDICTION_RULE.minFoldsSkill && pWorse !== null && pWorse < PREDICTION_RULE.skillAlpha && cmp.selected !== 'stationary') refusal.push('no_predictive_skill_demonstrated');
  else if (calibration.skill !== null && calibration.skill < 0) limitations.push(`on_its_${folds}_past_forecast${folds === 1 ? '' : 's'}_the_model_was_not_better_than_"same_as_last_session"_(too_few_to_conclude)`);
  if (folds >= PREDICTION_RULE.minFoldsCoverage && calibration.coverageCi && calibration.coverageCi[1] < PREDICTION_RULE.coverageFloor) refusal.push('undercoverage');
  if (folds < PREDICTION_RULE.minFoldsCoverage) limitations.push(`calibration_rests_on_${folds}_past_forecast${folds === 1 ? '' : 's'}_of_this_series:_too_few_to_confirm_95_%_coverage`);
  if (models.some((m) => !m.identifiable)) limitations.push('a_contributing_model_has_a_parameter_the_data_do_not_bound');
  if (simulated) limitations.push('synthetic_demonstration_data:_says_nothing_about_a_real_child');
  return finish({ ...base, point, interval95, models, selected: cmp.selected, calibration });
}
