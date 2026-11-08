// Simulation-based validation of the learning-dynamics models (Wilson & Collins 2019, doi:10.7554/eLife.49547:
// "simulate, then recover"). Every experiment states its acceptance criterion BEFORE it runs; the runner records
// pass/fail and never edits a criterion after seeing results. Results feed research/model-validation.md.
//
// Design values mimic the current NeuroMove assessment schedule (weekly sessions, 3 repetitions per movement)
// with ROM-like noise. They are ASSUMPTIONS for simulation, not estimates from real children.

import { createRng } from '../lib/random';
import type { ModelData } from './dataset';
import { fitDualRate, simulateDualRate, smithParadigm, type DualRateParams } from './dualRate';
import { bootstrap, compareModels, fitModel, predictiveBands } from './fit';
import { lrStep, type ModelId } from './models';

export interface ExperimentResult {
  id: string;
  question: string;
  design: string;
  criterion: string;
  seeds: number;
  metrics: Record<string, number | string>;
  pass: boolean;
}

/** Assumed noise for simulations: repetition SD 4°, session SD 2.5° (order of magnitude of IMU ROM variability). */
export const SIM_NOISE = { sigmaE: 4, sigmaS: 2.5, reps: 3 } as const;

function synth(t: readonly number[], z: readonly number[], seed: number, dose?: readonly number[], noise: { sigmaE: number; sigmaS: number; reps: number } = SIM_NOISE): ModelData {
  const rng = createRng(seed);
  const y: number[] = [];
  const ss: number[] = [];
  for (let k = 0; k < t.length; k++) {
    const eta = rng.normal(0, noise.sigmaS);
    const reps = Array.from({ length: noise.reps }, () => (z[k] as number) + eta + rng.normal(0, noise.sigmaE));
    const m = reps.reduce((a, b) => a + b, 0) / reps.length;
    y.push(m);
    ss.push(reps.reduce((a, v) => a + (v - m) ** 2, 0));
  }
  return { t: [...t], y, n: t.map(() => noise.reps), dose: dose ? [...dose] : t.map(() => 0), ss, sessionIds: t.map((_, i) => `s${i}`) };
}

const weekly = (n: number) => Array.from({ length: n }, (_, i) => 7 * i);
const frac = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : NaN);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** E1 — How often is "change" selected when nothing changes? (false-positive rate of the selection rule) */
export function e1FalseChange(seeds: number): ExperimentResult {
  const t = weekly(8);
  const picks: ModelId[] = [];
  for (let s = 0; s < seeds; s++) picks.push(compareModels(synth(t, t.map(() => 120), 1000 + s), { doseMode: 'per_visit' }).selected ?? 'stationary');
  const fp = frac(picks.map((p) => p !== 'stationary'));
  return {
    id: 'E1',
    question: 'With no true change, how often does model selection pick a model of change?',
    design: '8 weekly sessions × 3 repetitions, σε = 4, σs = 2.5, true performance constant',
    criterion: 'false-change rate ≤ 0.15',
    seeds,
    metrics: { false_change_rate: r3(fp), linear: r3(frac(picks.map((p) => p === 'linear'))), local_level: r3(frac(picks.map((p) => p === 'local_level'))), exponential: r3(frac(picks.map((p) => p === 'exponential'))), learning_retention: r3(frac(picks.map((p) => p === 'learning_retention'))) },
    pass: fp <= 0.15,
  };
}

/** E2 — Detection of a linear trend vs its size (power curve). */
export function e2TrendPower(seeds: number): ExperimentResult {
  const t = weekly(8);
  const metrics: Record<string, number> = {};
  let power2 = 0;
  for (const slope of [0.5, 1, 2, 3]) {
    const det: boolean[] = [];
    for (let s = 0; s < seeds; s++) {
      const c = compareModels(synth(t, t.map((x) => 100 + (slope * x) / 7), 2000 + s), { doseMode: 'per_visit' });
      det.push(c.selected !== 'stationary');
    }
    metrics[`power_slope_${slope}_per_week`] = r3(frac(det));
    if (slope === 2) power2 = frac(det);
  }
  return {
    id: 'E2',
    question: 'How large must a weekly change be before it is detected in 8 weekly sessions?',
    design: '8 weekly sessions × 3 repetitions, σε = 4, σs = 2.5, true linear change of 0.5–3 units/week',
    criterion: 'power ≥ 0.8 at 2 units/week (≈ 14 units over the series)',
    seeds,
    metrics,
    pass: power2 >= 0.8,
  };
}

/** E3 — Linear slope interval coverage (calibration of the profile-likelihood interval). */
export function e3SlopeCoverage(seeds: number): ExperimentResult {
  const t = weekly(10);
  const cover: boolean[] = [];
  const err: number[] = [];
  for (let s = 0; s < seeds; s++) {
    const { fit } = fitModel('linear', synth(t, t.map((x) => 100 + (1.5 * x) / 7), 3000 + s), { doseMode: 'per_visit' });
    const p = fit.profiles.find((x) => x.param === 'slope_per_week');
    if (!p) continue;
    cover.push(p.lo <= 1.5 && p.hi >= 1.5);
    err.push((fit.params[1] as number) - 1.5);
  }
  const c = frac(cover);
  return {
    id: 'E3',
    question: 'Do 95 % profile-likelihood intervals for the weekly slope cover the true slope ~95 % of the time?',
    design: '10 weekly sessions × 3 repetitions, true slope 1.5 units/week',
    criterion: 'coverage in [0.88, 0.99] (small-sample likelihood intervals are known to be slightly liberal)',
    seeds,
    metrics: { coverage: r3(c), mean_bias: r3(err.reduce((a, b) => a + b, 0) / Math.max(1, err.length)) },
    pass: c >= 0.88 && c <= 0.99,
  };
}

/**
 * E4 — When is the exponential time constant identifiable?
 * Pilot (12 seeds, τ = 21 d): both designs were identifiable in every seed, so the scenario did not discriminate;
 * redesigned BEFORE the reported run to τ = 60 d (a slow curve, closer to rehabilitation time scales).
 */
export function e4ExponentialIdentifiability(seeds: number): ExperimentResult {
  const scen = [
    { name: 'sparse_8_weekly', t: weekly(8) },
    { name: 'dense_24_every_4_days', t: Array.from({ length: 24 }, (_, i) => 4 * i) },
    { name: 'long_16_weekly', t: weekly(16) },
  ];
  const tau = 60;
  const metrics: Record<string, number> = {};
  for (const sc of scen) {
    const ident: boolean[] = [];
    const cover: boolean[] = [];
    for (let s = 0; s < seeds; s++) {
      const z = sc.t.map((x) => 150 + (90 - 150) * Math.exp(-x / tau));
      const { fit } = fitModel('exponential', synth(sc.t, z, 4000 + s), { doseMode: 'per_visit' });
      if (fit.status !== 'ok') continue;
      ident.push(fit.identifiable);
      const p = fit.profiles.find((x) => x.param === 'time_constant_days')!;
      cover.push(p.lo <= tau && p.hi >= tau);
    }
    metrics[`${sc.name}_identifiable`] = r3(frac(ident));
    metrics[`${sc.name}_tau_coverage`] = r3(frac(cover));
  }
  const pass = (metrics.long_16_weekly_identifiable ?? 0) > (metrics.sparse_8_weekly_identifiable ?? 1);
  return {
    id: 'E4',
    question: 'Can a slow learning-curve time constant (τ = 60 d) be estimated from 8 weekly sessions, 24 sessions every 4 days, or 16 weekly sessions?',
    design: 'Exponential approach 90 → 150 units; σε = 4, σs = 2.5, 3 repetitions',
    criterion: '16 weekly sessions identifiable more often than 8 weekly sessions',
    seeds,
    metrics,
    pass,
  };
}

/**
 * E5 — Is "forgetting" distinguishable from "saturation"?
 * Pilot finding (12 seeds): on a regular weekly schedule with constant dose the half-life WAS identifiable inside
 * the learning–retention model — because the model is then a re-parameterisation of the exponential curve: the
 * curvature is attributed to forgetting by assumption, not by evidence. The scientifically relevant test is
 * therefore whether the data prefer learning–retention over the exponential (saturation-only) model.
 */
export function e5RetentionVsSaturation(seeds: number): ExperimentResult {
  const truth = { z1: 80, h: 21, g: 0.3 };
  const regularT = weekly(10);
  const regularDose = regularT.map((_, i) => (i === 0 ? 0 : 40));
  const gapT = [0, 7, 14, 21, 28, 56, 63, 70, 77, 119];
  const gapDose = [0, 40, 60, 20, 40, 0, 50, 30, 60, 0];
  const metrics: Record<string, number> = {};
  for (const sc of [
    { name: 'regular_weekly_constant_dose', t: regularT, dose: regularDose },
    { name: 'breaks_and_variable_dose', t: gapT, dose: gapDose },
  ]) {
    const prefer: boolean[] = [];
    const cover: boolean[] = [];
    const relErr: number[] = [];
    for (let s = 0; s < seeds; s++) {
      const z: number[] = [truth.z1];
      for (let k = 1; k < sc.t.length; k++) z.push(lrStep(z[k - 1] as number, truth.z1, truth.h, truth.g, sc.dose[k] as number, (sc.t[k] as number) - (sc.t[k - 1] as number)));
      const c = compareModels(synth(sc.t, z, 5000 + s, sc.dose), { doseMode: 'practice_minutes', models: ['exponential', 'learning_retention'] });
      const lr = c.rows.find((r) => r.model === 'learning_retention')!;
      const ex = c.rows.find((r) => r.model === 'exponential')!;
      if (lr.fit.status !== 'ok' || ex.fit.status !== 'ok') continue;
      prefer.push(ex.fit.aicc - lr.fit.aicc > 2);
      const p = lr.fit.profiles.find((x) => x.param === 'retention_half_life_days')!;
      cover.push(p.lo <= truth.h && p.hi >= truth.h);
      relErr.push(Math.abs((lr.fit.params[1] as number) - truth.h) / truth.h);
    }
    metrics[`${sc.name}_retention_preferred`] = r3(frac(prefer));
    metrics[`${sc.name}_half_life_coverage`] = r3(frac(cover));
    metrics[`${sc.name}_median_rel_error`] = r3(median(relErr));
  }
  const pass = (metrics.breaks_and_variable_dose_retention_preferred ?? 0) >= 0.5 && (metrics.regular_weekly_constant_dose_retention_preferred ?? 1) <= 0.2;
  return {
    id: 'E5',
    question: 'With 10 sessions, do the data favour forgetting (learning–retention) over saturation (exponential) when forgetting is true?',
    design: 'Truth: learning–retention, h = 21 d, gain 0.3 units/min; regular weekly 40 min vs 4- and 6-week breaks with 20–60 min doses',
    criterion: 'ΔAICc > 2 in favour of learning–retention in ≥ 50 % of seeds with breaks, ≤ 20 % with the regular schedule',
    seeds,
    metrics,
    pass,
  };
}

/** E6 — Dual-rate model: dense paradigm with error signal vs sparse assessment-like observation. */
export function e6DualRate(seeds: number): ExperimentResult {
  const truth: DualRateParams = { Af: 0.92, As: 0.996, Bf: 0.1, Bs: 0.02, sigma: 0.08 };
  const base = smithParadigm();
  const N = base.p.length;
  const scen = [
    { name: 'dense_every_trial', observed: base.p.map(() => true) },
    { name: 'sparse_10_trials', observed: base.p.map((_, i) => i % Math.floor(N / 10) === 0) },
  ];
  const metrics: Record<string, number> = {};
  for (const sc of scen) {
    const identAll: boolean[] = [];
    const errAs: number[] = [];
    for (let s = 0; s < seeds; s++) {
      const sched = { ...base, observed: sc.observed };
      const y = simulateDualRate(truth, sched, 6000 + s);
      const f = fitDualRate(sched, y);
      identAll.push(!f.profiles.Af.open && !f.profiles.As.open && !f.profiles.Bf.open && !f.profiles.Bs.open);
      errAs.push(Math.abs(f.params.Bs - truth.Bs) / truth.Bs);
    }
    metrics[`${sc.name}_all_rates_identifiable`] = r3(frac(identAll));
    metrics[`${sc.name}_Bs_median_rel_error`] = r3(median(errAs));
  }
  const pass = (metrics.dense_every_trial_all_rates_identifiable ?? 0) > (metrics.sparse_10_trials_all_rates_identifiable ?? 1);
  return {
    id: 'E6',
    question: 'Are fast/slow learning rates recoverable from assessment-like sparse data, or only from dense error-driven trials?',
    design: `Smith 2006 paradigm (${N} trials: baseline, adaptation, reversal, error clamp); A_f 0.92, A_s 0.996, B_f 0.10, B_s 0.02, σ 0.08`,
    criterion: 'dense observation identifies all four rates more often than 10 sparse observations',
    seeds,
    metrics,
    pass,
  };
}

/**
 * E7 — Calibration of prediction intervals for the next session.
 * Pilot (20 seeds): plug-in intervals (MLE only) covered 0.77 — they ignore parameter uncertainty. The reported
 * experiment therefore compares plug-in with the parametric-bootstrap intervals the Motor Twin displays.
 */
export function e7PredictionCalibration(seeds: number, B = 150): ExperimentResult {
  const t = weekly(10);
  const plug: boolean[] = [];
  const boot: boolean[] = [];
  for (let s = 0; s < seeds; s++) {
    const truthNext = 100 + (1.5 * 70) / 7;
    const all = synth([...t, 70], [...t, 70].map((x) => 100 + (1.5 * x) / 7), 7000 + s);
    const yNext = all.y[10] as number;
    const train: ModelData = { t: all.t.slice(0, 10), y: all.y.slice(0, 10), n: all.n.slice(0, 10), dose: all.dose.slice(0, 10), ss: all.ss.slice(0, 10), sessionIds: all.sessionIds.slice(0, 10) };
    const { fit, prepared } = fitModel('linear', train, { doseMode: 'per_visit', profiles: false });
    if (fit.status !== 'ok') continue;
    const bs = bootstrap(fit, prepared, B, 9000 + s);
    const [band] = predictiveBands(fit, prepared, bs, [{ t: 70, dose: 1 }], 3, 9000 + s);
    if (!band) continue;
    plug.push(yNext >= band.plugLo && yNext <= band.plugHi);
    boot.push(yNext >= band.obsLo && yNext <= band.obsHi);
    void truthNext;
  }
  const cb = frac(boot);
  return {
    id: 'E7',
    question: 'Do 95 % intervals for the NEXT session mean contain it ~95 % of the time (plug-in vs bootstrap)?',
    design: 'True linear change 1.5/week; fit on 10 weekly sessions; predict an 11th session one week later; B = ' + B,
    criterion: 'bootstrap interval coverage in [0.88, 0.99]',
    seeds,
    metrics: { plugin_coverage: r3(frac(plug)), bootstrap_coverage: r3(cb), n: boot.length },
    pass: cb >= 0.88 && cb <= 0.99,
  };
}

/** E8 — Sample-size planning example: power for a 2 units/week change as a function of sessions and repetitions. */
export function e8DesignPower(seeds: number): ExperimentResult {
  const metrics: Record<string, number> = {};
  for (const design of [
    { sessions: 8, reps: 3 },
    { sessions: 8, reps: 6 },
    { sessions: 12, reps: 3 },
    { sessions: 12, reps: 6 },
  ]) {
    const t = weekly(design.sessions);
    const det: boolean[] = [];
    for (let s = 0; s < seeds; s++) {
      const c = compareModels(synth(t, t.map((x) => 100 + (2 * x) / 7), 8000 + s, undefined, { ...SIM_NOISE, reps: design.reps }), { doseMode: 'per_visit', models: ['stationary', 'linear', 'local_level'] });
      det.push(c.selected !== 'stationary');
    }
    metrics[`power_${design.sessions}_sessions_${design.reps}_reps`] = r3(frac(det));
  }
  return {
    id: 'E8',
    question: 'How do more sessions or more repetitions per session change the power to detect 2 units/week?',
    design: 'True linear change 2 units/week, σε = 4, σs = 2.5; weekly sessions',
    criterion: 'descriptive (planning table) — passes when computed',
    seeds,
    metrics,
    pass: true,
  };
}

export function runAll(full: boolean): ExperimentResult[] {
  const n = full ? 200 : 12;
  const nHeavy = full ? 40 : 4;
  return [
    e1FalseChange(n),
    e2TrendPower(full ? 100 : 8),
    e3SlopeCoverage(n),
    e4ExponentialIdentifiability(nHeavy),
    e5RetentionVsSaturation(nHeavy),
    e6DualRate(full ? 12 : 2),
    e7PredictionCalibration(full ? 100 : 6, full ? 150 : 60),
    e8DesignPower(full ? 100 : 6),
  ];
}
