// Fitting, uncertainty, validation and comparison of the candidate models (models.ts).
//
//   Estimation     maximum likelihood, multi-start Nelder–Mead in unconstrained parameters
//   Uncertainty    (a) profile likelihood 95 % intervals for interpretable parameters (Raue et al. 2009,
//                      doi:10.1093/bioinformatics/btp358) — an interval that does not close before the parameter's
//                      bound means the parameter is NOT practically identifiable from these data;
//                  (b) parametric bootstrap (Stoffer & Wall 1991, doi:10.1080/01621459.1991.10475148) for
//                      prediction intervals that include parameter uncertainty, and for model checks.
//   Comparison     AICc (Hurvich & Tsai 1989, doi:10.1093/biomet/76.2.297), Akaike weights (Burnham & Anderson 2004),
//                  and exact leave-future-out one-step-ahead prediction (Bürkner et al. 2020,
//                  doi:10.1080/00949655.2020.1783262) — never random splits of sessions of one person.
//   Selection      documented, conservative rule: see selectModel().
//
// Deterministic: every random draw comes from a seeded generator, so the same input gives the same output
// (a requirement of frozen analysis runs, runs.ts).

import { createRng, type Rng } from '../lib/random';
import { tQuantile } from '../research/stats';
import type { ModelData } from './dataset';
import { CHI2_1_95, hessian, invert, lag1, minimize, normCdf, normLogPdf, normQuantile, quantile } from './numeric';
import { MODELS, MODEL_IDS, prepare, toFree, toNatural, type DoseMode, type ModelId, type ModelSpec, type Prepared } from './models';

export type FitStatus = 'ok' | 'insufficient_data' | 'failed';

export interface ProfileInterval {
  param: string;
  estimate: number;
  lo: number;
  hi: number;
  /** The likelihood did not fall by χ²₁(0.95)/2 before the parameter bound: that side is unbounded by the data. */
  loOpen: boolean;
  hiOpen: boolean;
}

export interface ModelFit {
  model: ModelId;
  status: FitStatus;
  reason?: string;
  /** Natural parameters at the MLE (σ_ε is in `prepared`). */
  params: number[];
  logLik: number;
  k: number;
  aic: number;
  aicc: number;
  bic: number;
  converged: boolean;
  /** Wald SE in the free parameterisation from the observed information; null when the Hessian is not positive definite. */
  freeSE: (number | null)[];
  profiles: ProfileInterval[];
  /** Every interpretable parameter has a closed profile interval. */
  identifiable: boolean;
  residuals: number[];
  latent: { mean: number[]; var: number[] };
}

export interface FitOptions {
  doseMode: DoseMode;
  /** Practice-record counts per interval (dose mode 'practice_sessions'). */
  sessionsCount?: readonly (number | null)[];
  /** Skip profile likelihood (used inside bootstrap and leave-future-out refits). */
  profiles?: boolean;
}

function freeStarts(spec: ModelSpec, d: Prepared): number[][] {
  return spec.starts(d).map((p) => p.map((v, i) => toFree(spec.params[i]!.transform, v)));
}
const natural = (spec: ModelSpec, u: readonly number[]) => u.map((v, i) => toNatural(spec.params[i]!.transform, v));

/** Negative log-likelihood in free parameters, with a weak barrier keeping scale parameters away from 0 and ∞. */
function objective(spec: ModelSpec, d: Prepared): (u: number[]) => number {
  const floor = Math.log(1e-6 * d.scale);
  const ceil = Math.log(1e3 * d.scale);
  return (u) => {
    const p = natural(spec, u);
    let pen = 0;
    spec.params.forEach((def, i) => {
      if (def.transform.kind === 'log' && def.name === 'sigma_session') {
        const v = u[i] as number;
        if (v < floor) pen += (floor - v) ** 2;
        if (v > ceil) pen += (v - ceil) ** 2;
      }
    });
    const ll = spec.logLik(p, d);
    return Number.isFinite(ll) ? -ll + pen : Number.POSITIVE_INFINITY;
  };
}

export function fitPrepared(id: ModelId, d: Prepared, o: { profiles?: boolean; start?: number[] } = {}): ModelFit {
  const spec = MODELS[id];
  const K = d.y.length;
  const k = spec.params.length;
  const empty: ModelFit = {
    model: id,
    status: 'insufficient_data',
    params: [],
    logLik: NaN,
    k,
    aic: Infinity,
    aicc: Infinity,
    bic: Infinity,
    converged: false,
    freeSE: [],
    profiles: [],
    identifiable: false,
    residuals: [],
    latent: { mean: [], var: [] },
  };
  if (K < spec.minSessions) return { ...empty, reason: `needs ≥ ${spec.minSessions} included sessions (has ${K})` };
  if (spec.usesDose && d.dose.slice(1).every((x) => x === 0)) return { ...empty, reason: 'dose is zero in every interval: gain is not estimable' };
  const f = objective(spec, d);
  const starts = o.start ? [o.start.map((v, i) => toFree(spec.params[i]!.transform, v))] : freeStarts(spec, d);
  let r;
  try {
    r = minimize(f, starts, { maxIterations: 3000 });
  } catch {
    return { ...empty, status: 'failed', reason: 'optimiser error' };
  }
  if (!Number.isFinite(r.fx)) return { ...empty, status: 'failed', reason: 'no finite likelihood' };
  const p = natural(spec, r.x);
  const ll = spec.logLik(p, d);
  const aic = 2 * k - 2 * ll;
  const aicc = K - k - 1 > 0 ? aic + (2 * k * (k + 1)) / (K - k - 1) : Infinity;
  const bic = k * Math.log(K) - 2 * ll;
  let freeSE: (number | null)[] = spec.params.map(() => null);
  const H = hessian(f, r.x);
  const C = invert(H);
  if (C) freeSE = C.map((row, i) => (row[i]! > 0 ? Math.sqrt(row[i] as number) : null));
  const profiles = o.profiles === false ? [] : profileAll(spec, d, r.x, -r.fx, freeSE);
  return {
    model: id,
    status: 'ok',
    params: p,
    logLik: ll,
    k,
    aic,
    aicc,
    bic,
    converged: r.converged,
    freeSE,
    profiles,
    identifiable: profiles.length > 0 ? profiles.every((x) => !x.loOpen && !x.hiOpen) : false,
    residuals: spec.residuals(p, d),
    latent: spec.latent(p, d),
  };
}

export function fitModel(id: ModelId, data: ModelData, o: FitOptions): { fit: ModelFit; prepared: Prepared } {
  const d = prepare(data, o.doseMode, o.sessionsCount);
  return { fit: fitPrepared(id, d, o), prepared: d };
}

// ── profile likelihood ─────────────────────────────────────────────────────────────────────────

const PROFILE_RANGE = 14; // in free units; beyond this a bounded transform is at its bound for practical purposes

function profileAll(spec: ModelSpec, d: Prepared, uHat: readonly number[], llMax: number, se: readonly (number | null)[]): ProfileInterval[] {
  const out: ProfileInterval[] = [];
  const f = objective(spec, d);
  spec.params.forEach((def, i) => {
    if (!def.interpretable) return;
    const others = uHat.filter((_, j) => j !== i);
    const prof = (ui: number): number => {
      const g = (w: number[]) => {
        const u = [...w.slice(0, i), ui, ...w.slice(i)];
        return f(u);
      };
      // re-optimise the other parameters from the MLE (and from the previous profile point)
      const r = minimize(g, [others], { maxIterations: 1500 });
      return -r.fx;
    };
    const thr = llMax - CHI2_1_95 / 2;
    // Free units are natural units for untransformed parameters, log units otherwise
    const unbounded = def.transform.kind === 'none';
    const sei = se[i];
    const step0 = unbounded ? (sei && sei > 0 ? 0.5 * sei : 0.1 * d.scale) : Math.max(0.05, Math.min(1, (sei ?? 0.5) * 0.5));
    const side = (dir: 1 | -1): { u: number; open: boolean } => {
      let a = uHat[i] as number;
      let step = step0;
      // Unbounded natural parameters get a search range relative to the data scale (and to their own SE)
      const lim = unbounded ? Math.max(50 * d.scale, 20 * (sei ?? 0)) : PROFILE_RANGE;
      while (Math.abs(a - (uHat[i] as number)) < lim) {
        const b = a + dir * step;
        const lb = prof(b);
        if (!(lb > thr)) {
          // bisection between a (inside) and b (outside)
          let lo = a;
          let hi = b;
          for (let it = 0; it < 18; it++) {
            const m = (lo + hi) / 2;
            if (prof(m) > thr) lo = m;
            else hi = m;
          }
          return { u: (lo + hi) / 2, open: false };
        }
        a = b;
        step *= 1.6;
      }
      return { u: a, open: true };
    };
    const lo = side(-1);
    const hi = side(1);
    const tr = def.transform;
    out.push({
      param: def.name,
      estimate: toNatural(tr, uHat[i] as number),
      lo: lo.open && tr.kind === 'bounded_log' ? tr.lo : lo.open && tr.kind === 'none' ? -Infinity : lo.open && tr.kind === 'log' ? 0 : toNatural(tr, lo.u),
      hi: hi.open && tr.kind === 'bounded_log' ? tr.hi : hi.open ? Infinity : toNatural(tr, hi.u),
      // A variance-type parameter whose interval reaches 0 is still bounded by the data ("≤ hi"): not open
      loOpen: lo.open && tr.kind !== 'log',
      hiOpen: hi.open,
    });
  });
  return out;
}

// ── leave-future-out validation ────────────────────────────────────────────────────────────────

export interface LfoFold {
  /** Index of the predicted session among included sessions. */
  target: number;
  observed: number;
  predMean: number;
  predSD: number;
  logDensity: number;
  absError: number;
  inside95: boolean;
}

export interface LfoResult {
  model: ModelId;
  folds: LfoFold[];
  elpd: number;
  mae: number;
  coverage95: number;
}

/** Fit on sessions 1..m, predict session m+1 — for every m ≥ firstTrain−1. Exact (refits every fold). */
export function leaveFutureOut(id: ModelId, d: Prepared, firstTarget: number): LfoResult {
  const folds: LfoFold[] = [];
  for (let target = firstTarget; target < d.y.length; target++) {
    const train = slicePrepared(d, target);
    const fit = fitPrepared(id, train, { profiles: false });
    if (fit.status !== 'ok') continue;
    const spec = MODELS[id];
    const fc = spec.forecast(fit.params, train, [{ t: d.t[target] as number, dose: d.dose[target] as number }])[0]!;
    const sigmaS = fit.params[fit.params.length - 1] as number;
    const v = fc.varLatent + sigmaS * sigmaS + train.sigmaE2 / Math.max(1, d.n[target] as number);
    const y = d.y[target] as number;
    const sdv = Math.sqrt(v);
    folds.push({
      target,
      observed: y,
      predMean: fc.mean,
      predSD: sdv,
      logDensity: normLogPdf(y, fc.mean, v),
      absError: Math.abs(y - fc.mean),
      inside95: Math.abs(y - fc.mean) <= 1.959963984540054 * sdv,
    });
  }
  const n = folds.length;
  return {
    model: id,
    folds,
    elpd: folds.reduce((a, f) => a + f.logDensity, 0),
    mae: n ? folds.reduce((a, f) => a + f.absError, 0) / n : NaN,
    coverage95: n ? folds.filter((f) => f.inside95).length / n : NaN,
  };
}

/** The first m sessions, with σ_ε re-estimated from them only (no information from the future leaks in). */
export function slicePrepared(d: Prepared, m: number): Prepared {
  // σ_ε² from the first m sessions: recover their SS from the stored pooled estimate is impossible, so the caller's
  // within-session SS are carried in sessionSS (see prepareWithSS). Fallback: keep the pooled estimate.
  const ss = (d as Prepared & { ss?: number[] }).ss;
  let sigmaE2 = d.sigmaE2;
  let dfE = d.dfE;
  if (ss) {
    let s = 0;
    let df = 0;
    for (let k = 0; k < m; k++) {
      s += ss[k] as number;
      df += Math.max(0, (d.n[k] as number) - 1);
    }
    sigmaE2 = df > 0 ? s / df : 0;
    dfE = df;
  }
  const y = d.y.slice(0, m);
  const out: Prepared & { ss?: number[] } = {
    ...d,
    t: d.t.slice(0, m),
    y,
    n: d.n.slice(0, m),
    dose: d.dose.slice(0, m),
    sigmaE2,
    dfE,
    sessionIds: d.sessionIds.slice(0, m),
  };
  if (ss) out.ss = ss.slice(0, m);
  return out;
}

/** prepare() that also keeps the per-session SS, so leave-future-out folds re-estimate σ_ε without leakage. */
export function prepareWithSS(data: ModelData, doseMode: DoseMode, sessionsCount?: readonly (number | null)[]): Prepared {
  const d = prepare(data, doseMode, sessionsCount) as Prepared & { ss?: number[] };
  d.ss = [...data.ss];
  return d;
}

// ── parametric bootstrap ───────────────────────────────────────────────────────────────────────

/** χ² draw with ν degrees of freedom (sum of squared normals; ν is small here). */
function chi2(rng: Rng, nu: number): number {
  let s = 0;
  for (let i = 0; i < nu; i++) {
    const z = rng.normal();
    s += z * z;
  }
  return s;
}

export interface BootstrapResult {
  model: ModelId;
  replicates: number;
  /** Successful refits. */
  ok: number;
  params: number[][];
  sigmaE2: number[];
  /** Per replicate: residual lag-1 autocorrelation and max |standardised residual| after refit (model checks). */
  lag1: number[];
  maxAbs: number[];
}

export function bootstrap(fit: ModelFit, d: Prepared, B: number, seed: number): BootstrapResult {
  const spec = MODELS[fit.model];
  const rng = createRng(seed);
  const params: number[][] = [];
  const sE: number[] = [];
  const l1: number[] = [];
  const mx: number[] = [];
  for (let b = 0; b < B; b++) {
    const y = spec.simulate(fit.params, d, rng);
    const sigmaE2 = d.dfE > 0 ? (d.sigmaE2 * chi2(rng, d.dfE)) / d.dfE : 0;
    const db: Prepared = { ...d, y, sigmaE2 };
    const f = fitPrepared(fit.model, db, { profiles: false, start: fit.params });
    if (f.status !== 'ok') continue;
    params.push(f.params);
    sE.push(sigmaE2);
    l1.push(lag1(f.residuals));
    mx.push(Math.max(...f.residuals.map(Math.abs)));
  }
  return { model: fit.model, replicates: B, ok: params.length, params, sigmaE2: sE, lag1: l1, maxAbs: mx };
}

export interface PredictiveBand {
  t: number;
  /** Plug-in (MLE) latent mean. */
  mean: number;
  /** 95 % band of the LATENT trajectory from parameter uncertainty only (bootstrap). */
  latentLo: number;
  latentHi: number;
  /** 95 % interval for a NEW SESSION MEAN of nReps repetitions: parameter uncertainty + σ_s + σ_ε²/n. */
  obsLo: number;
  obsHi: number;
  /** Same, conditional on the MLE only (ignores parameter uncertainty) — shown for comparison. */
  plugLo: number;
  plugHi: number;
}

/** Forecast at future times with uncertainty. dose[i] = dose in the interval ending at times[i]. */
export function predictiveBands(fit: ModelFit, d: Prepared, boot: BootstrapResult | null, future: readonly { t: number; dose: number }[], nReps: number, seed: number): PredictiveBand[] {
  const spec = MODELS[fit.model];
  const rng = createRng(seed ^ 0x9e3779b9);
  const plug = spec.forecast(fit.params, d, future);
  const sS = fit.params[fit.params.length - 1] as number;
  // Small-sample correction: the ML session variance is biased low by ≈ (K − p)/K (p = mean-structure parameters),
  // exactly as RSS/K is for regression. Both plug-in and bootstrap noise use σs²·K/(K − p); the plug-in interval
  // uses a Student-t quantile with K − p degrees of freedom. Validated in experiments.ts (E7).
  const K = d.y.length;
  const pMean = fit.params.length - 1;
  const dfRes = Math.max(1, K - pMean);
  const inflate = K / dfRes;
  const obsVarPlug = (fc: { varLatent: number }) => fc.varLatent + inflate * sS * sS + d.sigmaE2 / Math.max(1, nReps);
  const z = tQuantile(0.975, dfRes);
  const draws: number[][] = future.map(() => []);
  const lat: number[][] = future.map(() => []);
  if (boot && boot.ok > 0) {
    boot.params.forEach((p, b) => {
      const fc = spec.forecast(p, d, future);
      const sSb = p[p.length - 1] as number;
      fc.forEach((x, i) => {
        lat[i]!.push(x.mean + (x.varLatent > 0 ? rng.normal(0, Math.sqrt(x.varLatent)) : 0));
        const v = x.varLatent + inflate * sSb * sSb + (boot.sigmaE2[b] as number) / Math.max(1, nReps);
        draws[i]!.push(x.mean + rng.normal(0, Math.sqrt(v)));
      });
    });
  }
  return plug.map((fc, i) => {
    const s = Math.sqrt(obsVarPlug(fc));
    const dl = [...(draws[i] as number[])].sort((a, b) => a - b);
    const ll = [...(lat[i] as number[])].sort((a, b) => a - b);
    const has = dl.length >= 20;
    return {
      t: fc.t,
      mean: fc.mean,
      latentLo: has ? quantile(ll, 0.025) : fc.mean - 1.959963984540054 * Math.sqrt(fc.varLatent),
      latentHi: has ? quantile(ll, 0.975) : fc.mean + 1.959963984540054 * Math.sqrt(fc.varLatent),
      obsLo: has ? quantile(dl, 0.025) : fc.mean - z * s,
      obsHi: has ? quantile(dl, 0.975) : fc.mean + z * s,
      plugLo: fc.mean - z * s,
      plugHi: fc.mean + z * s,
    };
  });
}

/** Latent trajectory band on a grid, from bootstrap parameter draws (deterministic-mean models; local level uses smoothing variance). */
export function trajectoryBand(fit: ModelFit, d: Prepared, boot: BootstrapResult | null, grid: readonly number[]): { t: number; mean: number; lo: number; hi: number }[] {
  const spec = MODELS[fit.model];
  const mean = spec.trajectory(fit.params, d, grid);
  if (fit.model === 'local_level') {
    const lat = fit.latent;
    return grid.map((t, i) => {
      let idx = 0;
      for (let k = 0; k < d.t.length; k++) if ((d.t[k] as number) <= t + 1e-9) idx = k;
      const s = Math.sqrt(lat.var[idx] as number);
      return { t, mean: mean[i] as number, lo: (mean[i] as number) - 1.96 * s, hi: (mean[i] as number) + 1.96 * s };
    });
  }
  if (!boot || boot.ok < 20) return grid.map((t, i) => ({ t, mean: mean[i] as number, lo: mean[i] as number, hi: mean[i] as number }));
  const per: number[][] = grid.map(() => []);
  for (const p of boot.params) spec.trajectory(p, d, grid).forEach((v, i) => per[i]!.push(v));
  return grid.map((t, i) => {
    const s = [...(per[i] as number[])].sort((a, b) => a - b);
    return { t, mean: mean[i] as number, lo: quantile(s, 0.025), hi: quantile(s, 0.975) };
  });
}

// ── model checks ───────────────────────────────────────────────────────────────────────────────

export interface Diagnostics {
  lag1: number;
  maxAbs: number;
  outside2: number;
  /** Parametric-bootstrap p-values: fraction of replicates with a statistic at least as extreme as observed. */
  pLag1: number | null;
  pMaxAbs: number | null;
  /** Shapiro-type normality tests are not run: with < 20 sessions they have almost no power. */
  notes: string[];
}

export function diagnostics(fit: ModelFit, boot: BootstrapResult | null): Diagnostics {
  const r = fit.residuals;
  const l = lag1(r);
  const m = r.length ? Math.max(...r.map(Math.abs)) : NaN;
  const notes: string[] = [];
  if (r.length < 8) notes.push('few_sessions_low_power');
  const pv = (xs: number[] | undefined, obs: number, twoSided: boolean) => {
    if (!xs || xs.length < 20 || !Number.isFinite(obs)) return null;
    const ok = xs.filter((x) => Number.isFinite(x));
    if (!ok.length) return null;
    return ok.filter((x) => (twoSided ? Math.abs(x) >= Math.abs(obs) : x >= obs)).length / ok.length;
  };
  return {
    lag1: l,
    maxAbs: m,
    outside2: r.filter((x) => Math.abs(x) > 2).length,
    pLag1: pv(boot?.lag1, l, true),
    pMaxAbs: pv(boot?.maxAbs, m, false),
    notes,
  };
}

// ── comparison and selection ───────────────────────────────────────────────────────────────────

export interface ComparisonRow {
  model: ModelId;
  fit: ModelFit;
  deltaAicc: number;
  weight: number;
  lfo: LfoResult | null;
}

export interface Comparison {
  rows: ComparisonRow[];
  prepared: Prepared;
  /** Selected model, or null when nothing could be fitted. */
  selected: ModelId | null;
  selectionReason: string[];
  /** Sessions predicted in the common leave-future-out folds. */
  lfoTargets: number[];
  /** Mean absolute error of the naive "same as last session" forecast on the same folds (a baseline every model must beat). */
  persistenceMae: number | null;
}

export interface CompareOptions {
  doseMode: DoseMode;
  sessionsCount?: readonly (number | null)[];
  models?: readonly ModelId[];
}

export function compareModels(data: ModelData, o: CompareOptions): Comparison {
  const d = prepareWithSS(data, o.doseMode, o.sessionsCount);
  const ids = (o.models ?? MODEL_IDS).filter((id) => MODEL_IDS.includes(id));
  const fits = ids.map((id) => fitPrepared(id, d));
  const ok = fits.filter((f) => f.status === 'ok' && Number.isFinite(f.aicc));
  const best = ok.length ? Math.min(...ok.map((f) => f.aicc)) : Infinity;
  const rel = ok.map((f) => Math.exp(-0.5 * (f.aicc - best)));
  const tot = rel.reduce((a, b) => a + b, 0);
  // Common leave-future-out folds: start where every fitted model has enough training sessions, at least 3
  const firstTarget = Math.max(3, ...ok.map((f) => MODELS[f.model].minSessions));
  const lfoTargets: number[] = [];
  for (let k = firstTarget; k < d.y.length; k++) lfoTargets.push(k);
  const rows: ComparisonRow[] = fits.map((f) => {
    const i = ok.indexOf(f);
    return {
      model: f.model,
      fit: f,
      deltaAicc: i >= 0 ? f.aicc - best : Infinity,
      weight: i >= 0 && tot > 0 ? (rel[i] as number) / tot : 0,
      lfo: i >= 0 && lfoTargets.length ? leaveFutureOut(f.model, d, firstTarget) : null,
    };
  });
  const persistenceMae = lfoTargets.length ? lfoTargets.reduce((a, k) => a + Math.abs((d.y[k] as number) - (d.y[k - 1] as number)), 0) / lfoTargets.length : null;
  const { selected, reason } = selectModel(rows);
  return { rows, prepared: d, selected, selectionReason: reason, lfoTargets, persistenceMae };
}

/**
 * Selection rule (fixed before looking at any data; research/mathematical-models.md §6):
 *  1. Consider fitted models only.
 *  2. Keep those within ΔAICc ≤ 2 of the best (statistically indistinguishable support).
 *  3. Among them prefer models whose interpretable parameters are all practically identifiable.
 *  4. Then prefer the fewest parameters (parsimony), then the lowest AICc.
 * The stationary model is always a candidate, so "no detectable change" can win.
 */
export function selectModel(rows: readonly ComparisonRow[]): { selected: ModelId | null; reason: string[] } {
  const ok = rows.filter((r) => r.fit.status === 'ok' && Number.isFinite(r.deltaAicc));
  if (!ok.length) {
    // AICc is undefined when sessions ≤ parameters + 1; fall back to the simplest fitted model, said so
    const fitted = rows.filter((r) => r.fit.status === 'ok').sort((a, b) => a.fit.k - b.fit.k);
    if (fitted.length) return { selected: (fitted[0] as ComparisonRow).model, reason: ['aicc_not_computable', 'simplest_fitted'] };
    return { selected: null, reason: ['no_model_fitted'] };
  }
  const near = ok.filter((r) => r.deltaAicc <= 2);
  const reason: string[] = [`${near.length}_within_2_aicc`];
  const ident = near.filter((r) => r.fit.identifiable || r.model === 'stationary');
  const pool = ident.length ? ident : near;
  if (!ident.length) reason.push('none_identifiable');
  pool.sort((a, b) => a.fit.k - b.fit.k || a.deltaAicc - b.deltaAicc);
  const chosen = pool[0] as ComparisonRow;
  if (chosen.deltaAicc > 0) reason.push('parsimony');
  else reason.push('lowest_aicc');
  return { selected: chosen.model, reason };
}

/** Two-sided p-value of a z statistic (used for descriptive change tests). */
export const pTwoSided = (z: number): number => 2 * (1 - normCdf(Math.abs(z)));
export const z95 = normQuantile(0.975);
