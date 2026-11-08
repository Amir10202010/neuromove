// Test–retest reliability of the IMU-derived metrics, from the data that exist — ICC(A,1), SEM and MDC95
// (Weir 2005, doi:10.1519/15184.1; Koo & Li 2016, doi:10.1016/j.jcm.2016.02.012; Haley & Fragala-Pinkham 2006).
//
// Nothing here is a reliability CLAIM. It computes reliability as soon as qualifying data exist, and says
// "insufficient" until then. A qualifying pair: the first two included sessions of a participant for the same task
// and metric, at most `maxDays` apart, with NO practice recorded between them. Pairs where practice is unknown
// (no practice log) are counted separately and excluded unless the analyst includes them — practice between
// sessions turns real change into apparent unreliability.
//
// The existing two-way ANOVA ICC (research/stats.ts) is reused unchanged.

import { icc, sufficiency, type Icc, type Sufficiency } from '../research/stats';
import type { LearningSeries } from './dataset';

export interface RetestOptions {
  /** Longest interval between test and retest, days (default 7, the Template C design). */
  maxDays: number;
  /** Also use pairs where practice between the sessions is unknown (no practice log). */
  includeUnknownPractice: boolean;
}

export const DEFAULT_RETEST: RetestOptions = { maxDays: 7, includeUnknownPractice: false };

export interface RetestPair {
  participantId: string;
  test: { sessionId: string; mean: number };
  retest: { sessionId: string; mean: number };
  days: number;
  practice: 'none_recorded' | 'unknown';
}

export interface RetestResult {
  exercise: string;
  side: string;
  metric: string;
  unit: string;
  pairs: RetestPair[];
  /** Pairs found but not used (practice recorded between, or unknown and not included). */
  skipped: { practiceRecorded: number; practiceUnknown: number; tooFarApart: number };
  icc: Icc | null;
  sufficiency: Sufficiency;
}

/** One test–retest pair per participant, task and metric (the first qualifying one). */
export function retestPairs(series: LearningSeries, o: RetestOptions = DEFAULT_RETEST): { pair: RetestPair | null; reason: 'practice_recorded' | 'practice_unknown' | 'too_far_apart' | 'no_pair' | null } {
  const inc = series.sessions.filter((s) => s.included);
  let reason: 'practice_recorded' | 'practice_unknown' | 'too_far_apart' | 'no_pair' = 'no_pair';
  for (let k = 1; k < inc.length; k++) {
    const a = inc[k - 1]!;
    const b = inc[k]!;
    const days = b.day - a.day;
    if (days > o.maxDays) {
      reason = 'too_far_apart';
      continue;
    }
    const practice = b.doseBefore === null ? 'unknown' : (b.doseBefore ?? 0) > 0 || (b.practiceCountBefore ?? 0) > 0 ? 'recorded' : 'none_recorded';
    if (practice === 'recorded') {
      reason = 'practice_recorded';
      continue;
    }
    if (practice === 'unknown' && !o.includeUnknownPractice) {
      reason = 'practice_unknown';
      continue;
    }
    return { pair: { participantId: series.participantId, test: { sessionId: a.sessionId, mean: a.mean }, retest: { sessionId: b.sessionId, mean: b.mean }, days, practice }, reason: null };
  }
  return { pair: null, reason };
}

/** Reliability per (exercise, side, metric) across participants. */
export function retestReliability(allSeries: readonly LearningSeries[], o: RetestOptions = DEFAULT_RETEST): RetestResult[] {
  const groups = new Map<string, LearningSeries[]>();
  for (const s of allSeries) {
    const k = `${s.exercise}|${s.side}|${s.metric}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: RetestResult[] = [];
  for (const [k, list] of groups) {
    const [exercise, side, metric] = k.split('|') as [string, string, string];
    const pairs: RetestPair[] = [];
    const skipped = { practiceRecorded: 0, practiceUnknown: 0, tooFarApart: 0 };
    for (const s of list) {
      const r = retestPairs(s, o);
      if (r.pair) pairs.push(r.pair);
      else if (r.reason === 'practice_recorded') skipped.practiceRecorded += 1;
      else if (r.reason === 'practice_unknown') skipped.practiceUnknown += 1;
      else if (r.reason === 'too_far_apart') skipped.tooFarApart += 1;
    }
    out.push({
      exercise,
      side,
      metric,
      unit: list[0]?.unit ?? '',
      pairs,
      skipped,
      icc: pairs.length >= 2 ? icc(pairs.map((p) => [p.test.mean, p.retest.mean])) : null,
      sufficiency: sufficiency(pairs.length, 'icc'),
    });
  }
  return out.sort((a, b) => `${a.exercise}${a.side}${a.metric}`.localeCompare(`${b.exercise}${b.side}${b.metric}`));
}
