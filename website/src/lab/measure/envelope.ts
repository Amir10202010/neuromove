// Personal measurement envelope — the range in which the mean of ONE more session of the same person, task and
// protocol is expected to fall if nothing has changed, estimated from that person's own stable baseline sessions.
//
// It answers "is this session outside this child's ordinary session-to-session variation?" without borrowing a
// population norm. It is NOT a clinical reference interval, and a session outside it is not automatically a
// meaningful change: it is a statistical statement about measurement and day-to-day variation only.
//
// Model (the lab's shared measurement model, lab/models.ts): session mean ȳ_k = z + η_k + ε̄_k,
//   η_k ~ N(0, σs²) day-to-day (re-attachment, calibration posture, state of the child), ε_kr ~ N(0, σε²) repetition.
// With K baseline sessions (n_k repetitions each, h = mean 1/n_k) and a new session of m repetitions:
//   Var(ȳ_new − ȳ..) = σs²(1 + 1/K) + σε²(1/m + h/K)
//   S² (sample variance of the baseline session means, K − 1 df) estimates σs² + σε²·h
//   σ̂ε² (pooled within-session variance, Σ(n_k − 1) df)
//   V̂ = S²(1 + 1/K) + σ̂ε²(1/m − h)            — for m = n this is S²(1 + 1/K) and the interval is exactly Student-t
//   95 % interval: ȳ.. ± t(0.975; ν)·√V̂; ν = K − 1 for m ≥ n, Satterthwaite (1946) for a shorter new session.
//   Coverage for m ≠ n is checked by Monte Carlo in measure.test.ts.
// The uncertainty of σs from few sessions is IN the interval (through t and ν): with 3 sessions it is 2.2× wider than
// a normal-theory interval, and it is reported, not hidden.

import { tCdf, tQuantile } from '../../research/stats';

export interface EnvelopeSession {
  sessionId: string;
  /** Days since the first baseline session. */
  day: number;
  mean: number;
  n: number;
  /** Within-session sum of squares Σ(y − ȳ)². */
  ss: number;
}

export type EnvelopeStatus = 'insufficient' | 'provisional' | 'usable' | 'baseline_not_stable';

export interface MeasurementEnvelope {
  status: EnvelopeStatus;
  reasons: string[];
  sessions: number;
  centre: number;
  /** Sample SD of the baseline session means (K − 1 df). */
  sdSessionMeans: number;
  /** Pooled repetition SD and its degrees of freedom (null when no session has two repetitions). */
  sigmaE: number | null;
  dfE: number;
  /** Day-to-day SD component, √max(0, S² − σε²·h). */
  sigmaS: number | null;
  /** mean(1/n_k) of the baseline sessions. */
  h: number;
  /** The baseline sessions were recorded with the sensors re-attached between them (separate sessions). */
  includesReattachment: boolean;
  /** Linear trend across the baseline (descriptive stability check; null below 4 sessions). */
  trend: { slopePerWeek: number; p: number } | null;
}

/**
 * Status rule (fixed before any data):
 *   insufficient          fewer than 3 baseline sessions — no interval is produced
 *   baseline_not_stable   ≥ 4 sessions and a linear trend across them with p < 0.05: the "noise" would contain change
 *   provisional           the t-quantile exceeds 1.5 × the normal quantile (K ≤ 4): usable but very wide
 *   usable                otherwise
 */
export const ENVELOPE_RULE = { minSessions: 3, trendAlpha: 0.05, provisionalInflation: 1.5 } as const;

export function buildEnvelope(baseline: readonly EnvelopeSession[], o: { includesReattachment: boolean } = { includesReattachment: true }): MeasurementEnvelope {
  const K = baseline.length;
  const reasons: string[] = [];
  const means = baseline.map((s) => s.mean);
  const centre = K ? means.reduce((a, b) => a + b, 0) / K : NaN;
  const S2 = K >= 2 ? means.reduce((a, m) => a + (m - centre) ** 2, 0) / (K - 1) : NaN;
  const dfE = baseline.reduce((a, s) => a + Math.max(0, s.n - 1), 0);
  const sE2 = dfE > 0 ? baseline.reduce((a, s) => a + s.ss, 0) / dfE : NaN;
  const h = K ? baseline.reduce((a, s) => a + 1 / Math.max(1, s.n), 0) / K : NaN;
  let trend: MeasurementEnvelope['trend'] = null;
  if (K >= 4) {
    const t = baseline.map((s) => s.day / 7);
    const mt = t.reduce((a, b) => a + b, 0) / K;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < K; i++) {
      sxx += ((t[i] as number) - mt) ** 2;
      sxy += ((t[i] as number) - mt) * ((means[i] as number) - centre);
    }
    if (sxx > 0) {
      const b = sxy / sxx;
      let rss = 0;
      for (let i = 0; i < K; i++) rss += ((means[i] as number) - centre - b * ((t[i] as number) - mt)) ** 2;
      const se = Math.sqrt(rss / (K - 2) / sxx);
      const p = se > 0 ? 2 * (1 - tCdf(Math.abs(b / se), K - 2)) : b === 0 ? 1 : 0;
      trend = { slopePerWeek: b, p };
    }
  }
  let status: EnvelopeStatus;
  if (K < ENVELOPE_RULE.minSessions) {
    status = 'insufficient';
    reasons.push(`only_${K}_baseline_sessions_(minimum_${ENVELOPE_RULE.minSessions})`);
  } else if (trend && trend.p < ENVELOPE_RULE.trendAlpha) {
    status = 'baseline_not_stable';
    reasons.push(`trend_across_the_baseline_${trend.slopePerWeek.toFixed(2)}_per_week_(p_${trend.p.toFixed(3)})`);
  } else if (tQuantile(0.975, K - 1) > ENVELOPE_RULE.provisionalInflation * 1.959963984540054) {
    status = 'provisional';
    reasons.push(`${K}_sessions:_interval_${(tQuantile(0.975, K - 1) / 1.959963984540054).toFixed(1)}×_wider_than_with_known_variability`);
  } else status = 'usable';
  if (!(dfE > 0)) reasons.push('no_within_session_replicates:_repetition_noise_unknown,_only_equal-length_sessions_can_be_assessed');
  if (!o.includesReattachment) reasons.push('baseline_from_one_sitting:_excludes_day-to-day_and_re-attachment_variation_—_not_valid_for_between-session_change');
  return {
    status,
    reasons,
    sessions: K,
    centre,
    sdSessionMeans: Math.sqrt(S2),
    sigmaE: Number.isFinite(sE2) ? Math.sqrt(sE2) : null,
    dfE,
    sigmaS: Number.isFinite(sE2) && Number.isFinite(S2) ? Math.sqrt(Math.max(0, S2 - sE2 * h)) : null,
    h,
    includesReattachment: o.includesReattachment,
    trend,
  };
}

export interface EnvelopeInterval {
  lo: number;
  hi: number;
  halfWidth: number;
  /** Standard deviation of (new session mean − baseline centre). */
  sd: number;
  /** Degrees of freedom of the t interval (Satterthwaite). */
  df: number;
}

/** 95 % (or `level`) interval for the mean of a new session of `m` repetitions; null when the envelope cannot give one. */
export function envelopeInterval(env: MeasurementEnvelope, m: number, level = 0.95): EnvelopeInterval | null {
  if (env.status === 'insufficient' || !(env.sessions >= ENVELOPE_RULE.minSessions) || !(m >= 1)) return null;
  const K = env.sessions;
  const S2 = env.sdSessionMeans ** 2;
  const a = 1 + 1 / K;
  let V = a * S2;
  let df = K - 1;
  if (env.sigmaE !== null && env.dfE > 0) {
    const sE2 = env.sigmaE ** 2;
    const b = 1 / m - env.h;
    const v = a * S2 + b * sE2;
    // lower bound: no day-to-day component at all
    const floor = sE2 * (1 / m + env.h / K);
    if (v > floor) {
      V = v;
      // b ≥ 0 (new session not longer than the baseline ones): Satterthwaite with positive coefficients.
      // b < 0: Satterthwaite is not valid for a DIFFERENCE of mean squares (it collapses towards 1 df); the
      // between-session mean square dominates and σε is far better known, so its K − 1 df are used.
      df = b >= 0 ? v ** 2 / ((a * S2) ** 2 / (K - 1) + (b * sE2) ** 2 / env.dfE) : K - 1;
    } else {
      V = floor;
      df = env.dfE;
    }
  }
  if (!(V > 0) || !(df >= 1)) return null;
  const sd = Math.sqrt(V);
  const half = tQuantile(1 - (1 - level) / 2, df) * sd;
  return { lo: env.centre - half, hi: env.centre + half, halfWidth: half, sd, df };
}

export interface EnvelopeAssessment {
  /** (session mean − centre) / sd of the difference. */
  t: number;
  /** Two-sided p-value under "nothing changed" (Student-t). */
  p: number;
  outside: boolean;
  direction: 'above' | 'below' | 'inside';
  interval: EnvelopeInterval;
}

/** Is a session of `m` repetitions with mean `mean` outside the envelope? null when no interval exists. */
export function assessAgainstEnvelope(env: MeasurementEnvelope, mean: number, m: number, level = 0.95): EnvelopeAssessment | null {
  const iv = envelopeInterval(env, m, level);
  if (!iv || !Number.isFinite(mean)) return null;
  const t = (mean - env.centre) / iv.sd;
  const outside = mean < iv.lo || mean > iv.hi;
  return { t, p: 2 * (1 - tCdf(Math.abs(t), iv.df)), outside, direction: !outside ? 'inside' : mean > iv.hi ? 'above' : 'below', interval: iv };
}

/**
 * How the envelope's half-width would change with the number of repetitions in the next session and with more
 * baseline sessions (variance components held at their estimates) — for planning, labelled as a projection.
 */
export function envelopePlanning(env: MeasurementEnvelope, repetitions: readonly number[] = [1, 3, 5, 10], extraSessions: readonly number[] = [0, 2, 5]): { repetitions: number; baselineSessions: number; halfWidth: number }[] {
  const out: { repetitions: number; baselineSessions: number; halfWidth: number }[] = [];
  if (env.sigmaS === null || env.sigmaE === null || env.status === 'insufficient') return out;
  for (const add of extraSessions)
    for (const m of repetitions) {
      const K = env.sessions + add;
      const V = env.sigmaS ** 2 * (1 + 1 / K) + env.sigmaE ** 2 * (1 / m + env.h / K);
      out.push({ repetitions: m, baselineSessions: K, halfWidth: tQuantile(0.975, K - 1) * Math.sqrt(V) });
    }
  return out;
}
