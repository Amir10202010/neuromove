// Candidate models of an individual's longitudinal performance on ONE task metric
// (research/mathematical-models.md is the full specification; keep the two in step).
//
// Shared measurement model — every candidate uses it:
//   session k, repetition r:  y_kr = z_k + η_k + ε_kr
//     z_k  latent task performance at session k           (what the models describe)
//     η_k  ~ N(0, σ_s²)  session-level deviation           (day-to-day: donning, calibration, state of the child)
//     ε_kr ~ N(0, σ_ε²)  repetition-level variability      (biological + measurement noise within a session)
//   σ_ε² is estimated ONCE per series from the pooled within-session spread (Σ SS_k / Σ (n_k − 1)) and treated
//   as known by all candidates (two-stage estimation; its uncertainty is propagated in the bootstrap).
//   The session mean then observes z_k with variance R_k = σ_s² + σ_ε² / n_k.
//
// Candidates for z_k (t_k = days since the first included session, Δ_k = t_k − t_{k−1}, D_k = dose in Δ_k):
//   stationary          z_k = μ
//   linear              z_k = μ₀ + β·t_k/7
//   exponential         z_k = A + (z₀ − A)·exp(−t_k/τ)                          (Heathcote et al. 2000)
//   local_level         z_k = z_{k−1} + w_k,  w_k ~ N(0, q·Δ_k)                  (random-walk state, Kalman filter)
//   learning_retention  dz/dt = −λ(z − z₁) + γ·u(t),  λ = ln2 / h                (single-rate learning with forgetting,
//                       after Casadio & Sanguineti 2012; u = practice dose rate, spread uniformly within Δ_k):
//                       z_k = z₁ + e^{−λΔ}(z_{k−1} − z₁) + γ·D_k·(1 − e^{−λΔ})/(λΔ)
//
// None of these is a model of the nervous system. They describe how one IMU-derived task metric of one person
// changes across sessions, with explicit noise, so that change can be separated from measurement variability.

import type { ModelData } from './dataset';
import { LOG_2PI } from './numeric';
import type { Rng } from '../lib/random';

export const MODEL_IDS = ['stationary', 'linear', 'exponential', 'local_level', 'learning_retention'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

/** How the dose D_k of the learning–retention model is obtained. Every option except the first two is an ASSUMPTION. */
export const DOSE_MODES = ['practice_minutes', 'practice_sessions', 'per_visit', 'time_on_program'] as const;
export type DoseMode = (typeof DOSE_MODES)[number];

export type Transform = { kind: 'none' } | { kind: 'log' } | { kind: 'bounded_log'; lo: number; hi: number };

export interface ParamDef {
  name: string;
  /** Unit in the metric's unit system: 'metric' = same unit as the series, 'metric/week', 'days', 'metric/dose'. */
  unit: 'metric' | 'metric/week' | 'days' | 'metric/dose' | 'metric/√week';
  transform: Transform;
  /** Parameters a researcher would interpret (profile likelihood is computed for these). */
  interpretable: boolean;
}

/** Data prepared for fitting: included sessions + the shared σ_ε² estimate + resolved dose. */
export interface Prepared {
  t: number[];
  y: number[];
  n: number[];
  /** Dose per interval (index k = dose between session k−1 and k; index 0 = 0). */
  dose: number[];
  doseMode: DoseMode;
  /** Pooled within-session variance σ_ε² and its degrees of freedom (0 when every session has one repetition). */
  sigmaE2: number;
  dfE: number;
  /** Scale of the data (robust SD of means, ≥ tiny) — used for starting values and bounds. */
  scale: number;
  sessionIds: string[];
}

export interface Forecast {
  t: number;
  /** Latent performance z(t) given the parameters. */
  mean: number;
  /** Variance of z(t) given the parameters (non-zero only for the stochastic local-level model). */
  varLatent: number;
}

export interface ModelSpec {
  id: ModelId;
  params: ParamDef[];
  /** Minimum included sessions for a fit to be attempted (mean-structure parameters + 2). */
  minSessions: number;
  usesDose: boolean;
  /** Starting points in NATURAL parameters. */
  starts(d: Prepared): number[][];
  logLik(p: readonly number[], d: Prepared): number;
  /** Latent z at the observed sessions given the parameters (Kalman-smoothed for local_level). */
  latent(p: readonly number[], d: Prepared): { mean: number[]; var: number[] };
  /** Standardised one-step residuals (innovations for local_level). */
  residuals(p: readonly number[], d: Prepared): number[];
  /** z(t) at future times; `dose` is the dose in the interval ending at each future time. */
  forecast(p: readonly number[], d: Prepared, future: readonly { t: number; dose: number }[]): Forecast[];
  /** Latent trajectory on an arbitrary time grid inside/after the data (for plots). */
  trajectory(p: readonly number[], d: Prepared, grid: readonly number[]): number[];
  /** Simulate session means at the prepared design (times, n, dose) from parameters — for the parametric bootstrap. */
  simulate(p: readonly number[], d: Prepared, rng: Rng): number[];
}

// ── transforms ──────────────────────────────────────────────────────────────────────────────────

const sigmoid = (u: number) => 1 / (1 + Math.exp(-u));
export function toNatural(tr: Transform, u: number): number {
  switch (tr.kind) {
    case 'none':
      return u;
    case 'log':
      return Math.exp(u);
    case 'bounded_log': {
      const a = Math.log(tr.lo);
      const b = Math.log(tr.hi);
      return Math.exp(a + (b - a) * sigmoid(u));
    }
  }
}
export function toFree(tr: Transform, x: number): number {
  switch (tr.kind) {
    case 'none':
      return x;
    case 'log':
      return Math.log(Math.max(x, 1e-300));
    case 'bounded_log': {
      const a = Math.log(tr.lo);
      const b = Math.log(tr.hi);
      const s = Math.min(1 - 1e-12, Math.max(1e-12, (Math.log(x) - a) / (b - a)));
      return Math.log(s / (1 - s));
    }
  }
}

// ── preparation ─────────────────────────────────────────────────────────────────────────────────

function robustScale(y: readonly number[]): number {
  if (y.length < 2) return Math.max(1e-6, Math.abs(y[0] ?? 1) * 0.1);
  const s = [...y].sort((a, b) => a - b);
  const range = (s[s.length - 1] as number) - (s[0] as number);
  return Math.max(1e-6, range / 2, Math.abs(s[Math.floor(s.length / 2)] as number) * 0.01);
}

export function resolveDose(data: ModelData, mode: DoseMode, sessionsCount?: readonly (number | null)[]): number[] {
  return data.t.map((t, k) => {
    if (k === 0) return 0;
    const dt = t - (data.t[k - 1] as number);
    switch (mode) {
      case 'practice_minutes':
        return data.dose[k] ?? 0;
      case 'practice_sessions':
        return sessionsCount?.[k] ?? 0;
      case 'per_visit':
        return 1;
      case 'time_on_program':
        return dt;
    }
  });
}

export function prepare(data: ModelData, doseMode: DoseMode, sessionsCount?: readonly (number | null)[]): Prepared {
  let ss = 0;
  let df = 0;
  for (let k = 0; k < data.y.length; k++) {
    ss += data.ss[k] as number;
    df += Math.max(0, (data.n[k] as number) - 1);
  }
  return {
    t: [...data.t],
    y: [...data.y],
    n: [...data.n],
    dose: resolveDose(data, doseMode, sessionsCount),
    doseMode,
    sigmaE2: df > 0 ? ss / df : 0,
    dfE: df,
    scale: robustScale(data.y),
    sessionIds: [...data.sessionIds],
  };
}

/** Session-mean observation variance R_k = σ_s² + σ_ε²/n_k. */
const obsVar = (sigmaS: number, d: Prepared, k: number) => sigmaS * sigmaS + d.sigmaE2 / Math.max(1, d.n[k] as number);

function gaussLogLik(mean: readonly number[], sigmaS: number, d: Prepared): number {
  let l = 0;
  for (let k = 0; k < d.y.length; k++) {
    const r = obsVar(sigmaS, d, k);
    if (!(r > 0)) return -Infinity;
    const e = (d.y[k] as number) - (mean[k] as number);
    l += -0.5 * (LOG_2PI + Math.log(r) + (e * e) / r);
  }
  return l;
}

function stdResiduals(mean: readonly number[], sigmaS: number, d: Prepared): number[] {
  return d.y.map((y, k) => (y - (mean[k] as number)) / Math.sqrt(obsVar(sigmaS, d, k)));
}

function simulateFromMean(mean: readonly number[], sigmaS: number, d: Prepared, rng: Rng): number[] {
  return mean.map((m, k) => m + rng.normal(0, Math.sqrt(obsVar(sigmaS, d, k))));
}

const SIGMA_S: ParamDef = { name: 'sigma_session', unit: 'metric', transform: { kind: 'log' }, interpretable: false };
const sigmaStart = (d: Prepared) => Math.max(d.scale * 0.2, 1e-3);
const last = (xs: readonly number[]) => xs[xs.length - 1] as number;
const first = (xs: readonly number[]) => xs[0] as number;

// ── stationary ──────────────────────────────────────────────────────────────────────────────────

const stationary: ModelSpec = {
  id: 'stationary',
  params: [{ name: 'mu', unit: 'metric', transform: { kind: 'none' }, interpretable: true }, SIGMA_S],
  minSessions: 3,
  usesDose: false,
  starts: (d) => {
    const m = d.y.reduce((a, b) => a + b, 0) / d.y.length;
    return [[m, sigmaStart(d)], [m, d.scale]];
  },
  logLik: (p, d) => gaussLogLik(d.y.map(() => p[0] as number), p[1] as number, d),
  latent: (p, d) => ({ mean: d.y.map(() => p[0] as number), var: d.y.map(() => 0) }),
  residuals: (p, d) => stdResiduals(d.y.map(() => p[0] as number), p[1] as number, d),
  forecast: (p, _d, f) => f.map((x) => ({ t: x.t, mean: p[0] as number, varLatent: 0 })),
  trajectory: (p, _d, g) => g.map(() => p[0] as number),
  simulate: (p, d, rng) => simulateFromMean(d.y.map(() => p[0] as number), p[1] as number, d, rng),
};

// ── linear ──────────────────────────────────────────────────────────────────────────────────────

const linMean = (p: readonly number[], t: number) => (p[0] as number) + (p[1] as number) * (t / 7);
const linear: ModelSpec = {
  id: 'linear',
  params: [
    { name: 'intercept', unit: 'metric', transform: { kind: 'none' }, interpretable: false },
    { name: 'slope_per_week', unit: 'metric/week', transform: { kind: 'none' }, interpretable: true },
    SIGMA_S,
  ],
  minSessions: 4,
  usesDose: false,
  starts: (d) => {
    const T = Math.max(1, last(d.t));
    const b = ((last(d.y) - first(d.y)) / T) * 7;
    return [[first(d.y), b, sigmaStart(d)], [d.y.reduce((a, v) => a + v, 0) / d.y.length, 0, d.scale]];
  },
  logLik: (p, d) => gaussLogLik(d.t.map((t) => linMean(p, t)), p[2] as number, d),
  latent: (p, d) => ({ mean: d.t.map((t) => linMean(p, t)), var: d.t.map(() => 0) }),
  residuals: (p, d) => stdResiduals(d.t.map((t) => linMean(p, t)), p[2] as number, d),
  forecast: (p, _d, f) => f.map((x) => ({ t: x.t, mean: linMean(p, x.t), varLatent: 0 })),
  trajectory: (p, _d, g) => g.map((t) => linMean(p, t)),
  simulate: (p, d, rng) => simulateFromMean(d.t.map((t) => linMean(p, t)), p[2] as number, d, rng),
};

// ── exponential learning curve ──────────────────────────────────────────────────────────────────

export const TAU_BOUNDS = { lo: 0.5, hi: 3650 } as const;
const expMean = (p: readonly number[], t: number) => (p[0] as number) + ((p[1] as number) - (p[0] as number)) * Math.exp(-t / (p[2] as number));
const exponential: ModelSpec = {
  id: 'exponential',
  params: [
    { name: 'asymptote', unit: 'metric', transform: { kind: 'none' }, interpretable: true },
    { name: 'initial', unit: 'metric', transform: { kind: 'none' }, interpretable: false },
    { name: 'time_constant_days', unit: 'days', transform: { kind: 'bounded_log', ...TAU_BOUNDS }, interpretable: true },
    SIGMA_S,
  ],
  minSessions: 5,
  usesDose: false,
  starts: (d) => {
    const T = Math.max(1, last(d.t));
    const out: number[][] = [];
    for (const f of [0.25, 0.6, 1.5]) {
      for (const ext of [0.1, 0.5]) {
        const a = last(d.y) + ext * (last(d.y) - first(d.y));
        out.push([a, first(d.y), Math.min(TAU_BOUNDS.hi * 0.9, Math.max(1, f * T)), sigmaStart(d)]);
      }
    }
    return out;
  },
  logLik: (p, d) => gaussLogLik(d.t.map((t) => expMean(p, t)), p[3] as number, d),
  latent: (p, d) => ({ mean: d.t.map((t) => expMean(p, t)), var: d.t.map(() => 0) }),
  residuals: (p, d) => stdResiduals(d.t.map((t) => expMean(p, t)), p[3] as number, d),
  forecast: (p, _d, f) => f.map((x) => ({ t: x.t, mean: expMean(p, x.t), varLatent: 0 })),
  trajectory: (p, _d, g) => g.map((t) => expMean(p, t)),
  simulate: (p, d, rng) => simulateFromMean(d.t.map((t) => expMean(p, t)), p[3] as number, d, rng),
};

// ── local level (random-walk state, Kalman filter) ──────────────────────────────────────────────

interface KalmanOut {
  ll: number;
  /** Filtered mean/var after each observation. */
  a: number[];
  P: number[];
  /** Predicted mean/var before each observation. */
  aPred: number[];
  PPred: number[];
  innov: number[];
  F: number[];
}

function kalmanLL(p: readonly number[], d: Prepared): KalmanOut {
  const x1 = p[0] as number;
  const q = p[1] as number;
  const sS = p[2] as number;
  let a = x1;
  let P = 0;
  let ll = 0;
  const out: KalmanOut = { ll: 0, a: [], P: [], aPred: [], PPred: [], innov: [], F: [] };
  for (let k = 0; k < d.y.length; k++) {
    if (k > 0) P += q * Math.max(0, (d.t[k] as number) - (d.t[k - 1] as number));
    out.aPred.push(a);
    out.PPred.push(P);
    const R = obsVar(sS, d, k);
    const F = P + R;
    const v = (d.y[k] as number) - a;
    ll += -0.5 * (LOG_2PI + Math.log(F) + (v * v) / F);
    const K = P / F;
    a += K * v;
    P = P * (1 - K);
    out.innov.push(v);
    out.F.push(F);
    out.a.push(a);
    out.P.push(P);
  }
  out.ll = ll;
  return out;
}

const localLevel: ModelSpec = {
  id: 'local_level',
  params: [
    { name: 'initial', unit: 'metric', transform: { kind: 'none' }, interpretable: false },
    // q is a variance per day; reported as the SD of the weekly drift √(7q) — see reportValue()
    { name: 'drift_variance_per_day', unit: 'metric/√week', transform: { kind: 'log' }, interpretable: true },
    SIGMA_S,
  ],
  minSessions: 4,
  usesDose: false,
  starts: (d) => {
    const T = Math.max(1, last(d.t));
    const s2 = d.scale * d.scale;
    return [[first(d.y), s2 / T, sigmaStart(d)], [first(d.y), (0.05 * s2) / T, d.scale], [first(d.y), (2 * s2) / T, sigmaStart(d) * 0.3]];
  },
  logLik: (p, d) => kalmanLL(p, d).ll,
  latent: (p, d) => {
    // Rauch–Tung–Striebel smoother for a random walk
    const k = kalmanLL(p, d);
    const n = d.y.length;
    const m = new Array<number>(n);
    const V = new Array<number>(n);
    m[n - 1] = k.a[n - 1] as number;
    V[n - 1] = k.P[n - 1] as number;
    for (let i = n - 2; i >= 0; i--) {
      const Pp = k.PPred[i + 1] as number;
      const J = Pp > 0 ? (k.P[i] as number) / Pp : 0;
      m[i] = (k.a[i] as number) + J * ((m[i + 1] as number) - (k.aPred[i + 1] as number));
      V[i] = (k.P[i] as number) + J * J * ((V[i + 1] as number) - Pp);
    }
    return { mean: m, var: V.map((v) => Math.max(0, v)) };
  },
  residuals: (p, d) => {
    const k = kalmanLL(p, d);
    return k.innov.map((v, i) => v / Math.sqrt(k.F[i] as number));
  },
  forecast: (p, d, f) => {
    const k = kalmanLL(p, d);
    const aN = last(k.a);
    const PN = last(k.P);
    const tN = last(d.t);
    return f.map((x) => ({ t: x.t, mean: aN, varLatent: PN + (p[1] as number) * Math.max(0, x.t - tN) }));
  },
  trajectory: (p, d, g) => {
    // Inside the data: smoothed state at the nearest previous session (piecewise constant); after: last filtered state
    const sm = localLevel.latent(p, d).mean;
    return g.map((t) => {
      let idx = 0;
      for (let i = 0; i < d.t.length; i++) if ((d.t[i] as number) <= t + 1e-9) idx = i;
      return sm[idx] as number;
    });
  },
  simulate: (p, d, rng) => {
    let x = p[0] as number;
    return d.y.map((_, k) => {
      if (k > 0) x += rng.normal(0, Math.sqrt((p[1] as number) * Math.max(0, (d.t[k] as number) - (d.t[k - 1] as number))));
      return x + rng.normal(0, Math.sqrt(obsVar(p[2] as number, d, k)));
    });
  },
};

// ── learning–retention (dose-driven, single rate) ───────────────────────────────────────────────

export const HALF_LIFE_BOUNDS = { lo: 1, hi: 3650 } as const;

/** One interval of the learning–retention ODE with uniformly spread dose D over Δ days. */
export function lrStep(z: number, z1: number, halfLife: number, gain: number, dose: number, dt: number): number {
  const lam = Math.LN2 / halfLife;
  const decay = Math.exp(-lam * dt);
  const spread = lam * dt > 1e-9 ? (1 - decay) / (lam * dt) : 1;
  return z1 + decay * (z - z1) + gain * dose * spread;
}

function lrMeans(p: readonly number[], t: readonly number[], dose: readonly number[]): number[] {
  const z1 = p[0] as number;
  const out: number[] = [];
  let z = z1;
  for (let k = 0; k < t.length; k++) {
    if (k > 0) z = lrStep(z, z1, p[1] as number, p[2] as number, dose[k] as number, (t[k] as number) - (t[k - 1] as number));
    out.push(z);
  }
  return out;
}

/** Dose a future interval of length dt would carry under the prepared dose mode (used by trajectory()). */
export function doseForInterval(mode: DoseMode, dt: number, perInterval: number): number {
  if (mode === 'time_on_program') return dt;
  return perInterval;
}

const learningRetention: ModelSpec = {
  id: 'learning_retention',
  params: [
    { name: 'baseline', unit: 'metric', transform: { kind: 'none' }, interpretable: false },
    { name: 'retention_half_life_days', unit: 'days', transform: { kind: 'bounded_log', ...HALF_LIFE_BOUNDS }, interpretable: true },
    { name: 'gain_per_dose', unit: 'metric/dose', transform: { kind: 'none' }, interpretable: true },
    SIGMA_S,
  ],
  minSessions: 5,
  usesDose: true,
  starts: (d) => {
    const out: number[][] = [];
    const meanDose = d.dose.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, d.dose.length - 1) || 1;
    const perInterval = (last(d.y) - first(d.y)) / Math.max(1, d.y.length - 1) / meanDose;
    for (const h of [7, 30, 180]) for (const g of [perInterval, 2 * perInterval]) out.push([first(d.y), h, g, sigmaStart(d)]);
    return out;
  },
  logLik: (p, d) => gaussLogLik(lrMeans(p, d.t, d.dose), p[3] as number, d),
  latent: (p, d) => ({ mean: lrMeans(p, d.t, d.dose), var: d.t.map(() => 0) }),
  residuals: (p, d) => stdResiduals(lrMeans(p, d.t, d.dose), p[3] as number, d),
  forecast: (p, d, f) => {
    let z = last(lrMeans(p, d.t, d.dose));
    let tPrev = last(d.t);
    return f.map((x) => {
      z = lrStep(z, p[0] as number, p[1] as number, p[2] as number, x.dose, x.t - tPrev);
      tPrev = x.t;
      return { t: x.t, mean: z, varLatent: 0 };
    });
  },
  trajectory: (p, d, g) => {
    // Between sessions the dose of the interval is spread uniformly, so z(t) inside an interval follows the ODE
    // with the interval's dose RATE. After the last session: no further dose (pure retention) — the trajectory
    // a researcher would compare a retention test against.
    const means = lrMeans(p, d.t, d.dose);
    return g.map((t) => {
      let i = 0;
      while (i < d.t.length - 1 && (d.t[i + 1] as number) <= t) i++;
      const t0 = d.t[i] as number;
      if (i === d.t.length - 1) return lrStep(means[i] as number, p[0] as number, p[1] as number, p[2] as number, 0, Math.max(0, t - t0));
      const span = (d.t[i + 1] as number) - t0;
      const doseSoFar = span > 0 ? ((d.dose[i + 1] as number) * (t - t0)) / span : 0;
      return lrStep(means[i] as number, p[0] as number, p[1] as number, p[2] as number, doseSoFar, t - t0);
    });
  },
  simulate: (p, d, rng) => simulateFromMean(lrMeans(p, d.t, d.dose), p[3] as number, d, rng),
};

export const MODELS: Record<ModelId, ModelSpec> = {
  stationary,
  linear,
  exponential,
  local_level: localLevel,
  learning_retention: learningRetention,
};

/** Number of free parameters counted by information criteria (σ_ε is shared by all candidates and not counted). */
export const paramCount = (id: ModelId): number => MODELS[id].params.length;

/** Value shown to researchers: q is reported as the SD of the weekly drift, √(7q). */
export function reportValue(id: ModelId, paramIndex: number, value: number): number {
  if (id === 'local_level' && paramIndex === 1) return Math.sqrt(7 * Math.max(0, value));
  return value;
}
