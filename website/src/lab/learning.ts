// Learning decomposition of one series — the performance/learning distinction made explicit
// (Kantak & Winstein 2012, doi:10.1016/j.bbr.2011.11.028; Soderstrom & Bjork 2015, doi:10.1177/1745691615569000).
//
//   immediate performance   the session mean with its within-session uncertainty           (calculated)
//   within-session change   slope across repetitions of one session                         (calculated; ≥ 4 reps)
//   online / offline change last − first repetition within a session; first of next − last of previous
//                           (Reis et al. 2009, doi:10.1073/pnas.0805413106; Bönstrup et al. 2019)
//   between-session change  difference of consecutive session means vs session-to-session variability
//   retention               change across a delay ≥ the protocol's retention delay, with what is known about
//                           practice in the delay. Called a RETENTION TEST only when the protocol designates the
//                           session and no practice was recorded; otherwise a "delayed observation".
//   transfer                change in a task the protocol designates as untrained (transfer) — otherwise not assessable
//
// Nothing here claims learning from a single repetition, and an immediate improvement is never labelled retained.

import type { LearningSeries } from './dataset';
import { meanOf, varianceOf } from './numeric';
import { tQuantile } from '../research/stats';

export interface LearningConfig {
  /** Minimum repetitions in a session for a within-session slope. */
  minRepsWithin: number;
  /** Interval (days) at or above which the next session is a delayed observation. */
  retentionDelayDays: number;
  /** Sessions the protocol designates as retention tests. */
  retentionSessionIds: readonly string[];
  /** Task keys `${exercise}:${side}` the protocol designates as transfer (untrained) tasks; empty = none designated. */
  transferTasks: readonly string[];
  /** External minimal detectable change (same unit), when a reliability study provides one. */
  externalMdc: number | null;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  minRepsWithin: 4,
  retentionDelayDays: 14,
  retentionSessionIds: [],
  transferTasks: [],
  externalMdc: null,
};

export interface SessionEstimate {
  sessionId: string;
  day: number;
  mean: number;
  n: number;
  /** SE of the session mean from the POOLED repetition SD (σε/√n). Excludes day-to-day variability. */
  se: number;
  lo: number;
  hi: number;
  included: boolean;
}

export interface WithinSession {
  sessionId: string;
  n: number;
  /** Change per repetition (OLS slope), with SE from the residuals (df n − 2). */
  slope: number;
  se: number;
}

export interface ChangeEstimate {
  fromSessionId: string;
  toSessionId: string;
  days: number;
  delta: number;
  /** SE of the difference including day-to-day variability: √(σε²/n₁ + σε²/n₂ + 2σs²). */
  se: number;
  exceedsNoise: boolean;
  exceedsExternalMdc: boolean | null;
}

export type RetentionKind = 'retention_test' | 'delayed_observation';
export interface RetentionObservation extends ChangeEstimate {
  kind: RetentionKind;
  practiceInDelay: 'none_recorded' | 'recorded' | 'unknown';
  /** (after − first) / (before − first), only when the gain before the delay exceeds 2 SE. */
  retentionRatio: number | null;
}

export interface LearningDecomposition {
  sigmaE: number;
  sigmaS: number;
  sessions: SessionEstimate[];
  within: WithinSession[];
  /** Inverse-variance mean within-session slope across sessions with ≥ minRepsWithin repetitions. */
  withinPooled: { slope: number; se: number; sessions: number } | null;
  online: { mean: number; se: number; sessions: number } | null;
  offline: { mean: number; se: number; intervals: number } | null;
  between: ChangeEstimate[];
  overall: ChangeEstimate | null;
  retention: RetentionObservation[];
  transfer: { status: 'not_designated' | 'trained_task' | 'transfer_task'; change: ChangeEstimate | null };
  notes: string[];
}

/**
 * σs (day-to-day SD) comes from the caller — normally the stationary-model estimate or the selected model's σs —
 * because it is a model quantity; σε is the pooled within-session SD of THIS series.
 */
export function decompose(series: LearningSeries, sigmaS: number, cfg: LearningConfig = DEFAULT_LEARNING_CONFIG): LearningDecomposition {
  const inc = series.sessions.filter((s) => s.included);
  let ss = 0;
  let df = 0;
  for (const s of inc) {
    for (const v of s.reps) ss += (v - s.mean) ** 2;
    df += Math.max(0, s.n - 1);
  }
  const sigmaE = df > 0 ? Math.sqrt(ss / df) : NaN;
  const notes: string[] = [];
  if (!(df > 0)) notes.push('no_within_session_replicates');
  const tq = df > 0 ? tQuantile(0.975, df) : NaN;

  const sessions: SessionEstimate[] = series.sessions.map((s) => {
    const se = Number.isFinite(sigmaE) ? sigmaE / Math.sqrt(Math.max(1, s.n)) : NaN;
    return { sessionId: s.sessionId, day: s.day, mean: s.mean, n: s.n, se, lo: s.mean - tq * se, hi: s.mean + tq * se, included: s.included };
  });

  // within-session slopes
  const within: WithinSession[] = [];
  for (const s of inc) {
    if (s.n < cfg.minRepsWithin) continue;
    const x = s.reps.map((_, i) => i);
    const mx = meanOf(x);
    const my = s.mean;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < s.n; i++) {
      sxx += ((x[i] as number) - mx) ** 2;
      sxy += ((x[i] as number) - mx) * ((s.reps[i] as number) - my);
    }
    const b = sxy / sxx;
    let rss = 0;
    for (let i = 0; i < s.n; i++) rss += ((s.reps[i] as number) - (my + b * ((x[i] as number) - mx))) ** 2;
    within.push({ sessionId: s.sessionId, n: s.n, slope: b, se: Math.sqrt(rss / (s.n - 2) / sxx) });
  }
  let withinPooled: LearningDecomposition['withinPooled'] = null;
  const wOk = within.filter((w) => w.se > 0);
  if (wOk.length) {
    const wsum = wOk.reduce((a, w) => a + 1 / (w.se * w.se), 0);
    withinPooled = { slope: wOk.reduce((a, w) => a + w.slope / (w.se * w.se), 0) / wsum, se: Math.sqrt(1 / wsum), sessions: wOk.length };
  } else if (inc.length) notes.push('within_session_needs_more_repetitions');

  // online / offline (first and last repetition)
  const on = inc.filter((s) => s.n >= 2).map((s) => (s.reps[s.n - 1] as number) - (s.reps[0] as number));
  const off: number[] = [];
  for (let k = 1; k < inc.length; k++) {
    const a = inc[k - 1]!;
    const b = inc[k]!;
    if (a.n >= 1 && b.n >= 1) off.push((b.reps[0] as number) - (a.reps[a.n - 1] as number));
  }
  const summ = (xs: number[]) => (xs.length >= 2 ? { mean: meanOf(xs), se: Math.sqrt(varianceOf(xs) / xs.length) } : null);
  const onS = summ(on);
  const offS = summ(off);
  if (on.length) notes.push('online_offline_single_repetitions_are_noisy');

  const change = (a: (typeof inc)[number], b: (typeof inc)[number]): ChangeEstimate => {
    const se = Math.sqrt((sigmaE * sigmaE) / Math.max(1, a.n) + (sigmaE * sigmaE) / Math.max(1, b.n) + 2 * sigmaS * sigmaS);
    const delta = b.mean - a.mean;
    return {
      fromSessionId: a.sessionId,
      toSessionId: b.sessionId,
      days: b.day - a.day,
      delta,
      se,
      exceedsNoise: Number.isFinite(se) && Math.abs(delta) > 1.959963984540054 * se,
      exceedsExternalMdc: cfg.externalMdc === null ? null : Math.abs(delta) > cfg.externalMdc,
    };
  };
  const between: ChangeEstimate[] = [];
  for (let k = 1; k < inc.length; k++) between.push(change(inc[k - 1]!, inc[k]!));
  const overall = inc.length >= 2 ? change(inc[0]!, inc[inc.length - 1]!) : null;

  const retention: RetentionObservation[] = [];
  for (let k = 1; k < inc.length; k++) {
    const a = inc[k - 1]!;
    const b = inc[k]!;
    const designated = cfg.retentionSessionIds.includes(b.sessionId);
    if (!(b.day - a.day >= cfg.retentionDelayDays) && !designated) continue;
    const c = change(a, b);
    const practiceInDelay: RetentionObservation['practiceInDelay'] =
      b.doseBefore === null ? 'unknown' : (b.doseBefore ?? 0) > 0 || (b.practiceCountBefore ?? 0) > 0 ? 'recorded' : 'none_recorded';
    const first = inc[0]!;
    const gainBefore = a.mean - first.mean;
    const seGain = Math.sqrt((sigmaE * sigmaE) / Math.max(1, a.n) + (sigmaE * sigmaE) / Math.max(1, first.n) + 2 * sigmaS * sigmaS);
    retention.push({
      ...c,
      kind: designated && practiceInDelay === 'none_recorded' ? 'retention_test' : 'delayed_observation',
      practiceInDelay,
      retentionRatio: a !== first && Math.abs(gainBefore) > 2 * seGain ? (b.mean - first.mean) / gainBefore : null,
    });
  }

  const taskKey = `${series.exercise}:${series.side}`;
  const transfer: LearningDecomposition['transfer'] = !cfg.transferTasks.length
    ? { status: 'not_designated', change: null }
    : cfg.transferTasks.includes(taskKey)
      ? { status: 'transfer_task', change: overall }
      : { status: 'trained_task', change: null };

  return { sigmaE, sigmaS, sessions, within, withinPooled, online: onS ? { ...onS, sessions: on.length } : null, offline: offS ? { ...offS, intervals: off.length } : null, between, overall, retention, transfer, notes };
}

/**
 * Structural confound check for the learning–retention model: with (nearly) constant intervals AND doses, its
 * half-life is a re-parameterisation of the exponential curvature (experiments.ts, E5) — "forgetting" cannot be
 * told apart from "saturation". Returns the coefficients of variation used for the decision.
 */
export function scheduleVariation(t: readonly number[], dose: readonly number[]): { cvInterval: number; cvDose: number; confounded: boolean } {
  const dt = t.slice(1).map((x, i) => x - (t[i] as number));
  const ds = dose.slice(1);
  const cv = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = meanOf(xs);
    return m !== 0 ? Math.sqrt(varianceOf(xs)) / Math.abs(m) : 0;
  };
  const cvInterval = cv(dt);
  const cvDose = cv(ds);
  return { cvInterval, cvDose, confounded: cvInterval < 0.25 && cvDose < 0.25 };
}
