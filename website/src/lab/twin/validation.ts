// Validation of the twin layer on SYNTHETIC series with known ground truth. Criteria fixed 2026-11-10 before the
// reported run.
//
//   T1  population model: recovery of fixed effects, random-effects covariance and residual SD
//   T2  held-out participants, future observations (acceptance test H): coverage, error, calibration, baselines
//   T2b the same when the true trajectories saturate but the model is linear (misspecification)
//   T3  prediction engine: coverage of issued intervals; refusals
//   T4  identifiability (acceptance test G): a slow curve from few sessions; forgetting on a regular schedule
//   T5  learning with forgetting (acceptance test E): retention test represented separately; half-life recovered

import { round, wilson, type BenchmarkRecord } from '../benchmark';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG } from '../analysis';
import type { LearningSeries, SessionObservation } from '../dataset';
import { createRng, type Rng } from '../../lib/random';
import { lrStep } from '../models';
import { FRONTIER_VERSIONS } from '../version';
import { fitPopulation, validatePopulation, type PopulationParticipant } from './population';
import { predictSeries } from './prediction';

const V = FRONTIER_VERSIONS.twin;
const rec = (r: Omit<BenchmarkRecord, 'component' | 'version'>): BenchmarkRecord => ({ ...r, component: 'twin', version: V });

export const TWIN_CRITERIA = {
  T1_rel_error_max: 0.15,
  T2_coverage_range: [0.9, 0.98] as const,
  T2_slope_range: [0.85, 1.15] as const,
  T3_coverage_range: [0.88, 0.99] as const,
  T4_confounded_flagged_min: 1,
  T4_unidentifiable_flagged_min: 0.6,
  T5_half_life_coverage_min: 0.8,
  T5_retention_test_min: 1,
} as const;

const SIM = { sigmaE: 4, sigmaS: 2.5, reps: 3 } as const;

/** A learning series from a latent trajectory z(t): session-level and repetition-level noise, optional dose. */
export function syntheticSeries(id: string, t: readonly number[], z: readonly number[], rng: Rng, o: { dose?: readonly (number | null)[]; reps?: number; sigmaE?: number; sigmaS?: number } = {}): LearningSeries {
  const reps = o.reps ?? SIM.reps;
  const sessions: SessionObservation[] = t.map((day, k) => {
    const eta = rng.normal(0, o.sigmaS ?? SIM.sigmaS);
    const r = Array.from({ length: reps }, () => (z[k] as number) + eta + rng.normal(0, o.sigmaE ?? SIM.sigmaE));
    const mean = r.reduce((a, b) => a + b, 0) / reps;
    const dose = o.dose ? (o.dose[k] ?? null) : null;
    return {
      sessionId: `${id}-s${k}`, date: new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString(), day, reps: r, n: reps, mean,
      sd: reps > 1 ? Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / (reps - 1)) : null, included: true, exclusions: [], simulated: true,
      doseBefore: o.dose ? (k === 0 ? 0 : dose) : null, practiceCountBefore: o.dose ? (k === 0 ? 0 : (dose ?? 0) > 0 ? 1 : 0) : null, signalPercent: 100, algorithmVersion: 'nm-core 0.2.0', appVersion: 'synthetic',
    };
  });
  return { key: `${id}|shoulder_flexion|right|rom`, participantId: id, exercise: 'shoulder_flexion', side: 'right', metric: 'rom', unit: '°', sessions, doseSource: o.dose ? 'practice_records' : 'unknown' };
}

const TRUTH = { beta: [100, 1.5] as const, sd0: 10, sd1: 0.8, rho: -0.2, sigma: 3 };

export function populationSample(P: number, K: number, rng: Rng, shape: 'linear' | 'saturating' = 'linear'): PopulationParticipant[] {
  return Array.from({ length: P }, (_, i) => {
    const z0 = rng.normal();
    const z1 = TRUTH.rho * z0 + Math.sqrt(1 - TRUTH.rho ** 2) * rng.normal();
    const b0 = TRUTH.sd0 * z0;
    const b1 = TRUTH.sd1 * z1;
    const t = Array.from({ length: K }, (_, k) => k);
    const y = t.map((w) => {
      const lin = TRUTH.beta[0] + b0 + (TRUTH.beta[1] + b1) * w;
      // saturating: the same initial slope, levelling off with a time constant of 4 weeks
      const sat = TRUTH.beta[0] + b0 + (TRUTH.beta[1] + b1) * 4 * (1 - Math.exp(-w / 4));
      return (shape === 'linear' ? lin : sat) + rng.normal(0, TRUTH.sigma);
    });
    return { participantId: `SYN-POP-${i}`, simulated: true, t, y };
  });
}

export function twinValidation(full: boolean): BenchmarkRecord[] {
  const mode = full ? 'full' : 'quick';
  const out: BenchmarkRecord[] = [];

  // T1
  {
    const R = full ? 200 : 4;
    const est = { b0: [] as number[], b1: [] as number[], d00: [] as number[], d11: [] as number[], s: [] as number[] };
    let conv = 0;
    for (let r = 0; r < R; r++) {
      const m = fitPopulation(populationSample(40, 8, createRng(71_000 + r)));
      if (m.status !== 'fitted') continue;
      conv++;
      est.b0.push(m.beta[0]);
      est.b1.push(m.beta[1]);
      est.d00.push(m.D[0][0]);
      est.d11.push(m.D[1][1]);
      est.s.push(m.sigma ** 2);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const rel = { slope: Math.abs(mean(est.b1) - TRUTH.beta[1]) / TRUTH.beta[1], intercept_var: Math.abs(mean(est.d00) - TRUTH.sd0 ** 2) / TRUTH.sd0 ** 2, slope_var: Math.abs(mean(est.d11) - TRUTH.sd1 ** 2) / TRUTH.sd1 ** 2, residual_var: Math.abs(mean(est.s) - TRUTH.sigma ** 2) / TRUTH.sigma ** 2 };
    const worst = Math.max(...Object.values(rel));
    out.push(rec({
      id: 'T1', name: 'Population model: parameter recovery', purpose: 'Does the EM fit of the random-intercept-and-slope model recover the mean change, the spread of individual levels and slopes, and the residual SD?',
      assumptions: '40 participants × 8 weekly sessions; normal random effects (SD 10 and 0.8/week, correlation −0.2), residual SD 3', groundTruth: 'β = (100, 1.5), D and σ as stated',
      metric: 'largest relative error of the mean estimate over replicates (ML variance estimates are biased low by ≈ 1/participants)', criterion: `≤ ${TWIN_CRITERIA.T1_rel_error_max}`,
      cases: conv, value: round(worst), detail: { ...Object.fromEntries(Object.entries(rel).map(([k, v]) => [`rel_error_${k}`, round(v)])), converged: conv, replicates: R }, pass: conv === R && worst <= TWIN_CRITERIA.T1_rel_error_max,
      knownFailureModes: ['with ≈ 10 participants the slope variance is poorly determined', 'non-linear individual trajectories are forced onto lines (T2b)'], mode,
    }));
  }
  // T2, T2b
  for (const shape of ['linear', 'saturating'] as const) {
    const R = full ? 30 : 1;
    let inside = 0;
    let n = 0;
    const mae: number[] = [];
    const ind: number[] = [];
    const per: number[] = [];
    const pop: number[] = [];
    const slopes: number[] = [];
    for (let r = 0; r < R; r++) {
      const v = validatePopulation(populationSample(30, 10, createRng(72_000 + r + (shape === 'linear' ? 0 : 500)), shape), 3);
      if (v.status !== 'evaluated' || v.coverage95 === null) continue;
      inside += Math.round(v.coverage95 * v.predictions);
      n += v.predictions;
      mae.push(v.mae as number);
      ind.push(v.baselines.individualOnlyMae as number);
      per.push(v.baselines.persistenceMae as number);
      pop.push(v.baselines.populationOnlyMae as number);
      if (v.calibrationSlope !== null) slopes.push(v.calibrationSlope);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const cov = n ? inside / n : NaN;
    const [lo, hi] = wilson(inside, n);
    const linear = shape === 'linear';
    out.push(rec({
      id: linear ? 'T2' : 'T2b', name: linear ? 'Held-out participants, future sessions: calibration' : 'Held-out participants, future sessions: misspecified shape',
      purpose: linear ? 'For a participant the model has never seen, are sessions 4–10 predicted from sessions 1–3 with calibrated 95 % intervals, and better than without the population?' : 'What happens to the same predictions when individual trajectories level off but the model assumes straight lines?',
      assumptions: `30 participants × 10 weekly sessions; leave-one-participant-out; own sessions 1–3 given; ${linear ? 'linear truth' : 'saturating truth (time constant 4 weeks)'}`, groundTruth: 'Simulated future sessions of the held-out participant',
      metric: 'coverage of the 95 % prediction intervals over all held-out future observations', criterion: linear ? `coverage within [${TWIN_CRITERIA.T2_coverage_range.join(', ')}], calibration slope within [${TWIN_CRITERIA.T2_slope_range.join(', ')}], MAE below the individual-only line` : 'descriptive',
      cases: n, value: round(cov), detail: { coverage_ci95: `[${round(lo)}, ${round(hi)}]`, mae: round(mean(mae), 2), mae_individual_only_line: round(mean(ind), 2), mae_same_as_last_session: round(mean(per), 2), mae_population_only: round(mean(pop), 2), calibration_slope: round(mean(slopes)) },
      pass: linear ? cov >= TWIN_CRITERIA.T2_coverage_range[0] && cov <= TWIN_CRITERIA.T2_coverage_range[1] && mean(slopes) >= TWIN_CRITERIA.T2_slope_range[0] && mean(slopes) <= TWIN_CRITERIA.T2_slope_range[1] && mean(mae) < mean(ind) : null,
      knownFailureModes: linear ? ['only valid for participants exchangeable with the sample the model was fitted on', 'synthetic participants: says nothing about real children'] : ['a linear population model extrapolates a saturating child upwards: intervals under-cover late sessions'], mode,
    }));
  }
  // T3
  {
    const R = full ? 300 : 4;
    const truths: [string, (d: number) => number][] = [['stationary', () => 120], ['linear', (d) => 100 + (1.5 * d) / 7], ['exponential', (d) => 150 + (90 - 150) * Math.exp(-d / 30)]];
    const detail: Record<string, number | string> = {};
    let inside = 0;
    let issued = 0;
    let refusedShort = 0;
    for (const [name, f] of truths) {
      let ins = 0;
      let iss = 0;
      const reasons: Record<string, number> = {};
      const rng = createRng(73_000 + name.length);
      for (let r = 0; r < R; r++) {
        const t = Array.from({ length: 11 }, (_, k) => 7 * k);
        const all = syntheticSeries(`SYN-T3-${r}`, t, t.map(f), rng);
        const train: LearningSeries = { ...all, sessions: all.sessions.slice(0, 10) };
        const p = predictSeries(train, { horizonDays: 7, seed: 73_500 + r });
        if (p.status === 'issued' && p.interval95) {
          iss++;
          const y = (all.sessions[10] as SessionObservation).mean;
          if (y >= p.interval95[0] && y <= p.interval95[1]) ins++;
        } else for (const x of p.refusal) reasons[x] = (reasons[x] ?? 0) + 1;
      }
      detail[`${name}_coverage`] = iss ? round(ins / iss) : 'n/a';
      detail[`${name}_issued`] = round(iss / R);
      for (const [k, v] of Object.entries(reasons)) detail[`${name}_refused_${k}`] = round(v / R);
      inside += ins;
      issued += iss;
    }
    // too few sessions → always refused
    const rng = createRng(73_900);
    const Rs = full ? 50 : 2;
    for (let r = 0; r < Rs; r++) {
      const t = [0, 7, 14, 21];
      if (predictSeries(syntheticSeries(`SYN-T3s-${r}`, t, t.map(() => 100), rng), { horizonDays: 7 }).refusal.includes('too_few_sessions')) refusedShort++;
    }
    detail.four_sessions_refused = round(refusedShort / Rs);
    const cov = issued ? inside / issued : NaN;
    out.push(rec({
      id: 'T3', name: 'Prediction engine: coverage of issued intervals', purpose: 'Do the model-averaged 95 % intervals for the next session contain it about 95 % of the time, whatever the true shape — and is a forecast refused when there is too little data?',
      assumptions: '10 weekly sessions × 3 repetitions (σε 4, σs 2.5), next session one week later; truth stationary, linear or exponential', groundTruth: 'Mean of the simulated 11th session',
      metric: 'coverage of the 95 % interval over all issued predictions', criterion: `within [${TWIN_CRITERIA.T3_coverage_range.join(', ')}] and every 4-session series refused`,
      cases: 3 * R + Rs, value: round(cov), detail, pass: cov >= TWIN_CRITERIA.T3_coverage_range[0] && cov <= TWIN_CRITERIA.T3_coverage_range[1] && refusedShort === Rs,
      knownFailureModes: ['coverage is conditional on the day-to-day variation staying as it was', 'refusals remove the hardest cases from the coverage figure — the refusal rates are part of the result'], mode,
    }));
  }
  // T4
  {
    const R = full ? 60 : 2;
    let confounded = 0;
    let unident = 0;
    let warned = 0;
    let fitted = 0;
    for (let r = 0; r < R; r++) {
      const rng = createRng(74_000 + r);
      // (a) forgetting on a regular schedule with a constant dose: not separable from saturation
      const t = Array.from({ length: 10 }, (_, k) => 7 * k);
      const dose = t.map((_, k) => (k === 0 ? 0 : 40));
      const z: number[] = [80];
      for (let k = 1; k < t.length; k++) z.push(lrStep(z[k - 1] as number, 80, 21, 0.3, 40, 7));
      const a = analyzeSeries(syntheticSeries(`SYN-T4a-${r}`, t, z, rng, { dose }), { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 });
      if (a.retention.status === 'confounded_by_schedule') confounded++;
      // (b) a slow learning curve (τ = 60 d) seen for 8 weeks: the time constant is not bounded by the data
      const t8 = Array.from({ length: 8 }, (_, k) => 7 * k);
      const b = analyzeSeries(syntheticSeries(`SYN-T4b-${r}`, t8, t8.map((d) => 150 + (90 - 150) * Math.exp(-d / 60)), rng), { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 });
      const ex = b.comparison.rows.find((x) => x.model === 'exponential');
      if (ex && ex.fit.status === 'ok') {
        fitted++;
        if (!ex.fit.identifiable) unident++;
        // whenever the SELECTED model has an unbounded parameter, the analysis must say so
        if (b.selected === 'exponential' && !ex.fit.identifiable && b.warnings.includes('selected_not_identifiable')) warned++;
        if (b.selected === 'exponential' && !ex.fit.identifiable && !b.warnings.includes('selected_not_identifiable')) warned -= 1000;
      }
    }
    out.push(rec({
      id: 'T4', name: 'Identifiability is detected, not hidden', purpose: 'When two parameters or two explanations cannot be told apart from the data, does the analysis say so instead of reporting precise-looking values?',
      assumptions: '(a) learning with forgetting on a regular weekly schedule with constant dose; (b) a slow exponential curve (τ = 60 d) observed for 8 weekly sessions', groundTruth: '(a) forgetting and saturation are confounded by design; (b) the time constant is not bounded by 8 weeks of data',
      metric: 'share of (a) flagged "confounded_by_schedule"; share of (b) with an open profile interval for the time constant', criterion: `(a) = ${TWIN_CRITERIA.T4_confounded_flagged_min}; (b) ≥ ${TWIN_CRITERIA.T4_unidentifiable_flagged_min}; no selected model with an open interval without a warning`,
      cases: 2 * R, value: round(confounded / R), detail: { confounded_flagged: round(confounded / R), time_constant_open_interval: fitted ? round(unident / fitted) : 'n/a', selected_unidentifiable_without_warning: warned < 0 ? 'YES' : 'never' },
      pass: confounded / R >= TWIN_CRITERIA.T4_confounded_flagged_min && fitted > 0 && unident / fitted >= TWIN_CRITERIA.T4_unidentifiable_flagged_min && warned >= 0,
      knownFailureModes: ['profile likelihood detects parameters the data do not bound; it does not detect a wrong model form'], mode,
    }));
  }
  // T5
  {
    const R = full ? 60 : 2;
    const truth = { z1: 80, h: 21, g: 0.3 };
    // weekly practice with varying dose, a 4-week and a 6-week break without practice; the session after the
    // 6-week break is the protocol's retention test
    const t = [0, 7, 14, 21, 28, 56, 63, 70, 77, 119];
    const dose = [0, 40, 60, 20, 40, 0, 50, 30, 60, 0];
    const z: number[] = [truth.z1];
    for (let k = 1; k < t.length; k++) z.push(lrStep(z[k - 1] as number, truth.z1, truth.h, truth.g, dose[k] as number, (t[k] as number) - (t[k - 1] as number)));
    const trueRatio = ((z[9] as number) - (z[0] as number)) / ((z[8] as number) - (z[0] as number));
    let asTest = 0;
    let cover = 0;
    let fitted = 0;
    const ratioErr: number[] = [];
    const immediateVsRetained: number[] = [];
    for (let r = 0; r < R; r++) {
      const s = syntheticSeries(`SYN-T5-${r}`, t, z, createRng(75_000 + r), { dose, reps: 5 });
      const a = analyzeSeries(s, { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0, learning: { ...DEFAULT_ANALYSIS_CONFIG.learning, retentionSessionIds: [`SYN-T5-${r}-s9`] } });
      const ret = a.decomposition.retention.find((x) => x.toSessionId === `SYN-T5-${r}-s9`);
      if (ret?.kind === 'retention_test' && ret.practiceInDelay === 'none_recorded') asTest++;
      if (ret && ret.retentionRatio !== null) ratioErr.push(Math.abs(ret.retentionRatio - trueRatio));
      // immediate performance (last practice session) and the retained level are different numbers
      const end = a.decomposition.sessions[8];
      const rt = a.decomposition.sessions[9];
      if (end && rt) immediateVsRetained.push(end.mean - rt.mean);
      const lr = a.comparison.rows.find((x) => x.model === 'learning_retention');
      const p = lr?.fit.profiles.find((x) => x.param === 'retention_half_life_days');
      if (lr && lr.fit.status === 'ok' && p) {
        fitted++;
        if (p.lo <= truth.h && p.hi >= truth.h) cover++;
      }
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    out.push(rec({
      id: 'T5', name: 'Learning with forgetting: retention kept apart from performance', purpose: 'With known learning, a no-practice interval and a designated retention session, are immediate performance and the retained change represented separately, and is the forgetting half-life recovered with honest uncertainty?',
      assumptions: 'Single-rate learning with forgetting (half-life 21 d, gain 0.3 units/min), 10 sessions × 5 repetitions, varying dose, breaks of 4 and 6 weeks, practice log available', groundTruth: `half-life 21 d; true retention ratio after the 6-week break ${round(trueRatio, 2)}`,
      metric: 'coverage of the true half-life by the 95 % profile interval; share of runs in which the designated session is a retention test without recorded practice', criterion: `coverage ≥ ${TWIN_CRITERIA.T5_half_life_coverage_min}; retention test recognised in ${TWIN_CRITERIA.T5_retention_test_min * 100} %`,
      cases: R, value: fitted ? round(cover / fitted) : null, detail: { retention_test_recognised: round(asTest / R), median_abs_error_of_retention_ratio: round(med(ratioErr), 2), true_retention_ratio: round(trueRatio, 2), median_end_of_practice_minus_retention_level: round(med(immediateVsRetained), 1), true_difference: round((z[8] as number) - (z[9] as number), 1) },
      pass: fitted > 0 && cover / fitted >= TWIN_CRITERIA.T5_half_life_coverage_min && asTest / R >= TWIN_CRITERIA.T5_retention_test_min,
      knownFailureModes: ['the retention ratio of ONE session pair is noisy (session noise in numerator and denominator)', '"no practice in the delay" comes from the practice log: reported, not observed'], mode,
    }));
  }
  return out;
}
