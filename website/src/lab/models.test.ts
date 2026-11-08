// Ground-truth tests of the learning-dynamics models: simulate from KNOWN parameters, fit, and check that the
// estimates, intervals, model selection and identifiability flags behave as specified
// (research/model-validation.md reports the full recovery experiments; these are the fast regression guards).

import { describe, expect, it } from 'vitest';
import { createRng } from '../lib/random';
import type { ModelData } from './dataset';
import { bootstrap, compareModels, fitModel, leaveFutureOut, predictiveBands, prepareWithSS, slicePrepared } from './fit';
import { lrStep, MODELS, toFree, toNatural, type ModelId } from './models';
import { hessian, invert, minimize, nelderMead, normCdf, normQuantile } from './numeric';

/** Synthetic series: latent means z_k, repetition noise σε, session noise σs, `reps` repetitions per session. */
function synth(t: number[], z: number[], o: { sigmaE: number; sigmaS: number; reps: number; seed: number; dose?: number[] }): ModelData {
  const rng = createRng(o.seed);
  const y: number[] = [];
  const ss: number[] = [];
  t.forEach((_, k) => {
    const eta = rng.normal(0, o.sigmaS);
    const reps = Array.from({ length: o.reps }, () => (z[k] as number) + eta + rng.normal(0, o.sigmaE));
    const m = reps.reduce((a, b) => a + b, 0) / reps.length;
    y.push(m);
    ss.push(reps.reduce((a, v) => a + (v - m) ** 2, 0));
  });
  return { t, y, n: t.map(() => o.reps), dose: o.dose ?? t.map(() => 0), ss, sessionIds: t.map((_, i) => `s${i}`) };
}

const weekly = (n: number) => Array.from({ length: n }, (_, i) => 7 * i);

describe('numeric core', () => {
  it('Nelder–Mead finds the Rosenbrock minimum', () => {
    const r = minimize((x) => 100 * ((x[1] as number) - (x[0] as number) ** 2) ** 2 + (1 - (x[0] as number)) ** 2, [[-1.2, 1]], { maxIterations: 5000 });
    expect(r.x[0]).toBeCloseTo(1, 4);
    expect(r.x[1]).toBeCloseTo(1, 4);
  });
  it('Hessian and inverse of a quadratic are exact', () => {
    const f = (x: number[]) => 3 * (x[0] as number) ** 2 + 2 * (x[0] as number) * (x[1] as number) + (x[1] as number) ** 2;
    const H = hessian(f, [0.3, -0.2]);
    expect(H[0]![0]).toBeCloseTo(6, 4);
    expect(H[0]![1]).toBeCloseTo(2, 4);
    const C = invert(H)!;
    expect(C[0]![0]).toBeCloseTo(0.25, 4);
    expect(C[1]![1]).toBeCloseTo(0.75, 4);
    expect(invert([[1, 2], [2, 4]])).toBeNull();
  });
  it('normal CDF and quantile agree with reference values', () => {
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 6);
    expect(normQuantile(0.975)).toBeCloseTo(1.959963984540054, 8);
    expect(normQuantile(0.001)).toBeCloseTo(-3.090232306167813, 7);
  });
  it('a 1-D Nelder–Mead converges on a parabola', () => {
    const r = nelderMead((x) => ((x[0] as number) - 3) ** 2, [0]);
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(3, 5);
  });
  it('bounded-log transform round-trips', () => {
    const tr = { kind: 'bounded_log' as const, lo: 1, hi: 3650 };
    for (const v of [1.5, 30, 1000]) expect(toNatural(tr, toFree(tr, v))).toBeCloseTo(v, 6);
  });
});

describe('measurement model', () => {
  it('σε is the pooled within-session SD and is recovered', () => {
    const t = weekly(12);
    const d = synth(t, t.map(() => 100), { sigmaE: 4, sigmaS: 2, reps: 5, seed: 1 });
    const p = prepareWithSS(d, 'per_visit');
    expect(Math.sqrt(p.sigmaE2)).toBeGreaterThan(3);
    expect(Math.sqrt(p.sigmaE2)).toBeLessThan(5);
    expect(p.dfE).toBe(48);
  });
  it('leave-future-out folds re-estimate σε from the training sessions only', () => {
    const t = weekly(8);
    const d = synth(t, t.map(() => 100), { sigmaE: 4, sigmaS: 0.5, reps: 4, seed: 2 });
    // make the LAST session much noisier: it must not influence σε of the first 7
    d.ss[7] = 1e6;
    const p = prepareWithSS(d, 'per_visit');
    const s7 = slicePrepared(p, 7);
    expect(Math.sqrt(s7.sigmaE2)).toBeLessThan(10);
    expect(Math.sqrt(p.sigmaE2)).toBeGreaterThan(100);
  });
});

describe('parameter recovery (known ground truth)', () => {
  it('stationary: μ recovered, interval covers truth, stationary is selected', () => {
    const t = weekly(10);
    const d = synth(t, t.map(() => 120), { sigmaE: 5, sigmaS: 2, reps: 3, seed: 3 });
    const c = compareModels(d, { doseMode: 'per_visit' });
    const st = c.rows.find((r) => r.model === 'stationary')!.fit;
    expect(st.params[0]).toBeGreaterThan(115);
    expect(st.params[0]).toBeLessThan(125);
    const pr = st.profiles[0]!;
    expect(pr.lo).toBeLessThan(120);
    expect(pr.hi).toBeGreaterThan(120);
    expect(c.selected).toBe('stationary');
  });

  it('linear: slope per week recovered and selected over stationary', () => {
    const t = weekly(10);
    const d = synth(t, t.map((x) => 90 + (3 * x) / 7), { sigmaE: 4, sigmaS: 1.5, reps: 3, seed: 4 });
    const c = compareModels(d, { doseMode: 'per_visit' });
    const lin = c.rows.find((r) => r.model === 'linear')!.fit;
    expect(lin.params[1]).toBeGreaterThan(2.2);
    expect(lin.params[1]).toBeLessThan(3.8);
    expect(c.selected).not.toBe('stationary');
    expect(c.rows.find((r) => r.model === 'stationary')!.deltaAicc).toBeGreaterThan(4);
  });

  it('exponential: asymptote and time constant recovered from a long, dense series', () => {
    const t = Array.from({ length: 24 }, (_, i) => 4 * i);
    const z = t.map((x) => 150 + (80 - 150) * Math.exp(-x / 20));
    const d = synth(t, z, { sigmaE: 3, sigmaS: 1, reps: 5, seed: 5 });
    const { fit } = fitModel('exponential', d, { doseMode: 'per_visit' });
    expect(fit.status).toBe('ok');
    expect(fit.params[0]).toBeGreaterThan(145);
    expect(fit.params[0]).toBeLessThan(155);
    expect(fit.params[2]).toBeGreaterThan(14);
    expect(fit.params[2]).toBeLessThan(28);
    expect(fit.identifiable).toBe(true);
  });

  it('exponential far from plateau: the time-constant interval does not close — flagged as not identifiable', () => {
    const t = weekly(6);
    const z = t.map((x) => 200 + (80 - 200) * Math.exp(-x / 300)); // nearly linear over 5 weeks
    const d = synth(t, z, { sigmaE: 4, sigmaS: 1, reps: 3, seed: 6 });
    const { fit } = fitModel('exponential', d, { doseMode: 'per_visit' });
    expect(fit.status).toBe('ok');
    expect(fit.identifiable).toBe(false);
    const tau = fit.profiles.find((p) => p.param === 'time_constant_days')!;
    expect(tau.hiOpen || tau.loOpen).toBe(true);
  });

  it('local level: drift recovered in order of magnitude; smoothed state tracks the truth', () => {
    const rng = createRng(7);
    const t = Array.from({ length: 30 }, (_, i) => 3 * i);
    const z: number[] = [];
    let x = 100;
    for (let k = 0; k < t.length; k++) {
      if (k > 0) x += rng.normal(0, Math.sqrt(2 * 3)); // q = 2 per day
      z.push(x);
    }
    const d = synth(t, z, { sigmaE: 3, sigmaS: 0.5, reps: 4, seed: 8 });
    const { fit } = fitModel('local_level', d, { doseMode: 'per_visit' });
    expect(fit.status).toBe('ok');
    expect(fit.params[1]).toBeGreaterThan(0.5);
    expect(fit.params[1]).toBeLessThan(8);
    const err = fit.latent.mean.map((m, i) => Math.abs(m - (z[i] as number)));
    expect(err.reduce((a, b) => a + b, 0) / err.length).toBeLessThan(3);
  });

  it('learning–retention: half-life and gain recovered when the schedule has gaps and dose varies', () => {
    // 3 blocks of weekly practice with 3- and 6-week breaks; dose varies 20–60 minutes
    const t = [0, 7, 14, 21, 28, 49, 56, 63, 70, 112, 119, 126, 133, 140];
    const dose = [0, 40, 60, 20, 40, 0, 50, 30, 60, 0, 40, 40, 20, 60];
    const truth = { z1: 80, h: 21, g: 0.4 };
    const z: number[] = [truth.z1];
    for (let k = 1; k < t.length; k++) z.push(lrStep(z[k - 1] as number, truth.z1, truth.h, truth.g, dose[k] as number, (t[k] as number) - (t[k - 1] as number)));
    const d = synth(t, z, { sigmaE: 2, sigmaS: 0.8, reps: 5, seed: 9, dose });
    const { fit } = fitModel('learning_retention', d, { doseMode: 'practice_minutes' });
    expect(fit.status).toBe('ok');
    expect(fit.params[1]).toBeGreaterThan(12);
    expect(fit.params[1]).toBeLessThan(40);
    expect(fit.params[2]).toBeGreaterThan(0.3);
    expect(fit.params[2]).toBeLessThan(0.55);
    expect(fit.identifiable).toBe(true);
    const h = fit.profiles.find((p) => p.param === 'retention_half_life_days')!;
    expect(h.lo).toBeLessThan(21);
    expect(h.hi).toBeGreaterThan(21);
  });

  it('learning–retention on a regular weekly schedule with constant dose: retention is NOT identified', () => {
    const t = weekly(7);
    const dose = t.map((_, i) => (i === 0 ? 0 : 1));
    const z: number[] = [80];
    for (let k = 1; k < t.length; k++) z.push(lrStep(z[k - 1] as number, 80, 200, 4, 1, 7));
    const d = synth(t, z, { sigmaE: 4, sigmaS: 1.5, reps: 3, seed: 10, dose });
    const { fit } = fitModel('learning_retention', d, { doseMode: 'per_visit' });
    expect(fit.status).toBe('ok');
    expect(fit.identifiable).toBe(false);
  });
});

describe('model comparison and validation', () => {
  it('leave-future-out never uses the predicted session (refit per fold)', () => {
    const t = weekly(9);
    const d = synth(t, t.map((x) => 100 + x / 7), { sigmaE: 3, sigmaS: 1, reps: 3, seed: 11 });
    const p = prepareWithSS(d, 'per_visit');
    const a = leaveFutureOut('linear', p, 5);
    const changed = { ...p, y: [...p.y] };
    changed.y[8] = 10_000; // corrupt the last target: earlier folds must be unchanged
    const b = leaveFutureOut('linear', changed, 5);
    expect(a.folds.slice(0, 3).map((f) => f.predMean)).toEqual(b.folds.slice(0, 3).map((f) => f.predMean));
    expect(a.folds.length).toBe(4);
  });

  it('too few sessions: complex models report insufficient data instead of a curve', () => {
    const t = weekly(3);
    const d = synth(t, [100, 105, 110], { sigmaE: 3, sigmaS: 1, reps: 3, seed: 12 });
    const c = compareModels(d, { doseMode: 'per_visit' });
    for (const id of ['linear', 'exponential', 'local_level', 'learning_retention'] as ModelId[]) {
      expect(c.rows.find((r) => r.model === id)!.fit.status).toBe('insufficient_data');
    }
    expect(c.selected).toBe('stationary');
  });

  it('bootstrap and small-sample-corrected plug-in intervals agree and both cover a held-out truth', () => {
    const t = weekly(8);
    const d = synth(t, t.map((x) => 100 + (2 * x) / 7), { sigmaE: 3, sigmaS: 1, reps: 3, seed: 13 });
    const p = prepareWithSS(d, 'per_visit');
    const { fit } = fitModel('linear', d, { doseMode: 'per_visit' });
    const boot = bootstrap(fit, p, 200, 42);
    expect(boot.ok).toBeGreaterThan(190);
    const [band] = predictiveBands(fit, p, boot, [{ t: 70, dose: 1 }], 3, 42);
    const ratio = (band!.obsHi - band!.obsLo) / (band!.plugHi - band!.plugLo);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.5);
    expect(band!.plugLo).toBeLessThan(100 + (2 * 70) / 7);
    expect(band!.plugHi).toBeGreaterThan(100 + (2 * 70) / 7);
    const truth = 100 + (2 * 70) / 7;
    expect(band!.obsLo).toBeLessThan(truth);
    expect(band!.obsHi).toBeGreaterThan(truth);
  });

  it('is deterministic: same input and seed → identical output', () => {
    const t = weekly(7);
    const d = synth(t, t.map((x) => 100 + x / 7), { sigmaE: 3, sigmaS: 1, reps: 3, seed: 14 });
    const p = prepareWithSS(d, 'per_visit');
    const { fit } = fitModel('linear', d, { doseMode: 'per_visit' });
    expect(bootstrap(fit, p, 50, 7)).toEqual(bootstrap(fit, p, 50, 7));
  });

  it('every model simulate() → fit() round-trips its own likelihood maximum', () => {
    const t = weekly(10);
    const d = synth(t, t.map(() => 100), { sigmaE: 3, sigmaS: 1, reps: 3, seed: 15 });
    const p = prepareWithSS(d, 'per_visit');
    for (const id of Object.keys(MODELS) as ModelId[]) {
      const { fit } = fitModel(id, d, { doseMode: 'per_visit' });
      expect(fit.status).toBe('ok');
      // the MLE log-likelihood is at least that of the starting points
      for (const s of MODELS[id].starts(p)) expect(fit.logLik).toBeGreaterThanOrEqual(MODELS[id].logLik(s, p) - 1e-6);
    }
  });
});
