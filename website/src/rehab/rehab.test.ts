// Functional Progression System — domain rules (pure functions, synthetic data).
// Acceptance criteria covered: goals, program versions, assignment, home completion, caregiver
// observations, baseline/follow-up comparison, progress suggestions, professional decision,
// pseudonymised export, permissions, no automatic progression, no fake measurement, history intact.

import { describe, expect, it } from 'vitest';
import { editGoal, familyInput, gasTScore, goalsNeedingReview, newGoal, setGoalStatus, type GoalDraft } from './goals';
import type { ActivityDef, ActivityVersion, ProgramVersion, RehabRecord } from './model';
import { METRICS, METRIC_ORDER, compareToBaseline, measureSession, movementSeries, unusualRepetitions } from './movement';
import { canWriteRehab, caregiverMayRead, type Actor } from './policy';
import { PROGRESS_ALGORITHM, RULES, analyze, type ProgressInput } from './progress';
import { checkProgram, currentProgram, diffPrograms, emptyProgram, newActivityVersion, newAssignment, newProgramVersion, plannedHomeOccasions } from './programs';
import { checkSave } from './store';
import { buildStudyDataset, enrolmentProblems, studyReport, studyReportMarkdown, tableCsv } from './study';
import { syntheticSession } from './testing';
import { buildTimeline } from './timeline';
import { checkTransition, validRehabRecord } from './validate';
import { acknowledge, newConsent, newProfile, newStudy, recordReview, reportPractice, reviewIncident, withdrawConsent } from './workflows';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86400_000);
const PRO: Actor = { role: 'session_operator', name: 'Dr A', participantIds: [] };
const CARE: Actor = { role: 'caregiver', name: 'Mother of P1', participantIds: ['p1'] };
const TITLES = { assessment: 'A — Initial assessment', supervised: 'B — Supervised practice', home: 'C — Home practice', review: 'D — Progress review', reassessment: 'E — Reassessment' };

const draft: GoalDraft = {
  category: 'reaching',
  description: 'Reach for a cup on the table with the right hand',
  whyItMatters: 'Wants to drink without help at breakfast',
  baseline: 'Reaches 10 cm with trunk lean',
  target: 'Reaches the cup at 25 cm while seated, 3 of 4 tries',
  measurement: { kind: 'gas', detail: 'GAS levels defined with family', exercise: null, side: null },
  responsible: 'Dr A',
  reviewDate: '2026-12-06',
  contributors: ['professional', 'family'],
};

const actDef = (over: Partial<ActivityDef> = {}): ActivityDef => ({
  name: 'Reach to cup',
  description: 'Seated reaching to a cup',
  goalCategories: ['reaching'],
  domain: 'reaching',
  setup: 'Chair, table, plastic cup',
  professionalInstructions: 'Adjust distance to the child',
  caregiverInstructions: 'Sit together at the table. Put the cup where the therapist showed you.',
  steps: [{ icon: 'sit', text: 'Sit straight' }, { icon: 'cup', text: 'Reach for the cup' }],
  homeSuitable: true,
  measurement: { kind: 'completion_only', exercise: null, detail: '' },
  completionCriteria: 'As many calm reaches as the child wants, stop when tired',
  safetyNotes: 'Stop if pain',
  evidenceRefs: ['Jackman 2022 doi:10.1111/dmcn.15055'],
  language: 'en',
  ...over,
});

function activity(status: ActivityVersion['status'] = 'clinician_approved'): ActivityVersion {
  return newActivityVersion([], { def: actDef(), status, changeNote: 'first', workspace: 'clinic', author: 'Dr A', authorRole: 'professional' }, NOW)!;
}

function program(act: ActivityVersion, goalId: string, freq = 3): ProgramVersion {
  const def = emptyProgram('Dr A', TITLES);
  def.name = 'Reaching block 1';
  def.goalIds = [goalId];
  def.startDate = day(-21).toISOString();
  def.reviewDate = day(7).toISOString();
  const a = newAssignment(act.id, 'home');
  a.frequencyPerWeek = freq;
  a.goalIds = [goalId];
  def.modules.find((m) => m.type === 'home')!.assignments.push(a);
  return newProgramVersion([], { def, participantId: 'p1', template: false, changeReason: '', basedOnReviewId: null, workspace: 'clinic', author: 'Dr A' }, day(-21))!;
}

describe('1–2. participant profile and functional goals', () => {
  it('profile is valid and minimal (no names, no classification made by software)', () => {
    const p = newProfile('p1', 'clinic', 'Dr A', NOW);
    expect(validRehabRecord(p)).toBe(true);
    expect(p.classifications).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/name|iin|birth/i);
  });

  it('goal: created with history; edits and status changes append, never rewrite', () => {
    const g = newGoal('p1', draft, 'clinic', 'Dr A', NOW);
    expect(validRehabRecord(g)).toBe(true);
    expect(g.status).toBe('not_started');
    const g2 = setGoalStatus(g, 'in_progress', 'Dr A', 'started block', day(1))!;
    const g3 = editGoal(g2, { ...draft, target: 'Reaches at 30 cm' }, 'Dr A', '', day(2))!;
    expect(g3.history.map((e) => e.type)).toEqual(['created', 'status', 'edited']);
    expect(g3.history[2]!.fields).toEqual(['target']);
    expect(checkTransition(g, g3)).toBeNull();
    // Rewriting history is refused, on the device and (same function) on the server
    const forged = { ...g3, history: g3.history.slice(1) };
    expect(checkTransition(g3, forged)).toBe('history_rewritten');
  });

  it('families contribute through family_input only; they cannot set status or targets', () => {
    const g = newGoal('p1', draft, 'clinic', 'Dr A', NOW);
    const withInput = familyInput(g, 'Mother of P1', 'She tries this every morning', day(1));
    expect(canWriteRehab(CARE, withInput, g)).toBeNull();
    expect(withInput.contributors).toContain('family');
    const achieved = setGoalStatus(g, 'achieved', 'Mother of P1', '', day(1))!;
    expect(canWriteRehab(CARE, achieved, g)).toBe('caregiver_scope');
    expect(canWriteRehab(CARE, { ...withInput, target: 'easier' }, g)).toBe('caregiver_scope');
    // Not linked to this child → nothing
    expect(canWriteRehab({ ...CARE, participantIds: ['p2'] }, withInput, g)).toBe('not_linked');
  });

  it('goals needing reassessment: review date passed or stale', () => {
    const g = newGoal('p1', { ...draft, reviewDate: '2026-11-01' }, 'clinic', 'Dr A', day(-10));
    expect(goalsNeedingReview([g], NOW).map((x) => x.reason)).toEqual(['review_date_passed']);
  });

  it('GAS T-score follows Kiresuk–Sherman (all goals at 0 → 50; equal weights)', () => {
    expect(gasTScore([{ value: 0, weight: null }, { value: 0, weight: null }])).toBe(50);
    // one goal at +1: 50 + 10·1/√(0.7·1 + 0.3·1) = 60
    expect(gasTScore([{ value: 1, weight: null }])).toBeCloseTo(60, 6);
    expect(gasTScore([{ value: null, weight: null }])).toBeNull();
  });
});

describe('3–5. activities, program versions, assignment', () => {
  it('activity versions are immutable; drafts are not assignable', () => {
    const v1 = activity('draft');
    const v2 = newActivityVersion([v1], { seriesId: v1.seriesId, def: v1.def, status: 'clinician_approved', changeNote: 'approved', workspace: 'clinic', author: 'Dr A', authorRole: 'professional' }, day(1))!;
    expect(v2.id).toBe(`${v1.seriesId}@2`);
    expect(checkTransition(v1, { ...v1, status: 'clinician_approved' })).toBe('immutable');
    const def = emptyProgram('Dr A', TITLES);
    def.name = 'x';
    def.modules[2]!.assignments.push(newAssignment(v1.id, 'home'));
    expect(checkProgram(def, [v1], [], { version: 1, changeReason: '' })).toContain('draft_activity');
    def.modules[2]!.assignments[0]!.activityKey = v2.id;
    expect(checkProgram(def, [v1, v2], [], { version: 1, changeReason: '' })).toEqual([]);
  });

  it('saving a program edit creates a new version with a reason; v1 stays intact', () => {
    const act = activity();
    const g = newGoal('p1', draft, 'clinic', 'Dr A', NOW);
    const v1 = program(act, g.id);
    expect(validRehabRecord(v1)).toBe(true);
    const def2 = structuredClone(v1.def);
    def2.modules.find((m) => m.type === 'home')!.assignments[0]!.frequencyPerWeek = 2;
    expect(checkProgram(def2, [act], [g.id], { version: 2, changeReason: '' })).toContain('reason_required');
    const v2 = newProgramVersion([v1], { seriesId: v1.seriesId, def: def2, participantId: 'p1', template: false, changeReason: 'Family asked for fewer sessions', basedOnReviewId: 'rev_1', workspace: 'clinic', author: 'Dr A' }, NOW)!;
    expect(v2.version).toBe(2);
    expect(v2.previousKey).toBe(v1.id);
    expect(v1.def.modules.find((m) => m.type === 'home')!.assignments[0]!.frequencyPerWeek).toBe(3); // untouched
    expect(diffPrograms(v1.def, v2.def)).toEqual([{ kind: 'assignment_changed', key: act.id }]);
    expect(currentProgram([v1, v2], 'p1')?.id).toBe(v2.id);
    expect(newProgramVersion([v1, v2], { seriesId: v1.seriesId, def: def2, participantId: 'p1', template: false, changeReason: 'same', basedOnReviewId: null, workspace: 'clinic', author: 'Dr A' })).toBeNull();
    expect(checkTransition(v1, { ...v1, def: def2 })).toBe('immutable');
  });

  it('planned home occasions come only from professional-entered frequencies', () => {
    const p = program(activity(), 'g1', 3);
    expect(plannedHomeOccasions(p.def, day(-14), NOW)).toBe(6);
    const none = structuredClone(p.def);
    none.modules.forEach((m) => m.assignments.forEach((a) => (a.frequencyPerWeek = null)));
    expect(plannedHomeOccasions(none, day(-14), NOW)).toBeNull();
  });
});

describe('6–7. home completion and caregiver observations', () => {
  it('a caregiver report is reported data, never a measurement; pain opens a safety incident', () => {
    const { practice, incidents } = reportPractice(
      { participantId: 'p1', programKey: 'prg_1@1', assignmentId: 'as_1', activityKey: 'act_1@1', setting: 'home', source: 'caregiver_report', completion: 'partial', difficulty: true, breakRequested: true, fatigue: 2, discomfort: 'pain', barriers: ['child_tired'], durationMin: 10, observation: 'Said her shoulder hurt' },
      'clinic',
      'Mother of P1',
      'caregiver',
      NOW,
    );
    expect(practice.sensorSessionId).toBeNull();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ category: 'safety', type: 'pain', relatedPracticeId: practice.id, review: null });
    expect(checkSave([practice, ...incidents], CARE, [])).toMatchObject({ ok: true });
    // A caregiver can never attach a sensor session (no report shown as measured data)
    const fake = { ...practice, sensorSessionId: 's_1' };
    expect(validRehabRecord(fake)).toBe(false);
    // Reports are immutable; the caregiver cannot edit or "review" them later
    expect(checkSave([{ ...practice, observation: 'changed' }], CARE, [practice])).toMatchObject({ ok: false });
    expect(canWriteRehab(CARE, reviewIncident(incidents[0]!, 'Mother', 'ok', ''), incidents[0]!)).toBe('caregiver_scope');
  });

  it('not completed is a neutral answer: no incident, no penalty record', () => {
    const { incidents } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'not_completed', difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: ['time'], durationMin: null, observation: '' }, 'clinic', 'M', 'caregiver', NOW);
    expect(incidents).toEqual([]);
  });

  it('an incident gains a professional review once and then never changes', () => {
    const { incidents } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'stopped', difficulty: false, breakRequested: true, fatigue: 3, discomfort: 'some', barriers: [], durationMin: 3, observation: 'Cried, we stopped' }, 'clinic', 'M', 'caregiver', NOW);
    const inc = incidents[0]!;
    const reviewed = reviewIncident(inc, 'Dr A', 'Called family; reduce reach distance at next visit', 'Check at visit', day(1));
    expect(checkTransition(inc, reviewed)).toBeNull();
    expect(checkTransition(reviewed, { ...reviewed, review: { ...reviewed.review!, outcome: 'edited' } })).toBe('incident_changed');
    expect(checkTransition(inc, { ...reviewed, description: 'rewritten' })).toBe('incident_changed');
  });
});

describe('10–11. timeline and baseline / follow-up', () => {
  const sessions = [
    syntheticSession('s1', 'p1', day(-20).toISOString(), [80, 82, 81, 79, 80]),
    syntheticSession('s2', 'p1', day(-10).toISOString(), [88, 90, 89, 91, 90]),
    syntheticSession('s3', 'p1', day(-1).toISOString(), [95, 96, 94, 95, 96]),
  ];

  it('every metric is documented with definition, unit, validation status; none claims clinical validation', () => {
    for (const k of METRIC_ORDER) {
      const m = METRICS[k];
      expect(m.definition.length).toBeGreaterThan(10);
      expect(m.limitations.length).toBeGreaterThan(5);
      expect(['software_verified', 'experimental']).toContain(m.validation);
      expect(JSON.stringify(m)).not.toMatch(/clinically validated"/);
    }
  });

  it('extracts range, dynamics and quality per step from the stored trace', () => {
    const [m] = measureSession(sessions[0]!);
    expect(m!.values.rom).toBe(80);
    expect(m!.values.rep_count).toBe(5);
    expect(m!.values.min_angle).toBeCloseTo(10, 0);
    expect(m!.values.excursion).toBeCloseTo(70, 0);
    expect(m!.values.time_to_peak).toBeCloseTo(1.5, 1);
    expect(m!.eligible).toBe(true);
  });

  it('baseline comparison uses the designated baseline and a data-driven noise check', () => {
    const [series] = movementSeries(sessions, { includeSimulated: false });
    const provisional = compareToBaseline(series!, 'rom', [], false)!;
    expect(provisional.baseline.designated).toBe(false);
    expect(provisional.baseline.sessionIds).toEqual(['s1']);
    const designated = compareToBaseline(series!, 'rom', ['s2'], false)!;
    expect(designated.baseline.designated).toBe(true);
    expect(designated.delta).toBe(5);
    expect(designated.exceedsNoise).toBe(true);
  });

  it('simulated or poor-quality sessions are never used as real measurements', () => {
    const sim = syntheticSession('sim', 'p1', NOW.toISOString(), [150, 150, 150], { simulated: true });
    expect(movementSeries([sim], { includeSimulated: false })).toEqual([]);
    const poor = syntheticSession('poor', 'p1', NOW.toISOString(), [100, 100, 100], { signal: 70 });
    expect(measureSession(poor)[0]!.eligible).toBe(false);
    expect(measureSession(poor)[0]!.issues).toContain('low_signal');
  });

  it('timeline keeps instrument, IMU, reported and professional sources apart', () => {
    const { practice } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'completed', difficulty: false, breakRequested: false, fatigue: 0, discomfort: 'none', barriers: [], durationMin: 10, observation: '' }, 'clinic', 'M', 'caregiver', NOW);
    const tl = buildTimeline({ sessions, practice: [practice], assessments: [], reviews: [], programs: [], goals: [], incidents: [], notes: [] });
    expect(tl[0]!.source).toBe('reported');
    expect(tl[0]!.facts.measured).toBe(false);
    expect(tl.filter((e) => e.source === 'imu')).toHaveLength(3);
  });

  it('unusual repetitions: MAD rule', () => {
    expect(unusualRepetitions([90, 91, 89, 90, 60])).toEqual([4]);
    expect(unusualRepetitions([90, 91, 89])).toEqual([]);
  });
});

describe('12–13. progress engine and professional review', () => {
  const act = activity();
  const goal = newGoal('p1', draft, 'clinic', 'Dr A', day(-30));
  const prog = program(act, goal.id, 3);
  const rep = (d: number, completion: 'completed' | 'not_completed' | 'stopped', fatigue: 0 | 2 = 0) =>
    reportPractice({ participantId: 'p1', programKey: prog.id, assignmentId: null, activityKey: act.id, setting: 'home', source: 'caregiver_report', completion, difficulty: false, breakRequested: false, fatigue, discomfort: 'none', barriers: completion === 'completed' ? [] : ['child_tired'], durationMin: 10, observation: '' }, 'clinic', 'M', 'caregiver', day(d)).practice;
  const input = (): ProgressInput => ({
    participantId: 'p1',
    now: NOW,
    demo: false,
    profile: newProfile('p1', 'clinic', 'Dr A', day(-30)),
    goals: [goal],
    program: prog,
    practice: [rep(-12, 'completed'), rep(-9, 'not_completed', 2), rep(-5, 'stopped', 2)],
    incidents: [],
    reviews: [],
    assessments: [],
    sessions: [
      syntheticSession('s1', 'p1', day(-20).toISOString(), [80, 90, 70, 85, 75]),
      syntheticSession('s2', 'p1', day(-10).toISOString(), [86, 90, 84, 88, 87]),
      syntheticSession('s3', 'p1', day(-1).toISOString(), [95, 96, 94, 95, 96]),
    ],
  });

  it('produces explainable observations traceable to records, with rule ids and versions', () => {
    const obs = analyze(input());
    const ids = obs.map((o) => o.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['assigned_not_completed', 'reported_fatigue_discomfort', 'repeated_barrier', 'consistency_trend', 'range_vs_baseline', 'baseline_not_designated', 'assessment_interval']));
    for (const o of obs) {
      expect(RULES.some((r) => r.id === o.ruleId && r.version === o.ruleVersion)).toBe(true);
      if (o.ruleId !== 'baseline_not_designated' && o.ruleId !== 'assessment_interval') expect(o.evidence.length).toBeGreaterThan(0);
    }
    const cons = obs.find((o) => o.ruleId === 'consistency_trend')!;
    expect(cons.params.direction).toBe('more_consistent');
    expect(cons.evidence.map((e) => e.id)).toEqual(['s1', 's2', 's3']);
    // Neutral wording: the range rule says higher/lower, never improved/worse
    expect(obs.find((o) => o.ruleId === 'range_vs_baseline')!.params.direction).toBe('higher');
  });

  it('NEVER changes treatment: output has no action fields and inputs are not mutated', () => {
    const inp = input();
    const before = JSON.stringify(inp);
    const obs = analyze(inp);
    expect(JSON.stringify(inp)).toBe(before);
    const forbidden = /frequency|intensity|difficulty|duration|dose|repetitions|prescri|increase|decrease/i;
    for (const o of obs) {
      expect(Object.keys(o).sort()).toEqual(['category', 'evidence', 'id', 'params', 'ruleId', 'ruleVersion', 'severity']);
      expect(Object.keys(o.params).join(',')).not.toMatch(forbidden);
    }
    for (const r of RULES) expect(r.notMeaning.length).toBeGreaterThan(5);
  });

  it('safety incidents without review always come first', () => {
    const inp = input();
    const { incidents } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'stopped', difficulty: false, breakRequested: true, fatigue: 3, discomfort: 'pain', barriers: [], durationMin: 2, observation: '' }, 'clinic', 'M', 'caregiver', day(-1));
    const obs = analyze({ ...inp, incidents });
    expect(obs[0]!.ruleId).toBe('safety_unreviewed');
    expect(obs[0]!.severity).toBe('review');
  });

  it('a review records responses, decision and reasoning; the program changes only through a new version citing it', () => {
    const inp = input();
    const obs = analyze(inp);
    const { review, goals } = recordReview(
      {
        participantId: 'p1',
        programKey: prog.id,
        periodFrom: null,
        observations: obs,
        responses: obs.map((o) => ({ observationId: o.id, response: 'agree' as const, note: '' })),
        decision: 'modify_program',
        reasoning: 'Fatigue reports: shorter home sessions agreed with the family.',
        goalUpdates: [{ goalId: goal.id, status: 'in_progress' }],
        acknowledged: inp.practice.map((p) => p.id),
      },
      [goal],
      'clinic',
      'Dr A',
      NOW,
    );
    expect(validRehabRecord(review)).toBe(true);
    expect(review.algorithmVersion).toBe(PROGRESS_ALGORITHM);
    expect(goals[0]!.status).toBe('in_progress');
    expect(goals[0]!.history.at(-1)).toMatchObject({ type: 'status', byRole: 'professional' });
    expect(checkSave([review, ...goals], PRO, [goal])).toMatchObject({ ok: true });
    // Reasoning is required for a progress review
    expect(validRehabRecord({ ...review, reasoning: '  ' })).toBe(false);
    // The review is immutable
    expect(checkTransition(review, { ...review, decision: 'continue' })).toBe('immutable');
    const def2 = structuredClone(prog.def);
    def2.modules.find((m) => m.type === 'home')!.assignments[0]!.durationMin = 5;
    const v2 = newProgramVersion([prog], { seriesId: prog.seriesId, def: def2, participantId: 'p1', template: false, changeReason: review.reasoning, basedOnReviewId: review.id, workspace: 'clinic', author: 'Dr A' }, NOW)!;
    expect(v2.basedOnReviewId).toBe(review.id);
  });

  it('acknowledgement removes reports from the unreviewed list without a decision', () => {
    const a = acknowledge('p1', ['pr_1'], 'clinic', 'Dr A', NOW);
    expect(validRehabRecord(a)).toBe(true);
    expect(a.decision).toBe('noted');
  });
});

describe('14. research: enrolment, consent, pseudonymised export', () => {
  const study = { ...newStudy({ title: 'Feasibility of NeuroMove home programs', shortCode: 'NM1', ethics: { committee: 'Local IRB', reference: 'IRB-2026-14', approvedOn: null }, protocolSummary: '', domains: ['feasibility', 'engagement'], startDate: null, endDate: null, programTemplateKeys: [] }, 'clinic', 'R', NOW) };

  it('no enrolment without ethics approval and guardian permission', () => {
    const c = { participantId: 'p1', pseudonym: 'NM1-001', guardianPermission: { obtained: false, date: null, formVersion: 'v1' }, childAssent: 'not_yet' as const };
    expect(enrolmentProblems(study, c, [])).toEqual(expect.arrayContaining(['ethics_not_approved', 'study_not_open', 'guardian_permission_missing']));
    // A study cannot be marked recruiting without the approval on record
    expect(validRehabRecord({ ...study, status: 'recruiting' })).toBe(false);
    const open = { ...study, status: 'recruiting' as const, ethics: { ...study.ethics, approvedOn: '2026-10-01' } };
    expect(enrolmentProblems(open, { ...c, guardianPermission: { obtained: true, date: '2026-10-05', formVersion: 'v1' }, childAssent: 'obtained' }, [])).toEqual([]);
  });

  it('export contains pseudonyms and study days only — no codes, names, birth years, ids or free text', () => {
    const openStudy = { ...study, status: 'active' as const, ethics: { ...study.ethics, approvedOn: '2026-10-01' } };
    const consent = newConsent({ participantId: 'p1', studyId: openStudy.id, pseudonym: 'NM1-001', guardianPermission: { obtained: true, date: day(-25).toISOString(), formVersion: 'v1' }, childAssent: 'obtained', exportAllowed: true }, 'clinic', 'Dr A', day(-25));
    const withdrawnAll = withdrawConsent(newConsent({ participantId: 'p2', studyId: openStudy.id, pseudonym: 'NM1-002', guardianPermission: { obtained: true, date: day(-25).toISOString(), formVersion: 'v1' }, childAssent: 'obtained', exportAllowed: true }, 'clinic', 'Dr A', day(-25)), 'remove_data', day(-2));
    const patient = { id: 'p1', workspace: 'clinic' as const, code: 'Alikhan', birthYear: 2017, cpForm: 'hemiplegia' as const, gmfcs: 2 as const, macs: 2 as const, affectedSide: 'right' as const, status: 'active' as const, courseStart: null, createdAt: day(-30).toISOString(), goals: [], nextVisit: null, nextProtocol: null };
    const g = newGoal('p1', draft, 'clinic', 'Dr A', day(-20));
    const { practice } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'completed', difficulty: false, breakRequested: false, fatigue: 0, discomfort: 'none', barriers: [], durationMin: 10, observation: 'Alikhan did great at grandma Saule' }, 'clinic', 'M', 'caregiver', day(-3));
    const ds = buildStudyDataset(
      { study: openStudy, consents: [consent, withdrawnAll], patients: [patient], goals: [g], programs: [], practice: [practice], sessions: [syntheticSession('s1', 'p1', day(-10).toISOString(), [80, 81, 82])], assessments: [], incidents: [], reviews: [], now: NOW },
      'ds-test-0001',
    );
    const text = JSON.stringify(ds.tables);
    expect(text).not.toMatch(/Alikhan|Saule|2017|p1"|s1"|Dr A|goal_/);
    expect(ds.tables.participants).toHaveLength(1);
    expect(ds.tables.participants![0]).toMatchObject({ participant: 'NM1-001', age_band: '7-12' });
    expect(ds.manifest.excluded.withdrawnRemoveData).toBe(1);
    expect(ds.tables.practice![0]).toMatchObject({ day: 22, source: 'caregiver_report', sensor_measured: false });
    expect(ds.tables.movement![0]).toMatchObject({ session: 'S1', day: 15, rom: 81 });
    const csv = tableCsv(ds.tables.movement!);
    expect(csv.split('\n')[0]).toContain('rom');
    const report = studyReportMarkdown(ds, studyReport(ds));
    expect(report).toContain('No efficacy claim');
    expect(report).toContain('Negative findings');
  });

  it('consent can only be withdrawn, never edited or reactivated', () => {
    const c = newConsent({ participantId: 'p1', studyId: 'study_1', pseudonym: 'NM1-001', guardianPermission: { obtained: true, date: '2026-10-05', formVersion: 'v1' }, childAssent: 'obtained', exportAllowed: true }, 'clinic', 'Dr A', NOW);
    const w = withdrawConsent(c, 'stop_collection', day(1));
    expect(checkTransition(c, w)).toBeNull();
    expect(checkTransition(w, { ...w, status: 'active', withdrawnAt: null })).toBe('consent_changed');
    expect(checkTransition(c, { ...c, pseudonym: 'NM1-999' })).toBe('consent_changed');
  });
});

describe('15. access permissions', () => {
  const g = newGoal('p1', draft, 'clinic', 'Dr A', NOW);
  const act = activity();
  const prog = program(act, g.id);

  it('observers write nothing; caregivers cannot create or change programs, goals or reviews', () => {
    expect(canWriteRehab({ role: 'observer', participantIds: [] }, g, null)).toBe('read_only_role');
    expect(canWriteRehab(CARE, prog, null)).toBe('professional_only');
    expect(canWriteRehab(CARE, g, null)).toBe('professional_only');
    expect(checkSave([prog], CARE, [])).toMatchObject({ ok: false, error: 'professional_only' });
    expect(canWriteRehab({ role: 'measurement_operator', participantIds: [] }, prog, null)).toBe('professional_only');
    expect(canWriteRehab(PRO, prog, null)).toBeNull();
  });

  it('staff may upload a family report taken on a shared tablet, but never edit it or author other caregiver records', () => {
    const { practice } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'completed', difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: [], durationMin: null, observation: '' }, 'clinic', 'X', 'caregiver', NOW);
    expect(canWriteRehab(PRO, practice, null)).toBeNull();
    expect(checkSave([{ ...practice, completion: 'partial' }], PRO, [practice])).toMatchObject({ ok: false, error: 'immutable' });
    expect(canWriteRehab(PRO, { ...g, createdByRole: 'caregiver' }, null)).toBe('author_role_mismatch');
  });

  it('caregivers read only their child, non-draft activities and never professional/research records', () => {
    const records: RehabRecord[] = [g, prog, act, activity('draft'), newGoal('p2', draft, 'clinic', 'Dr A', NOW), acknowledge('p1', [], 'clinic', 'Dr A', NOW)];
    expect(records.filter((r) => caregiverMayRead(r, ['p1'])).map((r) => r.kind)).toEqual(['goal', 'program', 'activity']);
  });
});
