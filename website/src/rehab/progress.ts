// Adaptive Progress Engine — transparent analytical observations for PROFESSIONAL REVIEW.
//
// What it does: reads the participant's data and produces observations ("measurements are becoming
// more consistent", "several assigned sessions were not reported as completed", "a review may be
// appropriate"). Each observation names its rule, rule version, the exact records it was derived from
// and the numbers it used.
//
// What it never does: diagnose, prescribe, change a program, a goal, a dose, a frequency, a difficulty
// or a duration. Its output type has no field that could carry such an action; a test checks that.
// Observations are descriptions of data, worded neutrally ("differs from baseline", never "improved").

import type { Note, Session } from '../data/models';
import { goalsNeedingReview } from './goals';
import type { Evidence, FunctionalGoal, IncidentRecord, ObservationCategory, ObservationSnapshot, OutcomeAssessment, PracticeRecord, ProgramReview, ProgramVersion, RehabProfile } from './model';
import { compareToBaseline, movementSeries, trendPerWeek, unusualRepetitions, usable, type Series } from './movement';
import { plannedHomeOccasions } from './programs';

export const PROGRESS_ALGORITHM = 'nm-progress 1.0';

export type Observation = ObservationSnapshot;

export interface RuleDoc {
  id: string;
  version: number;
  category: ObservationCategory;
  severity: 'info' | 'review';
  /** What triggers it, with every threshold. */
  logic: string;
  /** What it must NOT be read as. */
  notMeaning: string;
}

export const WINDOW_DAYS = 14;

/** Public documentation of every rule (shown in the app and in the architecture document). */
export const RULES: RuleDoc[] = [
  { id: 'safety_unreviewed', version: 1, category: 'safety', severity: 'review', logic: 'Any safety incident (pain, discomfort, unusual response, fall, stopped session) without a professional review.', notMeaning: 'Not a clinical judgement of the event; it only says nobody has reviewed it yet.' },
  { id: 'data_quality_latest', version: 1, category: 'data_quality', severity: 'info', logic: `Latest sensor session has a step with signal < 90 %, < 3 repetitions, saturation, data gap, lost sensor, flipped mount or moved calibration.`, notMeaning: 'Not a statement about the child; the session cannot be compared reliably.' },
  { id: 'assigned_not_completed', version: 1, category: 'adherence', severity: 'info', logic: `Last ${WINDOW_DAYS} days: professional-planned home occasions (Σ frequency/week × weeks) ≥ 2 and reports of completed/partial < 50 % of planned, or ≥ 2 reports "not completed"/"stopped".`, notMeaning: 'Not a judgement of the family. Missing reports are not proof that practice did not happen.' },
  { id: 'reported_fatigue_discomfort', version: 1, category: 'reported', severity: 'review', logic: `Last ${WINDOW_DAYS} days: ≥ 2 reports with fatigue "moderate" or "a lot", any discomfort, or a stopped session.`, notMeaning: 'Caregiver/child report, not a measurement. Never a reason to push through.' },
  { id: 'repeated_barrier', version: 1, category: 'reported', severity: 'info', logic: `Last ${WINDOW_DAYS} days: the same barrier reported ≥ 2 times.`, notMeaning: 'Context for the conversation with the family.' },
  { id: 'consistency_trend', version: 1, category: 'measurement', severity: 'info', logic: 'Last ≤ 6 usable sessions of one movement (≥ 3): ROM CV trend per week; reported when the last CV is ≥ 3 percentage points lower (or higher) than the first in the window and the trend has the same sign.', notMeaning: 'Consistency of an IMU angle across repetitions, not motor control or function.' },
  { id: 'range_vs_baseline', version: 1, category: 'measurement', severity: 'info', logic: 'Median ROM of the latest usable session differs from the individual baseline by more than 2 × SE of the difference of repetition means.', notMeaning: 'A measured angle difference. Does not imply a change in daily function, and the noise check is not a validated MDC.' },
  { id: 'unusual_repetitions', version: 1, category: 'measurement', severity: 'info', logic: 'Latest usable session: repetitions whose ROM is further than 3 × scaled MAD from the step median (≥ 4 repetitions).', notMeaning: 'Could be effort, attention, a sensor slip or a different movement; look at the trace.' },
  { id: 'baseline_not_designated', version: 1, category: 'measurement', severity: 'info', logic: 'Usable sensor sessions exist but no baseline session was designated; comparisons use the first usable session provisionally.', notMeaning: 'Bookkeeping only.' },
  { id: 'goal_reassessment', version: 1, category: 'goal', severity: 'review', logic: 'Goal marked "needs review", review date passed, or no history entry for 56 days (goals not achieved/paused).', notMeaning: 'Not a statement about progress towards the goal.' },
  { id: 'imu_goal_without_measurement', version: 1, category: 'goal', severity: 'info', logic: 'Goal measured with the IMU (by the professional\'s choice) has no usable session of that movement since the goal was created.', notMeaning: 'Missing data only.' },
  { id: 'review_due', version: 1, category: 'schedule', severity: 'review', logic: 'Active program and: its review date or a checkpoint has passed since the last progress review, or no progress review for 56 days.', notMeaning: 'A scheduling reminder; the professional decides whether anything changes.' },
  { id: 'assessment_interval', version: 1, category: 'schedule', severity: 'info', logic: 'Active program and the last instrument-based assessment is older than 16 weeks (or none recorded).', notMeaning: 'The professional selects whether and which instrument is appropriate.' },
];

const RULE = new Map(RULES.map((r) => [r.id, r]));

export interface ProgressInput {
  participantId: string;
  now: Date;
  demo: boolean;
  profile: RehabProfile | null;
  goals: readonly FunctionalGoal[];
  program: ProgramVersion | null;
  practice: readonly PracticeRecord[];
  incidents: readonly IncidentRecord[];
  reviews: readonly ProgramReview[];
  assessments: readonly OutcomeAssessment[];
  sessions: readonly Session[];
  notes?: readonly Note[];
}

function make(ruleId: string, subject: string, params: Record<string, string | number>, evidence: Evidence[]): Observation {
  const r = RULE.get(ruleId)!;
  return { id: `${ruleId}:${subject}`, ruleId, ruleVersion: r.version, category: r.category, severity: r.severity, params, evidence };
}

const DAY = 86400_000;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function lastProgressReview(reviews: readonly ProgramReview[]): ProgramReview | null {
  return [...reviews].filter((r) => r.type === 'progress_review').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Practice records and incidents no review has acknowledged yet. */
export function unreviewed<T extends { id: string }>(items: readonly T[], reviews: readonly ProgramReview[]): T[] {
  const ack = new Set(reviews.flatMap((r) => r.acknowledged));
  return items.filter((x) => !ack.has(x.id));
}

export function analyze(input: ProgressInput): Observation[] {
  const { now, demo } = input;
  const out: Observation[] = [];
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const inWindow = input.practice.filter((p) => Date.parse(p.date) >= since.getTime() && Date.parse(p.date) <= now.getTime());

  // 1. Safety first
  const openSafety = input.incidents.filter((i) => i.category === 'safety' && i.review === null);
  if (openSafety.length)
    out.push(
      make(
        'safety_unreviewed',
        openSafety.map((i) => i.id).sort().join(','),
        { count: openSafety.length },
        openSafety.map((i) => ({ ref: 'incident', id: i.id, label: i.type, value: i.occurredAt })),
      ),
    );

  // 2. Data quality of the latest sensor session
  const sessions = [...input.sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const series = movementSeries(sessions, { includeSimulated: demo });
  const latest = sessions.filter((s) => demo || !(s.demo || s.device.simulated || s.device.kind === 'simulator')).at(-1);
  if (latest) {
    const pts = series.flatMap((s) => s.points.filter((p) => p.sessionId === latest.id));
    const bad = pts.filter((p) => !usable(p, demo));
    if (bad.length) {
      const issues = [...new Set(bad.flatMap((p) => p.issues))].filter((i) => i !== 'simulated');
      if (issues.length)
        out.push(
          make('data_quality_latest', latest.id, { issues: issues.join(','), steps: bad.length, signal: round1(latest.quality.percent) }, [
            { ref: 'session', id: latest.id, label: 'signal', value: round1(latest.quality.percent), unit: '%' },
          ]),
        );
    }
  }

  // 3. Adherence against what the professional planned (never against an invented norm)
  const prog = input.program;
  if (prog && prog.def.status === 'active') {
    const start = prog.def.startDate ? new Date(Math.max(Date.parse(prog.def.startDate), since.getTime())) : since;
    const planned = plannedHomeOccasions(prog.def, start, now);
    const home = inWindow.filter((p) => p.setting === 'home' && p.completion !== null && p.programKey !== null && p.programKey.split('@')[0] === prog.seriesId);
    const done = home.filter((p) => p.completion === 'completed').length;
    const partial = home.filter((p) => p.completion === 'partial').length;
    const notDone = home.filter((p) => p.completion === 'not_completed' || p.completion === 'stopped');
    if ((planned !== null && planned >= 2 && done + partial < planned * 0.5) || notDone.length >= 2)
      out.push(
        make(
          'assigned_not_completed',
          `${prog.seriesId}:${since.toISOString().slice(0, 10)}`,
          { planned: planned ?? '—', completed: done, partial, notCompleted: notDone.length, unreported: planned === null ? '—' : Math.max(0, planned - home.length), days: WINDOW_DAYS },
          home.map((p) => ({ ref: 'practice' as const, id: p.id, label: p.completion ?? '', value: p.date })),
        ),
      );
  }

  // 4. Reported fatigue / discomfort / stopped sessions
  const strain = inWindow.filter((p) => (p.fatigue !== null && p.fatigue >= 2) || (p.discomfort !== null && p.discomfort !== 'none') || p.completion === 'stopped');
  if (strain.length >= 2)
    out.push(
      make(
        'reported_fatigue_discomfort',
        strain.map((p) => p.id).sort().join(',').slice(0, 150),
        { count: strain.length, days: WINDOW_DAYS },
        strain.map((p) => ({ ref: 'practice', id: p.id, label: [p.fatigue !== null && p.fatigue >= 2 ? `fatigue ${p.fatigue}` : '', p.discomfort && p.discomfort !== 'none' ? p.discomfort : '', p.completion === 'stopped' ? 'stopped' : ''].filter(Boolean).join(', '), value: p.date })),
      ),
    );

  // 5. Repeated barriers
  const barrierCount = new Map<string, PracticeRecord[]>();
  for (const p of inWindow) for (const b of p.barriers) barrierCount.set(b, [...(barrierCount.get(b) ?? []), p]);
  for (const [b, ps] of barrierCount)
    if (ps.length >= 2)
      out.push(make('repeated_barrier', b, { barrier: b, count: ps.length, days: WINDOW_DAYS }, ps.map((p) => ({ ref: 'practice', id: p.id, label: b, value: p.date }))));

  // 6–9. Movement measurements (IMU-derived)
  const designated = input.profile?.baselineSessionIds ?? [];
  let anyUsable = false;
  for (const s of series) {
    const pts = s.points.filter((p) => usable(p, demo));
    if (pts.length) anyUsable = true;
    consistency(s, demo, out);
    const cmp = compareToBaseline(s, 'rom', designated, demo);
    if (cmp && cmp.exceedsNoise)
      out.push(
        make(
          'range_vs_baseline',
          `${s.exercise}:${s.side}:${cmp.latest.sessionId}`,
          { exercise: s.exercise, side: s.side, direction: cmp.delta > 0 ? 'higher' : 'lower', delta: round1(cmp.delta), noise: round1(cmp.noise ?? 0), baseline: round1(cmp.baseline.value), latest: round1(cmp.latest.value), designated: cmp.baseline.designated ? 'yes' : 'no' },
          [
            ...cmp.baseline.sessionIds.map((id) => ({ ref: 'session' as const, id, label: 'baseline', value: round1(cmp.baseline.value), unit: '°' })),
            { ref: 'session', id: cmp.latest.sessionId, label: 'latest', value: round1(cmp.latest.value), unit: '°' },
          ],
        ),
      );
    const last = pts.at(-1);
    if (last && latest && last.sessionId === latest.id) {
      const odd = unusualRepetitions(last.reps.rom ?? []);
      if (odd.length)
        out.push(
          make('unusual_repetitions', `${s.exercise}:${s.side}:${last.sessionId}`, { exercise: s.exercise, side: s.side, count: odd.length, reps: odd.map((i) => i + 1).join(', '), total: (last.reps.rom ?? []).length }, [
            { ref: 'session', id: last.sessionId, label: 'repetitions', value: odd.map((i) => i + 1).join(', ') },
          ]),
        );
    }
  }
  if (anyUsable && designated.length === 0) out.push(make('baseline_not_designated', input.participantId, {}, []));

  // 10. Goals
  for (const { goal, reason } of goalsNeedingReview(input.goals, now))
    out.push(make('goal_reassessment', goal.id, { reason, goal: goal.description.slice(0, 120) }, [{ ref: 'goal', id: goal.id, label: reason, value: goal.reviewDate ?? '' }]));
  for (const g of input.goals) {
    if (g.measurement.kind !== 'imu' || !g.measurement.exercise || g.status === 'achieved' || g.status === 'paused') continue;
    const s = series.find((x) => x.exercise === g.measurement.exercise && (!g.measurement.side || x.side === g.measurement.side));
    const has = s?.points.some((p) => usable(p, demo) && p.date >= g.createdAt);
    if (!has) out.push(make('imu_goal_without_measurement', g.id, { goal: g.description.slice(0, 120), exercise: g.measurement.exercise }, [{ ref: 'goal', id: g.id, label: g.measurement.exercise }]));
  }

  // 11. Schedule
  if (prog && prog.def.status === 'active') {
    const lastReview = lastProgressReview(input.reviews);
    const lastAt = lastReview ? Date.parse(lastReview.createdAt) : Date.parse(prog.createdAt);
    const today = now.toISOString().slice(0, 10);
    const dueDates = [prog.def.reviewDate, ...prog.def.checkpoints.map((c) => c.date)].filter((d): d is string => !!d && d.slice(0, 10) <= today && Date.parse(d) > lastAt);
    const stale = now.getTime() - lastAt > 56 * DAY;
    if (dueDates.length || stale)
      out.push(make('review_due', `${prog.id}:${lastReview?.id ?? 'none'}`, { reason: dueDates.length ? 'date_passed' : 'no_recent_review', date: dueDates.sort()[0]?.slice(0, 10) ?? '' }, [{ ref: 'program', id: prog.id, label: prog.def.name }]));
    const lastAssessment = [...input.assessments].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastAssessment || now.getTime() - Date.parse(lastAssessment.date) > 16 * 7 * DAY)
      out.push(make('assessment_interval', `${prog.seriesId}:${lastAssessment?.id ?? 'none'}`, { last: lastAssessment?.date.slice(0, 10) ?? '' }, lastAssessment ? [{ ref: 'assessment', id: lastAssessment.id, label: lastAssessment.instrumentName, value: lastAssessment.date }] : []));
  }

  const rank = (o: Observation) => (o.category === 'safety' ? 0 : o.severity === 'review' ? 1 : o.category === 'data_quality' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

function consistency(s: Series, demo: boolean, out: Observation[]) {
  const pts = s.points.filter((p) => usable(p, demo) && p.values.rom_cv !== undefined).slice(-6);
  if (pts.length < 3) return;
  const tr = trendPerWeek({ ...s, points: pts }, 'rom_cv', demo, 6);
  if (!tr) return;
  const first = pts[0]!.values.rom_cv as number;
  const last = pts.at(-1)!.values.rom_cv as number;
  const change = last - first;
  if (Math.abs(change) < 3 || Math.sign(change) !== Math.sign(tr.slope)) return;
  out.push(
    make(
      'consistency_trend',
      `${s.exercise}:${s.side}:${pts.at(-1)!.sessionId}`,
      { exercise: s.exercise, side: s.side, direction: change < 0 ? 'more_consistent' : 'less_consistent', from: round1(first), to: round1(last), sessions: pts.length },
      pts.map((p) => ({ ref: 'session' as const, id: p.sessionId, label: 'CV', value: round1(p.values.rom_cv as number), unit: '%' })),
    ),
  );
}
