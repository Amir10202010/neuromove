// Population reference model — what is known about participants IN GENERAL, kept strictly apart from what is known
// about ONE participant, and used only to say how far a new participant's later sessions are expected to lie given
// their own first sessions.
//
// Model: linear mixed-effects with a random intercept and slope per participant (Laird & Ware 1982):
//     y_ij = (β₀ + b₀ᵢ) + (β₁ + b₁ᵢ)·t_ij + e_ij,   bᵢ ~ N(0, D),  e_ij ~ N(0, σ²),  t in weeks since first session
// Estimation: maximum likelihood by the EM algorithm (closed-form E and M steps; unbalanced, irregular schedules).
// Prediction for a participant with m own observations (possibly 0): the conditional (BLUP) distribution
//     b̂ = D Zᵀ (Z D Zᵀ + σ²I)⁻¹ (y − Xβ),   Var(b | y) = D − D Zᵀ (Z D Zᵀ + σ²I)⁻¹ Z D
//     y* ~ N(x*ᵀ(β + b̂),  x*ᵀ Var(b|y) x* + σ² + x*ᵀ Var(β̂) x*)
// With m = 0 this is the population reference; with growing m it converges to the individual's own line. The two are
// reported as different things: "population-level reference" vs "individual estimate".
//
// Rules:
//   • never fitted on a mix of simulated and real participants (refused: 'mixed_provenance');
//   • refused below 8 participants with ≥ 3 sessions (a 2 × 2 random-effects covariance has three parameters;
//     a convention, stated here, not a guarantee);
//   • every performance figure is from PARTICIPANT-WISE validation: the held-out participant contributes nothing to
//     the model that predicts them (leave-one-participant-out), and their later sessions are predicted from their
//     earlier ones (temporal order respected). Record-wise splits are not offered.
// It is a statistical description of the sample it was fitted on — not a norm, not a reference interval for children.

import { wilson } from '../benchmark';
import { tQuantile } from '../../research/stats';

export interface PopulationParticipant {
  participantId: string;
  simulated: boolean;
  /** Weeks since the participant's first session, and the session means, in time order. */
  t: number[];
  y: number[];
}

export interface PopulationModel {
  status: 'fitted' | 'insufficient_participants' | 'mixed_provenance' | 'did_not_converge';
  reasons: string[];
  participants: number;
  observations: number;
  simulated: boolean;
  /** Fixed effects: mean level at t = 0 and mean change per week. */
  beta: [number, number];
  /** Covariance of the fixed-effect estimates. */
  betaCov: [[number, number], [number, number]];
  /** Random-effects covariance (intercept, slope). */
  D: [[number, number], [number, number]];
  /** Residual (session-level) SD. */
  sigma: number;
  logLik: number;
  iterations: number;
}

export const POPULATION_RULE = { minParticipants: 8, minSessions: 3, maxIter: 2000, tol: 1e-9 } as const;

type M2 = [[number, number], [number, number]];
const inv2 = (m: M2): M2 | null => {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (!(Math.abs(det) > 1e-300)) return null;
  return [[m[1][1] / det, -m[0][1] / det], [-m[1][0] / det, m[0][0] / det]];
};
const add2 = (a: M2, b: M2): M2 => [[a[0][0] + b[0][0], a[0][1] + b[0][1]], [a[1][0] + b[1][0], a[1][1] + b[1][1]]];
const mv2 = (m: M2, v: [number, number]): [number, number] => [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1]];

/** Sufficient statistics of one participant for X = Z = [1, t]. */
function stats(p: PopulationParticipant, beta: [number, number]): { ZtZ: M2; Ztr: [number, number]; n: number } {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let r0 = 0;
  let r1 = 0;
  for (let j = 0; j < p.t.length; j++) {
    const t = p.t[j] as number;
    const r = (p.y[j] as number) - beta[0] - beta[1] * t;
    s0 += 1;
    s1 += t;
    s2 += t * t;
    r0 += r;
    r1 += r * t;
  }
  return { ZtZ: [[s0, s1], [s1, s2]], Ztr: [r0, r1], n: p.t.length };
}

/** Marginal log-likelihood of one participant: y ~ N(Xβ, Z D Zᵀ + σ²I), via the 2 × 2 Woodbury form. */
function logLikOne(p: PopulationParticipant, beta: [number, number], D: M2, s2: number): number {
  const { ZtZ, Ztr, n } = stats(p, beta);
  const Dinv = inv2(D);
  let rr = 0;
  for (let j = 0; j < p.t.length; j++) rr += ((p.y[j] as number) - beta[0] - beta[1] * (p.t[j] as number)) ** 2;
  if (!Dinv) return -0.5 * (n * Math.log(2 * Math.PI * s2) + rr / s2);
  const A = add2(Dinv, [[ZtZ[0][0] / s2, ZtZ[0][1] / s2], [ZtZ[1][0] / s2, ZtZ[1][1] / s2]]);
  const Ainv = inv2(A);
  if (!Ainv) return -Infinity;
  const detD = D[0][0] * D[1][1] - D[0][1] * D[1][0];
  const detA = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  // |V| = σ²ⁿ |D| |A|;  rᵀV⁻¹r = rᵀr/σ² − (Zᵀr/σ²)ᵀ A⁻¹ (Zᵀr/σ²)
  const u: [number, number] = [Ztr[0] / s2, Ztr[1] / s2];
  const w = mv2(Ainv, u);
  const quad = rr / s2 - (u[0] * w[0] + u[1] * w[1]);
  return -0.5 * (n * Math.log(2 * Math.PI) + n * Math.log(s2) + Math.log(detD) + Math.log(detA) + quad);
}

export function fitPopulation(participants: readonly PopulationParticipant[]): PopulationModel {
  const use = participants.filter((p) => p.t.length >= POPULATION_RULE.minSessions && p.t.length === p.y.length);
  const reasons: string[] = [];
  const empty = (status: PopulationModel['status']): PopulationModel => ({ status, reasons, participants: use.length, observations: use.reduce((a, p) => a + p.t.length, 0), simulated: use.some((p) => p.simulated), beta: [NaN, NaN], betaCov: [[NaN, NaN], [NaN, NaN]], D: [[NaN, NaN], [NaN, NaN]], sigma: NaN, logLik: NaN, iterations: 0 });
  if (participants.some((p) => p.simulated) && participants.some((p) => !p.simulated)) {
    reasons.push('simulated_and_real_participants_are_never_pooled');
    return empty('mixed_provenance');
  }
  if (use.length < POPULATION_RULE.minParticipants) {
    reasons.push(`${use.length}_participants_with_≥_${POPULATION_RULE.minSessions}_sessions_(minimum_${POPULATION_RULE.minParticipants})`);
    return empty('insufficient_participants');
  }
  const N = use.reduce((a, p) => a + p.t.length, 0);
  // starting values: pooled OLS, between-participant spread of per-participant OLS lines
  const lines = use.map((p) => {
    const n = p.t.length;
    const mt = p.t.reduce((a, b) => a + b, 0) / n;
    const my = p.y.reduce((a, b) => a + b, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (let j = 0; j < n; j++) {
      sxx += ((p.t[j] as number) - mt) ** 2;
      sxy += ((p.t[j] as number) - mt) * ((p.y[j] as number) - my);
    }
    const b = sxx > 0 ? sxy / sxx : 0;
    return [my - b * mt, b] as [number, number];
  });
  let beta: [number, number] = [lines.reduce((a, l) => a + l[0], 0) / use.length, lines.reduce((a, l) => a + l[1], 0) / use.length];
  const v = (k: 0 | 1) => lines.reduce((a, l) => a + (l[k] - beta[k]) ** 2, 0) / Math.max(1, use.length - 1);
  let D: M2 = [[Math.max(v(0), 1e-6), 0], [0, Math.max(v(1), 1e-8)]];
  let s2 = Math.max(1e-8, use.reduce((a, p, i) => a + p.t.reduce((q, t, j) => q + ((p.y[j] as number) - (lines[i] as [number, number])[0] - (lines[i] as [number, number])[1] * t) ** 2, 0), 0) / Math.max(1, N - 2 * use.length));
  let ll = -Infinity;
  let it = 0;
  let converged = false;
  for (; it < POPULATION_RULE.maxIter; it++) {
    const Dinv = inv2(D);
    if (!Dinv) break;
    // E step
    const post = use.map((p) => {
      const { ZtZ, Ztr } = stats(p, beta);
      const V = inv2(add2(Dinv, [[ZtZ[0][0] / s2, ZtZ[0][1] / s2], [ZtZ[1][0] / s2, ZtZ[1][1] / s2]])) as M2;
      const b = mv2(V, [Ztr[0] / s2, Ztr[1] / s2]);
      return { b, V, ZtZ };
    });
    // M step: β from (y − Z b̂), σ², D
    let XtX: M2 = [[0, 0], [0, 0]];
    const Xty: [number, number] = [0, 0];
    use.forEach((p, i) => {
      const b = (post[i] as { b: [number, number] }).b;
      for (let j = 0; j < p.t.length; j++) {
        const t = p.t[j] as number;
        const yy = (p.y[j] as number) - b[0] - b[1] * t;
        Xty[0] += yy;
        Xty[1] += yy * t;
      }
      XtX = add2(XtX, (post[i] as { ZtZ: M2 }).ZtZ);
    });
    const XtXinv = inv2(XtX);
    if (!XtXinv) break;
    beta = mv2(XtXinv, Xty);
    let rss = 0;
    let Dn: M2 = [[0, 0], [0, 0]];
    use.forEach((p, i) => {
      const { b, V, ZtZ } = post[i] as { b: [number, number]; V: M2; ZtZ: M2 };
      for (let j = 0; j < p.t.length; j++) {
        const t = p.t[j] as number;
        rss += ((p.y[j] as number) - beta[0] - beta[1] * t - b[0] - b[1] * t) ** 2;
      }
      rss += ZtZ[0][0] * V[0][0] + 2 * ZtZ[0][1] * V[0][1] + ZtZ[1][1] * V[1][1];
      Dn = add2(Dn, [[b[0] * b[0] + V[0][0], b[0] * b[1] + V[0][1]], [b[0] * b[1] + V[1][0], b[1] * b[1] + V[1][1]]]);
    });
    s2 = Math.max(1e-12, rss / N);
    D = [[Dn[0][0] / use.length, Dn[0][1] / use.length], [Dn[1][0] / use.length, Dn[1][1] / use.length]];
    const nl = use.reduce((a, p) => a + logLikOne(p, beta, D, s2), 0);
    if (Math.abs(nl - ll) < POPULATION_RULE.tol * (1 + Math.abs(nl))) {
      ll = nl;
      converged = true;
      break;
    }
    ll = nl;
  }
  // Var(β̂) = (Σ Xᵢᵀ Vᵢ⁻¹ Xᵢ)⁻¹ with Vᵢ⁻¹ by Woodbury
  let info: M2 = [[0, 0], [0, 0]];
  const Dinv = inv2(D);
  for (const p of use) {
    const { ZtZ } = stats(p, beta);
    const S: M2 = [[ZtZ[0][0] / s2, ZtZ[0][1] / s2], [ZtZ[1][0] / s2, ZtZ[1][1] / s2]];
    if (!Dinv) {
      info = add2(info, S);
      continue;
    }
    const Ainv = inv2(add2(Dinv, S)) as M2;
    // XᵀV⁻¹X = S − S A⁻¹ S
    const SA: M2 = [[S[0][0] * Ainv[0][0] + S[0][1] * Ainv[1][0], S[0][0] * Ainv[0][1] + S[0][1] * Ainv[1][1]], [S[1][0] * Ainv[0][0] + S[1][1] * Ainv[1][0], S[1][0] * Ainv[0][1] + S[1][1] * Ainv[1][1]]];
    const SAS: M2 = [[SA[0][0] * S[0][0] + SA[0][1] * S[1][0], SA[0][0] * S[0][1] + SA[0][1] * S[1][1]], [SA[1][0] * S[0][0] + SA[1][1] * S[1][0], SA[1][0] * S[0][1] + SA[1][1] * S[1][1]]];
    info = add2(info, [[S[0][0] - SAS[0][0], S[0][1] - SAS[0][1]], [S[1][0] - SAS[1][0], S[1][1] - SAS[1][1]]]);
  }
  const betaCov = inv2(info) ?? [[NaN, NaN], [NaN, NaN]];
  if (!converged) reasons.push('EM_did_not_converge_within_the_iteration_limit');
  return { status: converged ? 'fitted' : 'did_not_converge', reasons, participants: use.length, observations: N, simulated: use.some((p) => p.simulated), beta, betaCov, D, sigma: Math.sqrt(s2), logLik: ll, iterations: it };
}

export interface PopulationPrediction {
  t: number;
  mean: number;
  sd: number;
  lo: number;
  hi: number;
  /** 'population_reference' when the participant contributed no observation, otherwise 'individual_given_population'. */
  kind: 'population_reference' | 'individual_given_population';
}

/** Predict session means at times `at` (weeks) for a participant with own observations (t, y) — possibly none. */
export function predictParticipant(m: PopulationModel, own: { t: readonly number[]; y: readonly number[] }, at: readonly number[]): PopulationPrediction[] {
  if (m.status !== 'fitted') return [];
  const s2 = m.sigma ** 2;
  let b: [number, number] = [0, 0];
  let Vb: M2 = m.D;
  const Dinv = inv2(m.D);
  if (own.t.length && Dinv) {
    const st = stats({ participantId: '', simulated: false, t: [...own.t], y: [...own.y] }, m.beta);
    const V = inv2(add2(Dinv, [[st.ZtZ[0][0] / s2, st.ZtZ[0][1] / s2], [st.ZtZ[1][0] / s2, st.ZtZ[1][1] / s2]]));
    if (V) {
      Vb = V;
      b = mv2(V, [st.Ztr[0] / s2, st.Ztr[1] / s2]);
    }
  }
  // t-quantile with the participants' degrees of freedom for the variance components (conservative for small samples)
  const q = tQuantile(0.975, Math.max(1, m.participants - 2));
  return at.map((t) => {
    const mean = m.beta[0] + b[0] + (m.beta[1] + b[1]) * t;
    const vb = Vb[0][0] + 2 * t * Vb[0][1] + t * t * Vb[1][1];
    const vf = m.betaCov[0][0] + 2 * t * m.betaCov[0][1] + t * t * m.betaCov[1][1];
    const sd = Math.sqrt(Math.max(0, vb) + s2 + (Number.isFinite(vf) ? Math.max(0, vf) : 0));
    return { t, mean, sd, lo: mean - q * sd, hi: mean + q * sd, kind: own.t.length ? 'individual_given_population' : 'population_reference' };
  });
}

export interface PopulationValidation {
  status: 'evaluated' | 'insufficient_participants' | 'mixed_provenance';
  participants: number;
  /** Held-out future observations predicted. */
  predictions: number;
  /** Own sessions the held-out participant contributed before the predicted ones. */
  ownSessions: number;
  coverage95: number | null;
  coverageCi: [number, number] | null;
  mae: number | null;
  bias: number | null;
  rmse: number | null;
  /** Calibration of observed on predicted (slope 1, intercept 0 = perfectly calibrated means). */
  calibrationSlope: number | null;
  calibrationIntercept: number | null;
  /** The same held-out observations predicted without the population (own OLS line / last value / population only). */
  baselines: { individualOnlyMae: number | null; persistenceMae: number | null; populationOnlyMae: number | null };
  notes: string[];
}

/**
 * Leave-one-participant-out, future-only validation: for every participant, fit the model WITHOUT them, give it
 * their first `ownSessions` sessions, and predict every later session. No held-out value is ever in a fit.
 */
export function validatePopulation(participants: readonly PopulationParticipant[], ownSessions = 3): PopulationValidation {
  const use = participants.filter((p) => p.t.length > ownSessions && p.t.length >= POPULATION_RULE.minSessions);
  const notes = ['participant-wise:_the_held-out_participant_is_absent_from_the_fit', 'future-only:_later_sessions_predicted_from_earlier_ones'];
  const none = (status: PopulationValidation['status']): PopulationValidation => ({ status, participants: use.length, predictions: 0, ownSessions, coverage95: null, coverageCi: null, mae: null, bias: null, rmse: null, calibrationSlope: null, calibrationIntercept: null, baselines: { individualOnlyMae: null, persistenceMae: null, populationOnlyMae: null }, notes });
  // checked on everything that was passed in, before any filtering
  if (participants.some((p) => p.simulated) && participants.some((p) => !p.simulated)) return none('mixed_provenance');
  if (use.length < POPULATION_RULE.minParticipants + 1) return none('insufficient_participants');
  const obs: number[] = [];
  const pred: number[] = [];
  let inside = 0;
  const eInd: number[] = [];
  const ePer: number[] = [];
  const ePop: number[] = [];
  for (const held of use) {
    const m = fitPopulation(participants.filter((p) => p.participantId !== held.participantId));
    if (m.status !== 'fitted') continue;
    const ot = held.t.slice(0, ownSessions);
    const oy = held.y.slice(0, ownSessions);
    const ft = held.t.slice(ownSessions);
    const fy = held.y.slice(ownSessions);
    const pr = predictParticipant(m, { t: ot, y: oy }, ft);
    const pop = predictParticipant(m, { t: [], y: [] }, ft);
    // individual-only: OLS line through the own sessions
    const n = ot.length;
    const mt = ot.reduce((a, b) => a + b, 0) / n;
    const my = oy.reduce((a, b) => a + b, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (let j = 0; j < n; j++) {
      sxx += ((ot[j] as number) - mt) ** 2;
      sxy += ((ot[j] as number) - mt) * ((oy[j] as number) - my);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    pr.forEach((p, j) => {
      const y = fy[j] as number;
      obs.push(y);
      pred.push(p.mean);
      if (y >= p.lo && y <= p.hi) inside++;
      eInd.push(Math.abs(y - (my + slope * ((ft[j] as number) - mt))));
      ePer.push(Math.abs(y - (oy[n - 1] as number)));
      ePop.push(Math.abs(y - (pop[j] as PopulationPrediction).mean));
    });
  }
  const k = obs.length;
  if (!k) return none('insufficient_participants');
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const err = obs.map((y, i) => y - (pred[i] as number));
  const mp = mean(pred);
  const mo = mean(obs);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < k; i++) {
    sxx += ((pred[i] as number) - mp) ** 2;
    sxy += ((pred[i] as number) - mp) * ((obs[i] as number) - mo);
  }
  const slope = sxx > 0 ? sxy / sxx : null;
  return {
    status: 'evaluated',
    participants: use.length,
    predictions: k,
    ownSessions,
    coverage95: inside / k,
    coverageCi: wilson(inside, k),
    mae: mean(err.map(Math.abs)),
    bias: mean(err),
    rmse: Math.sqrt(mean(err.map((e) => e * e))),
    calibrationSlope: slope,
    calibrationIntercept: slope !== null ? mo - slope * mp : null,
    baselines: { individualOnlyMae: mean(eInd), persistenceMae: mean(ePer), populationOnlyMae: mean(ePop) },
    notes,
  };
}
