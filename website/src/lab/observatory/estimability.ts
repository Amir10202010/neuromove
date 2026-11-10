// What can be estimated from THIS dataset? The conceptual decomposition
//
//     observed movement = baseline state + practice response + retained learning + task effect
//                         + fatigue-like effect + measurement error
//
// is a framework, not a model that every dataset identifies. For each term this module states what observations
// support it, which are missing here, the assumptions it needs, and what would falsify the interpretation — and
// returns 'not_estimable' with the reason instead of a number when the data cannot carry it. Nothing is inferred
// from a design that does not contain it: no retention from a single session, no transfer without an untrained task,
// no forgetting from a regular schedule.

import type { SeriesAnalysis } from '../analysis';
import type { LearningSeries } from '../dataset';
import { ENVELOPE_RULE } from '../measure/envelope';
import { DETECTION_RULE } from './changeDetection';
import { WITHIN_RULE } from './withinSession';

export const LEARNING_TERMS = ['measurement_error', 'baseline_state', 'practice_response', 'fatigue_like_effect', 'between_session_change', 'retained_learning', 'forgetting', 'transfer', 'task_effect'] as const;
export type LearningTerm = (typeof LEARNING_TERMS)[number];

export interface TermEstimability {
  term: LearningTerm;
  status: 'estimable' | 'partly_estimable' | 'not_estimable';
  /** Observations in this dataset that support the term. */
  supportedBy: string[];
  /** What is missing for the term (empty when estimable). */
  missing: string[];
  assumptions: string[];
  /** Evidence that would show the interpretation to be wrong. */
  falsifiedBy: string;
  /** Where the estimate is computed when it is estimable. */
  source: string;
}

export interface EstimabilityInput {
  series: LearningSeries;
  analysis: SeriesAnalysis | null;
  /** Valid repetitions of each stored practice sitting of this task (child-mode practice with trial recording). */
  practiceSittings: readonly number[];
  /** A practice log exists for the participant (dose between sessions is known, not assumed). */
  practiceLog: boolean;
  /** Task keys (`exercise:side`) the frozen protocol designates as untrained transfer tasks. */
  transferTasks: readonly string[];
  /** Sessions the protocol designates as retention tests. */
  retentionSessionIds: readonly string[];
  /** Number of sessions in which ≥ 2 task conditions were each recorded (tasks/library.ts conditionKey). */
  sessionsWithSeveralConditions: number;
  /** A test–retest reliability estimate (MDC) is available for this metric. */
  externalMdc: boolean;
  /** Raw 100 Hz frames are stored for at least one included session (sensor uncertainty can be propagated). */
  rawAvailable: boolean;
}

export function assessEstimability(i: EstimabilityInput): TermEstimability[] {
  const inc = i.series.sessions.filter((s) => s.included);
  const K = inc.length;
  const withReps = inc.filter((s) => s.n >= 2).length;
  const longSessions = inc.filter((s) => s.n >= WITHIN_RULE.minTrend).length + i.practiceSittings.filter((n) => n >= WITHIN_RULE.minTrend).length;
  const veryLong = inc.filter((s) => s.n >= WITHIN_RULE.minBreak).length + i.practiceSittings.filter((n) => n >= WITHIN_RULE.minBreak).length;
  const taskKey = `${i.series.exercise}:${i.series.side}`;
  const retention = i.analysis?.decomposition.retention ?? [];
  const tests = retention.filter((r) => r.kind === 'retention_test');
  const out: TermEstimability[] = [];
  const add = (t: Omit<TermEstimability, 'status'> & { status?: TermEstimability['status'] }) => out.push({ ...t, status: t.status ?? (t.missing.length ? 'not_estimable' : 'estimable') });

  // measurement error
  {
    const supportedBy: string[] = [];
    const missing: string[] = [];
    if (withReps > 0) supportedBy.push(`repetition SD from ${withReps} sessions with ≥ 2 repetitions`);
    else missing.push('a session with at least 2 repetitions (repetition noise)');
    if (K >= 3) supportedBy.push(`day-to-day SD from ${K} sessions`);
    else missing.push('at least 3 sessions (day-to-day variation)');
    if (i.rawAvailable) supportedBy.push('raw frames: sensor uncertainty can be propagated');
    if (i.externalMdc) supportedBy.push('test–retest MDC for this metric');
    add({
      term: 'measurement_error', supportedBy, missing,
      status: !missing.length ? (i.externalMdc ? 'estimable' : 'partly_estimable') : withReps > 0 || K >= 3 ? 'partly_estimable' : 'not_estimable',
      assumptions: ['repetition and day-to-day deviations are independent and roughly normal', 'day-to-day variation includes re-attachment and calibration posture — it is not separated from the child\'s own variation without a re-donning study'],
      falsifiedBy: 'a stable-condition test–retest study giving a different SEM; autocorrelated day-to-day deviations',
      source: 'lab/models.ts (σε, σs), lab/measure/uncertainty.ts, lab/measure/retest.ts',
    });
  }
  // baseline
  {
    const firstDose = inc.findIndex((s, k) => k > 0 && ((s.doseBefore ?? 0) > 0 || (s.practiceCountBefore ?? 0) > 0));
    const pre = firstDose < 0 ? K : firstDose;
    const missing: string[] = [];
    if (K < ENVELOPE_RULE.minSessions) missing.push(`at least ${ENVELOPE_RULE.minSessions} sessions`);
    const partly = K >= ENVELOPE_RULE.minSessions && (!i.practiceLog || pre < ENVELOPE_RULE.minSessions);
    add({
      term: 'baseline_state', missing,
      supportedBy: K ? [`${K} included sessions${i.practiceLog ? `, ${pre} before any recorded practice` : ''}`] : [],
      status: missing.length ? 'not_estimable' : partly ? 'partly_estimable' : 'estimable',
      assumptions: ['the baseline sessions were recorded under stable conditions', ...(i.practiceLog ? [] : ['no practice log: it is ASSUMED that nothing changed between the baseline sessions']), 'the first session may contain familiarisation with the test'],
      falsifiedBy: 'a trend across the baseline sessions (measure/envelope.ts reports it); a first session that differs from the following ones',
      source: 'lab/measure/envelope.ts',
    });
  }
  // practice response (within a sitting)
  add({
    term: 'practice_response',
    supportedBy: longSessions ? [`${longSessions} sitting(s) with ≥ ${WITHIN_RULE.minTrend} repetitions`] : [],
    missing: longSessions ? [] : [`a sitting with at least ${WITHIN_RULE.minTrend} repetitions (assessment steps have 3: within-session change needs practice sittings with trial recording)`],
    assumptions: ['a change across the repetitions of one sitting is performance during practice — NOT learning', 'repetition order is the only time variable (rest intervals are not modelled)'],
    falsifiedBy: 'the same pattern without practice (e.g. warm-up alone); a pattern that reverses within the sitting',
    source: 'lab/observatory/withinSession.ts, lab/learning.ts (within-session slope)',
  });
  // fatigue-like
  add({
    term: 'fatigue_like_effect',
    supportedBy: veryLong ? [`${veryLong} sitting(s) with ≥ ${WITHIN_RULE.minBreak} repetitions`] : [],
    missing: [...(veryLong ? [] : [`a sitting with at least ${WITHIN_RULE.minBreak} repetitions`]), 'a record of perceived fatigue or effort (not collected): a decline-like pattern cannot be attributed to fatigue'],
    status: veryLong ? 'partly_estimable' : 'not_estimable',
    assumptions: ['a decline in amplitude and speed with longer, less smooth repetitions is CALLED decline-like; attention, discomfort and boredom produce the same pattern'],
    falsifiedBy: 'no recovery of performance after rest; the same decline at the very start of a sitting',
    source: 'lab/observatory/withinSession.ts',
  });
  // between-session change
  {
    const missing: string[] = [];
    if (K < DETECTION_RULE.minSessions) missing.push(`at least ${DETECTION_RULE.minSessions} sessions (two to learn the level and spread, two to monitor)`);
    add({
      term: 'between_session_change', missing,
      supportedBy: K >= DETECTION_RULE.minSessions ? [`${K} sessions over ${Math.round((inc[K - 1]?.day ?? 0) - (inc[0]?.day ?? 0))} days`] : [],
      status: missing.length ? 'not_estimable' : K < 8 ? 'partly_estimable' : 'estimable',
      assumptions: ['same task condition, protocol and algorithm version in every session', 'a change beyond day-to-day variation is a change of the MEASURED metric: its cause (practice, growth, medication, placement protocol) is not identified'],
      falsifiedBy: 'a change of sensor placement protocol, operator or task condition at the same time; an independent measurement that does not change',
      source: 'lab/fit.ts (model comparison), lab/observatory/changeDetection.ts',
    });
  }
  // retained learning
  {
    const missing: string[] = [];
    if (!i.retentionSessionIds.length) missing.push('a session the protocol designates as a retention test');
    if (!i.practiceLog) missing.push('a practice log showing no practice in the delay');
    if (i.retentionSessionIds.length && i.practiceLog && !tests.length) missing.push('a designated retention session after a delay with no practice recorded');
    const gain = tests.some((r) => r.retentionRatio !== null);
    if (tests.length && !gain) missing.push('a gain before the delay that exceeds twice its standard error (there is nothing demonstrable to retain)');
    add({
      term: 'retained_learning', missing,
      supportedBy: tests.length ? [`${tests.length} designated retention test(s) without recorded practice in the delay`] : retention.length ? [`${retention.length} delayed observation(s) — NOT retention tests`] : [],
      assumptions: ['no practice of the task in the delay (from the practice log: reported, not observed)', 'the same measurement conditions before and after the delay'],
      falsifiedBy: 'practice during the delay; a return to baseline at the retention test; a change equally large in an untrained control task',
      source: 'lab/learning.ts (retention), lab/analysis.ts',
    });
  }
  // forgetting
  {
    const ev = i.analysis?.retention;
    const missing: string[] = [];
    if (!ev || ev.status === 'not_assessable') missing.push('at least 5 sessions with a fitted dose model');
    else if (ev.status === 'confounded_by_schedule') missing.push('breaks of different length or a varying dose: on a regular schedule forgetting cannot be told from saturation');
    else if (ev.status === 'not_distinguishable') missing.push('data that favour the forgetting model over the saturation model (ΔAICc > 2)');
    if (!i.practiceLog) missing.push('a practice log (the dose is otherwise an assumption)');
    add({
      term: 'forgetting', missing,
      supportedBy: ev && (ev.status === 'supported' || ev.status === 'relative_only') ? [`learning–retention model preferred over saturation by ΔAICc ${ev.deltaAicc?.toFixed(1)}`] : [],
      status: ev?.status === 'supported' && i.practiceLog ? 'estimable' : ev?.status === 'relative_only' ? 'partly_estimable' : 'not_estimable',
      assumptions: ['single-rate exponential forgetting towards the baseline', 'dose spread evenly over each interval'],
      falsifiedBy: 'retention after a long break as good as after a short one; a saturation curve that fits equally well',
      source: 'lab/models.ts (learning_retention), lab/analysis.ts (forgetting vs saturation)',
    });
  }
  // transfer
  {
    const designated = i.transferTasks.includes(taskKey);
    const missing: string[] = [];
    if (!i.transferTasks.length) missing.push('a protocol that designates an untrained transfer task');
    else if (!designated) missing.push('this task is a trained task: transfer is assessed on the designated transfer task');
    if (designated && K < 2) missing.push('at least two observations of the transfer task');
    add({
      term: 'transfer', missing,
      supportedBy: designated && K >= 2 ? [`${K} observations of a designated transfer task`] : [],
      assumptions: ['the transfer task was not practised (protocol and practice log)', 'a change in the transfer task is not general (maturation, familiarisation with the device)'],
      falsifiedBy: 'practice of the transfer task; an equal change in a task unrelated to the trained one',
      source: 'lab/learning.ts (transfer), lab/observatory/transfer.ts',
    });
  }
  // task effect
  add({
    term: 'task_effect',
    supportedBy: i.sessionsWithSeveralConditions ? [`${i.sessionsWithSeveralConditions} session(s) with two or more task conditions`] : [],
    missing: i.sessionsWithSeveralConditions ? [] : ['two or more task conditions recorded within the same session (conditions in separate sessions are confounded with re-attachment)'],
    assumptions: ['conditions differ only in the declared constraint', 'order of conditions balanced or randomised'],
    falsifiedBy: 'the same difference when the order of conditions is reversed is absent',
    source: 'lab/coord/flexibility.ts, lab/tasks/library.ts',
  });
  return out;
}
