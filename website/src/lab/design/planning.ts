// Measurement planning — which additional MEASUREMENT would reduce a scientific uncertainty most? Never which
// treatment: every function here answers a question about data collection, and its output is a projection under
// stated variance components, labelled as such.
//
// Shared measurement model (lab/models.ts): session mean ȳ_k = z_k + η_k + ε̄_k, Var = σs² + σε²/n.
//   • more repetitions shrink only σε²/n; more sessions shrink everything — the day-to-day part sets a floor that
//     repetitions cannot go below (allocation, repetitionsWorthAdding);
//   • the information a schedule carries about a model's parameters is the Fisher information
//     I(θ) = Jᵀ R⁻¹ J (J = ∂mean/∂θ at the sessions, R = diag(σs² + σε²/n)); a schedule is compared by
//     D-optimality (log det I: joint precision of all parameters) and A-optimality (trace I⁻¹: average variance);
//   • two rival models are told apart best where their predicted means differ most relative to the predictive SD —
//     the T-optimality idea of Atkinson & Fedorov (1975), evaluated on a grid of candidate session times.

import { invert, jacobian } from '../numeric';
import type { ModelFit } from '../fit';
import { MODELS, toFree, toNatural, type Prepared } from '../models';
import { normCdf, normQuantile } from '../numeric';

// ── repetitions versus sessions ───────────────────────────────────────────────────────────────────────────

export interface Allocation {
  repetitions: number;
  sessions: number;
  /** SE of the mean level over the sessions. */
  seLevel: number;
  /** SE of a linear change per week over equally spaced sessions (interval `intervalDays`); null with < 3 sessions. */
  seSlopePerWeek: number | null;
  /** Smallest difference between two single sessions detectable at 95 % (MDC95 of a session mean). */
  mdcSession: number;
}

export function allocation(sigmaE: number, sigmaS: number, repetitions: number, sessions: number, intervalDays = 7): Allocation {
  const v = sigmaS ** 2 + sigmaE ** 2 / Math.max(1, repetitions);
  const K = Math.max(1, sessions);
  // Σ (t_k − t̄)² for equally spaced weeks
  const w = intervalDays / 7;
  const sxx = (w * w * K * (K * K - 1)) / 12;
  return { repetitions, sessions, seLevel: Math.sqrt(v / K), seSlopePerWeek: K >= 3 && sxx > 0 ? Math.sqrt(v / sxx) : null, mdcSession: 1.959963984540054 * Math.SQRT2 * Math.sqrt(v) };
}

export interface RepetitionAdvice {
  /** Variance of a session mean with n repetitions, and the floor (n → ∞) set by day-to-day variation. */
  current: number;
  floor: number;
  /** Share of the session-mean variance that more repetitions could still remove. */
  removableShare: number;
  /** Repetitions beyond which less than 10 % of the session-mean variance is repetition noise. */
  enoughAt: number;
  /** 'more_repetitions' | 'more_sessions' | 'either' — which reduces the SE of the mean level more per added unit. */
  better: 'more_repetitions' | 'more_sessions' | 'either';
  explanation: string;
}

/** "Are n repetitions enough, or is another session worth more than more repetitions today?" */
export function repetitionsWorthAdding(sigmaE: number, sigmaS: number, repetitions: number, sessions: number): RepetitionAdvice {
  const n = Math.max(1, repetitions);
  const K = Math.max(1, sessions);
  const cur = sigmaS ** 2 + sigmaE ** 2 / n;
  const floor = sigmaS ** 2;
  const removable = cur > 0 ? (sigmaE ** 2 / n) / cur : 0;
  // repetition noise below 10 % of the session-mean variance: σε²/n ≤ σs²/9
  const enoughAt = sigmaS > 0 ? Math.ceil((9 * sigmaE ** 2) / sigmaS ** 2) : Infinity;
  // variance of the mean level: one more repetition in every session vs one more session of n repetitions
  const moreReps = (sigmaS ** 2 + sigmaE ** 2 / (n + 1)) / K;
  const moreSess = cur / (K + 1);
  const better = Math.abs(moreReps - moreSess) < 1e-12 * cur ? 'either' : moreReps < moreSess ? 'more_repetitions' : 'more_sessions';
  return {
    current: cur,
    floor,
    removableShare: removable,
    enoughAt,
    better,
    explanation: removable < 0.1 ? 'repetition noise is already under 10 % of the variance of a session mean: more repetitions cannot help; only more sessions can' : `${Math.round(removable * 100)} % of the variance of a session mean is repetition noise`,
  };
}

/** Sessions needed for a one-sided... two-sided test at level α to detect a level difference `delta` with the given power, per group of sessions. */
export function sessionsForDifference(sigmaE: number, sigmaS: number, repetitions: number, delta: number, power = 0.8, alpha = 0.05): number | null {
  if (!(Math.abs(delta) > 0)) return null;
  const v = sigmaS ** 2 + sigmaE ** 2 / Math.max(1, repetitions);
  const z = normQuantile(1 - alpha / 2) + normQuantile(power);
  // two phases of K sessions each: Var(difference of phase means) = 2v/K  ⇒  K = 2v z² / δ² (normal approximation)
  return Math.ceil((2 * v * z * z) / (delta * delta));
}

/** Normal-approximation power of that comparison for K sessions per phase. */
export function powerForDifference(sigmaE: number, sigmaS: number, repetitions: number, sessionsPerPhase: number, delta: number, alpha = 0.05): number {
  const v = sigmaS ** 2 + sigmaE ** 2 / Math.max(1, repetitions);
  const se = Math.sqrt((2 * v) / Math.max(1, sessionsPerPhase));
  return normCdf(Math.abs(delta) / se - normQuantile(1 - alpha / 2));
}

// ── which feature is most sensitive? ──────────────────────────────────────────────────────────────────────

export interface FeatureSensitivity {
  feature: string;
  unit: string;
  mean: number;
  /** MDC95 of a session mean, absolute and as a share of the mean level. */
  mdc: number;
  mdcRelative: number | null;
  /** Sessions per phase to detect a change of `relativeChange` of the mean with 80 % power. */
  sessionsFor: number | null;
}

/**
 * Ranks features by how small a RELATIVE change they could show. ASSUMPTION, stated with the result: the same
 * relative change in every feature — which a real change of movement need not produce. It ranks measurement
 * sensitivity, not biological relevance.
 */
export function rankFeatureSensitivity(features: readonly { feature: string; unit: string; mean: number; sigmaE: number; sigmaS: number; repetitions: number }[], relativeChange = 0.1): FeatureSensitivity[] {
  return features
    .map((f) => {
      const a = allocation(f.sigmaE, f.sigmaS, f.repetitions, 1);
      const rel = Math.abs(f.mean) > 0 ? a.mdcSession / Math.abs(f.mean) : null;
      return { feature: f.feature, unit: f.unit, mean: f.mean, mdc: a.mdcSession, mdcRelative: rel, sessionsFor: Math.abs(f.mean) > 0 ? sessionsForDifference(f.sigmaE, f.sigmaS, f.repetitions, relativeChange * Math.abs(f.mean)) : null };
    })
    .sort((x, y) => (x.mdcRelative ?? Infinity) - (y.mdcRelative ?? Infinity));
}

// ── information in a schedule ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleInformation {
  /** log det of the Fisher information of the mean-structure parameters (free scale); −Infinity when singular. */
  dCriterion: number;
  /** trace of the inverse information; Infinity when singular. */
  aCriterion: number;
  /** Asymptotic SE of each mean-structure parameter (free scale: log for time constants). */
  se: Record<string, number | null>;
  singular: boolean;
}

/** Expected Fisher information of a fitted deterministic-mean model at a schedule (times in days, dose per interval, repetitions). */
export function scheduleInformation(fit: ModelFit, d: Prepared, schedule: { t: readonly number[]; dose: readonly number[]; n: readonly number[] }): ScheduleInformation | null {
  if (fit.status !== 'ok' || fit.model === 'local_level') return null;
  const spec = MODELS[fit.model];
  const nMean = spec.params.length - 1;
  const sS = fit.params[nMean] as number;
  const free = fit.params.slice(0, nMean).map((v, i) => toFree(spec.params[i]!.transform, v));
  const means = (u: number[]) => {
    const p = [...u.map((v, i) => toNatural(spec.params[i]!.transform, v)), sS];
    const dd: Prepared = { ...d, t: [...schedule.t], dose: [...schedule.dose], y: schedule.t.map(() => 0), n: [...schedule.n] };
    return spec.latent(p, dd).mean;
  };
  const J = jacobian(means, free);
  const I: number[][] = Array.from({ length: nMean }, () => new Array<number>(nMean).fill(0));
  schedule.t.forEach((_, k) => {
    const r = sS * sS + d.sigmaE2 / Math.max(1, schedule.n[k] as number);
    for (let a = 0; a < nMean; a++) for (let b = 0; b < nMean; b++) I[a]![b] = (I[a]![b] as number) + ((J[k]![a] as number) * (J[k]![b] as number)) / r;
  });
  const C = invert(I);
  const se: Record<string, number | null> = {};
  spec.params.slice(0, nMean).forEach((def, i) => (se[def.name] = C && (C[i]![i] as number) > 0 ? Math.sqrt(C[i]![i] as number) : null));
  if (!C) return { dCriterion: -Infinity, aCriterion: Infinity, se, singular: true };
  // log det by Gaussian elimination on a copy
  const A = I.map((r) => [...r]);
  let logDet = 0;
  let sign = 1;
  for (let c = 0; c < nMean; c++) {
    let p = c;
    for (let r = c + 1; r < nMean; r++) if (Math.abs(A[r]![c] as number) > Math.abs(A[p]![c] as number)) p = r;
    if (p !== c) {
      [A[c], A[p]] = [A[p] as number[], A[c] as number[]];
      sign = -sign;
    }
    const piv = A[c]![c] as number;
    if (!(Math.abs(piv) > 0)) return { dCriterion: -Infinity, aCriterion: Infinity, se, singular: true };
    if (piv < 0) sign = -sign;
    logDet += Math.log(Math.abs(piv));
    for (let r = c + 1; r < nMean; r++) {
      const f = (A[r]![c] as number) / piv;
      for (let j = c; j < nMean; j++) A[r]![j] = (A[r]![j] as number) - f * (A[c]![j] as number);
    }
  }
  return { dCriterion: sign > 0 ? logDet : -Infinity, aCriterion: C.reduce((a, r, i) => a + (r[i] as number), 0), se, singular: false };
}

export interface NextSessionOption {
  afterDays: number;
  dose: number;
  dGain: number | null;
  aRatio: number | null;
}

/** Compare candidate next sessions by the gain in D-criterion and the ratio of A-criteria (after / before; < 1 = better). */
export function compareNextSessions(fit: ModelFit, d: Prepared, candidates: readonly { afterDays: number; dose: number }[], repetitions = 3): NextSessionOption[] {
  const base = scheduleInformation(fit, d, { t: d.t, dose: d.dose, n: d.n });
  const last = d.t[d.t.length - 1] ?? 0;
  return candidates.map((c) => {
    const s = scheduleInformation(fit, d, { t: [...d.t, last + c.afterDays], dose: [...d.dose, c.dose], n: [...d.n, repetitions] });
    return { afterDays: c.afterDays, dose: c.dose, dGain: base && s && !base.singular && !s.singular ? s.dCriterion - base.dCriterion : null, aRatio: base && s && !base.singular && !s.singular ? s.aCriterion / base.aCriterion : null };
  });
}

// ── telling two models apart ──────────────────────────────────────────────────────────────────────────────

export interface DiscriminationOption {
  afterDays: number;
  /** Predicted means of the two models at that time. */
  meanA: number;
  meanB: number;
  /** |difference| in units of the SD of a new session mean: the expected z-score separating the models. */
  separation: number;
  /** Probability that a single session at that time falls closer to the right model, if one of them is true. */
  pCorrect: number;
}

/**
 * At which future time would ONE more session best tell two fitted models apart? A planning projection: assumes
 * one of the two is true and that day-to-day variation stays as estimated.
 */
export function discriminationDesign(a: ModelFit, b: ModelFit, d: Prepared, afterDays: readonly number[], repetitions = 3, dose = 1): DiscriminationOption[] {
  if (a.status !== 'ok' || b.status !== 'ok') return [];
  const last = d.t[d.t.length - 1] ?? 0;
  const sA = a.params[a.params.length - 1] as number;
  const sB = b.params[b.params.length - 1] as number;
  const sd = Math.sqrt(Math.max(sA, sB) ** 2 + d.sigmaE2 / Math.max(1, repetitions));
  return afterDays.map((dt) => {
    const f = [{ t: last + dt, dose }];
    const ma = MODELS[a.model].forecast(a.params, d, f)[0]!;
    const mb = MODELS[b.model].forecast(b.params, d, f)[0]!;
    const s = Math.sqrt(sd * sd + Math.max(ma.varLatent, mb.varLatent));
    const sep = s > 0 ? Math.abs(ma.mean - mb.mean) / s : 0;
    return { afterDays: dt, meanA: ma.mean, meanB: mb.mean, separation: sep, pCorrect: normCdf(sep / 2) };
  });
}
