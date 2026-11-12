// Early change detection in one person's series of session means — when does the evidence say "this is no longer
// the same level", and how often would it say so by mistake?
//
// The difficulty is the short series: the person's own mean and variability must be learned from the same few
// sessions that are monitored. A control chart with limits from 3–5 baseline sessions has a far higher false-alarm
// rate than its nominal one (Jensen et al. 2006). The detectors here therefore run on SELF-STARTING recursive
// residuals (Hawkins 1987):
//     T_k = √((k−1)/k) · (y_k − ȳ_{k−1}) / s_{k−1}  ~  t(k−2)      under "no change, independent normal sessions"
//     U_k = Φ⁻¹(F_t(T_k; k−2))                       ~  N(0, 1) i.i.d., exactly, from the third session on
// — the standardised one-step-ahead prediction errors of the stationary model, with the uncertainty of the mean and
// SD already in them. On U_k:
//     CUSUM     C⁺_k = max(0, C⁺_{k−1} + U_k − ½), C⁻_k likewise; alarm above h          (Page 1954) — PRIMARY
//     EWMA      Z_k = λU_k + (1−λ)Z_{k−1}, λ = ¼; alarm beyond ±L·σ_Z(k)                 (Roberts 1959)
//     Shewhart  |U_k| beyond the Šidák-adjusted normal quantile for the number of looks  (sequential prediction interval)
// Thresholds are calibrated by simulation so that each detector alone signals in at most 5 % of UNCHANGED series of
// the design horizon (20 sessions); see CALIBRATION and benchmark O1. The verdict uses the CUSUM only (fixed in
// advance); the other two and the Bayesian posterior are corroboration, shown separately.
//
// Retrospective view — Bayesian single change point in the mean: for every split τ the two-sample Bayes factor with
// a normal prior on the standardised shift (Gönen et al. 2005), uniform prior over τ, prior probability ½ of "a
// change". Reported with its sensitivity to the prior scale, because a Bayes factor without that is not a result.
//
// What a signal means: the series is statistically inconsistent with one stable level. It is NOT a statement that
// the change is clinically meaningful, that it is recovery, or what caused it; and with fewer than about 8 sessions
// the power is low (benchmark O2), so "no signal" is not evidence of stability.

import { tCdf } from '../../research/stats';
import { normCdf, normQuantile } from '../numeric';

export interface DetectionOptions {
  /** Sessions the series is planned to have: thresholds keep the false-alarm probability over this many sessions. */
  horizon?: 10 | 20 | 40;
  /** Number of series monitored together (e.g. features): each detector's false-alarm probability is divided by it. */
  family?: number;
}

/** Design constants (fixed before any data): CUSUM reference value, EWMA weight, Bayesian prior scales. */
export const DETECTION_RULE = { cusumK: 0.5, ewmaLambda: 0.25, alpha: 0.05, minSessions: 4, priorScale: 1, priorScales: [0.5, 1, 2], corroboration: 0.9 } as const;

/**
 * Thresholds giving a series-wise false-alarm probability α for i.i.d. N(0,1) residuals over `horizon − 2`
 * monitored points. Computed by Monte Carlo (200 000 series per horizon, seeds 20261110 + horizon; script
 * research/benchmarks/change-detection-calibration.mjs) and verified on other seeds, through this code, by
 * benchmark O1. Keyed [horizon][α].
 */
export const CALIBRATION: Record<10 | 20 | 40, { alpha: number; cusumH: number; ewmaL: number }[]> = {
  10: [
    { alpha: 0.05, cusumH: 3.453, ewmaL: 2.64 },
    { alpha: 0.025, cusumH: 3.975, ewmaL: 2.887 },
    { alpha: 0.0167, cusumH: 4.266, ewmaL: 3.023 },
    { alpha: 0.0125, cusumH: 4.473, ewmaL: 3.113 },
    { alpha: 0.01, cusumH: 4.631, ewmaL: 3.178 },
    { alpha: 0.005, cusumH: 5.075, ewmaL: 3.384 },
  ],
  20: [
    { alpha: 0.05, cusumH: 4.436, ewmaL: 2.905 },
    { alpha: 0.025, cusumH: 5.046, ewmaL: 3.13 },
    { alpha: 0.0167, cusumH: 5.384, ewmaL: 3.258 },
    { alpha: 0.0125, cusumH: 5.622, ewmaL: 3.345 },
    { alpha: 0.01, cusumH: 5.806, ewmaL: 3.409 },
    { alpha: 0.005, cusumH: 6.406, ewmaL: 3.596 },
  ],
  40: [
    { alpha: 0.05, cusumH: 5.287, ewmaL: 3.135 },
    { alpha: 0.025, cusumH: 5.934, ewmaL: 3.349 },
    { alpha: 0.0167, cusumH: 6.305, ewmaL: 3.465 },
    { alpha: 0.0125, cusumH: 6.578, ewmaL: 3.549 },
    { alpha: 0.01, cusumH: 6.806, ewmaL: 3.605 },
    { alpha: 0.005, cusumH: 7.446, ewmaL: 3.776 },
  ],
};

function thresholds(horizon: 10 | 20 | 40, alpha: number): { cusumH: number; ewmaL: number; alphaUsed: number } {
  const rows = CALIBRATION[horizon];
  // the largest tabulated α not exceeding the requested one (conservative)
  const ok = rows.filter((r) => r.alpha <= alpha + 1e-12).sort((a, b) => b.alpha - a.alpha)[0] ?? rows[rows.length - 1];
  if (!ok) throw new Error('change-detection thresholds are not calibrated');
  return { cusumH: ok.cusumH, ewmaL: ok.ewmaL, alphaUsed: ok.alpha };
}

/** Standard normal quantile of a Student-t probability, safe in the tails. */
function tToNormal(t: number, df: number): number {
  const p = tCdf(t, df);
  // symmetric evaluation keeps precision for large |t|
  if (t > 0) return -normQuantile(Math.max(1e-300, 1 - p));
  return normQuantile(Math.max(1e-300, p));
}

/** Self-starting residuals U_k (null for the first two sessions, and wherever the running SD is 0). */
export function recursiveResiduals(y: readonly number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < y.length; i++) {
    const k = i; // sessions before this one
    if (k >= 2) {
      const mean = sum / k;
      const s2 = (sumSq - k * mean * mean) / (k - 1);
      if (s2 > 0) out.push(tToNormal((Math.sqrt(k / (k + 1)) * ((y[i] as number) - mean)) / Math.sqrt(s2), k - 1));
      else out.push(null);
    } else out.push(null);
    sum += y[i] as number;
    sumSq += (y[i] as number) ** 2;
  }
  return out;
}

export interface BayesChange {
  /** Posterior probability that the mean changed at some point (prior ½). */
  pChange: number;
  /** Posterior over "the change happened after session τ" (conditional on a change). */
  tau: { after: number; p: number }[];
  mostLikelyAfter: number;
  /** Mean after − mean before at the most likely split, in the series' units. */
  shift: number;
  /** pChange under other prior scales of the standardised shift. */
  sensitivity: { scale: number; pChange: number }[];
}

/** Two-sample Bayes factor BF₁₀ for a split after τ with prior δ/σ ~ N(0, scale²) (Gönen et al. 2005). */
function bf10(y: readonly number[], tau: number, scale: number): number {
  const a = y.slice(0, tau);
  const b = y.slice(tau);
  const n1 = a.length;
  const n2 = b.length;
  const m1 = a.reduce((s, v) => s + v, 0) / n1;
  const m2 = b.reduce((s, v) => s + v, 0) / n2;
  const ss = a.reduce((s, v) => s + (v - m1) ** 2, 0) + b.reduce((s, v) => s + (v - m2) ** 2, 0);
  const nu = n1 + n2 - 2;
  const nd = (n1 * n2) / (n1 + n2);
  if (!(ss > 0)) return m1 === m2 ? 1 : Infinity;
  const t2 = ((m2 - m1) ** 2 * nd) / (ss / nu);
  const g = 1 + nd * scale * scale;
  // log BF10 = −½ ln g + ((ν+1)/2)·[ln(1 + t²/ν) − ln(1 + t²/(ν g))]
  return Math.exp(-0.5 * Math.log(g) + ((nu + 1) / 2) * (Math.log(1 + t2 / nu) - Math.log(1 + t2 / (nu * g))));
}

export function bayesChangePoint(y: readonly number[]): BayesChange | null {
  const n = y.length;
  // at least two sessions on each side of a split
  if (n < 5) return null;
  const taus: number[] = [];
  for (let t = 2; t <= n - 2; t++) taus.push(t);
  const post = (scale: number) => {
    const bfs = taus.map((t) => bf10(y, t, scale));
    const avg = bfs.reduce((a, b) => a + b, 0) / bfs.length;
    return { bfs, pChange: Number.isFinite(avg) ? avg / (1 + avg) : 1 };
  };
  const main = post(DETECTION_RULE.priorScale);
  const tot = main.bfs.reduce((a, b) => a + b, 0);
  const tau = taus.map((t, i) => ({ after: t, p: tot > 0 && Number.isFinite(tot) ? (main.bfs[i] as number) / tot : NaN }));
  const best = tau.reduce((a, b) => (b.p > a.p ? b : a));
  const before = y.slice(0, best.after);
  const after = y.slice(best.after);
  return {
    pChange: main.pChange,
    tau,
    mostLikelyAfter: best.after,
    shift: after.reduce((a, b) => a + b, 0) / after.length - before.reduce((a, b) => a + b, 0) / before.length,
    sensitivity: DETECTION_RULE.priorScales.map((scale) => ({ scale, pChange: post(scale).pChange })),
  };
}

export interface ChangeDetection {
  status: 'insufficient_data' | 'no_change_signalled' | 'change_signalled';
  sessions: number;
  /** Self-starting residuals (null for the first two sessions). */
  u: (number | null)[];
  cusum: { pos: number[]; neg: number[]; h: number; k: number; alarmAt: number | null; direction: 'up' | 'down' | null };
  ewma: { z: (number | null)[]; limit: (number | null)[]; alarmAt: number | null };
  shewhart: { limit: number; alarmAt: number | null };
  bayes: BayesChange | null;
  /** The primary detector signalled AND (another detector signalled or the posterior probability of a change ≥ 0.9). */
  corroborated: boolean;
  /** Series-wise false-alarm probability each sequential detector was calibrated to. */
  alpha: number;
  horizon: number;
  notes: string[];
}

/** Monitor one series of session means, in time order. Sessions that were not observed are simply absent — nothing is interpolated. */
export function detectChange(y: readonly number[], o: DetectionOptions = {}): ChangeDetection {
  const n = y.length;
  const horizon = o.horizon ?? 20;
  const alpha = DETECTION_RULE.alpha / Math.max(1, o.family ?? 1);
  const notes: string[] = [];
  const u = recursiveResiduals(y);
  const th = thresholds(horizon, alpha);
  if (n > horizon) notes.push(`series_longer_than_the_design_horizon_of_${horizon}_sessions:_false-alarm_probability_exceeds_the_nominal_value`);
  if (th.alphaUsed < alpha - 1e-12) notes.push(`thresholds_tabulated_for_alpha_${th.alphaUsed}_(conservative)`);
  const looks = Math.max(1, horizon - 2);
  const shLimit = -normQuantile((1 - (1 - th.alphaUsed) ** (1 / looks)) / 2);
  const pos: number[] = [];
  const neg: number[] = [];
  const z: (number | null)[] = [];
  const limit: (number | null)[] = [];
  let cp = 0;
  let cn = 0;
  let zz = 0;
  let m = 0;
  let cusumAt: number | null = null;
  let direction: 'up' | 'down' | null = null;
  let ewmaAt: number | null = null;
  let shAt: number | null = null;
  const lam = DETECTION_RULE.ewmaLambda;
  for (let i = 0; i < n; i++) {
    const ui = u[i];
    if (ui === null || ui === undefined) {
      pos.push(cp);
      neg.push(cn);
      z.push(null);
      limit.push(null);
      continue;
    }
    cp = Math.max(0, cp + ui - DETECTION_RULE.cusumK);
    cn = Math.max(0, cn - ui - DETECTION_RULE.cusumK);
    pos.push(cp);
    neg.push(cn);
    if (cusumAt === null && (cp > th.cusumH || cn > th.cusumH)) {
      cusumAt = i;
      direction = cp > th.cusumH ? 'up' : 'down';
    }
    m++;
    zz = lam * ui + (1 - lam) * zz;
    const lim = th.ewmaL * Math.sqrt((lam / (2 - lam)) * (1 - (1 - lam) ** (2 * m)));
    z.push(zz);
    limit.push(lim);
    if (ewmaAt === null && Math.abs(zz) > lim) ewmaAt = i;
    if (shAt === null && Math.abs(ui) > shLimit) shAt = i;
  }
  const bayes = bayesChangePoint(y);
  const base = { sessions: n, u, cusum: { pos, neg, h: th.cusumH, k: DETECTION_RULE.cusumK, alarmAt: cusumAt, direction }, ewma: { z, limit, alarmAt: ewmaAt }, shewhart: { limit: shLimit, alarmAt: shAt }, bayes, alpha: th.alphaUsed, horizon };
  if (n < DETECTION_RULE.minSessions) {
    notes.push(`only_${n}_sessions_(minimum_${DETECTION_RULE.minSessions}:_two_to_learn_the_level_and_spread,_two_to_monitor)`);
    return { ...base, status: 'insufficient_data', corroborated: false, notes };
  }
  if (u.slice(2).some((x) => x === null)) notes.push('identical_early_sessions:_some_residuals_are_undefined');
  notes.push('assumes_independent,_roughly_normal_session_means_of_similar_length;_autocorrelated_day-to-day_variation_inflates_false_alarms_(benchmark_O4)');
  if (n < 8) notes.push('fewer_than_8_sessions:_low_power_—_no_signal_is_not_evidence_of_stability');
  const corroborated = cusumAt !== null && (ewmaAt !== null || shAt !== null || (bayes !== null && bayes.pChange >= DETECTION_RULE.corroboration));
  return { ...base, status: cusumAt !== null ? 'change_signalled' : 'no_change_signalled', corroborated, notes };
}

// ── simulation helpers (calibration and benchmarks) ───────────────────────────────────────────────────────

/** Largest CUSUM and standardised EWMA excursion of an i.i.d. N(0,1) residual sequence (for threshold calibration). */
export function excursions(u: readonly number[]): { cusum: number; ewma: number } {
  let cp = 0;
  let cn = 0;
  let zz = 0;
  let mc = 0;
  let me = 0;
  const lam = DETECTION_RULE.ewmaLambda;
  u.forEach((ui, i) => {
    cp = Math.max(0, cp + ui - DETECTION_RULE.cusumK);
    cn = Math.max(0, cn - ui - DETECTION_RULE.cusumK);
    mc = Math.max(mc, cp, cn);
    zz = lam * ui + (1 - lam) * zz;
    me = Math.max(me, Math.abs(zz) / Math.sqrt((lam / (2 - lam)) * (1 - (1 - lam) ** (2 * (i + 1)))));
  });
  return { cusum: mc, ewma: me };
}

/** Two-sided p-value of the standard normal (used by callers that tabulate residuals). */
export const pNormal = (z: number): number => 2 * (1 - normCdf(Math.abs(z)));
