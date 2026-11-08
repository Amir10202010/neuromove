// Demo-workspace rehab history for two invented children (demo-p01, demo-p02). Everything here is
// fictional and lives only in the demo workspace (never synced). Text goes through `tx` so the demo
// reads in the interface language. Dates are relative to `now`.

import type { Session } from '../data/models';
import { familyInput, newGoal, setGoalStatus } from './goals';
import type { ActivityDef, ActivityVersion, FunctionalGoal, PracticeRecord, RehabRecord } from './model';
import { analyze } from './progress';
import { emptyProgram, newActivityVersion, newAssignment, newProgramVersion } from './programs';
import { DEFAULT_CHILD, newAssessment, newProfile, recordReview, reportPractice, reviewIncident } from './workflows';

type Tx = (en: string) => string;
const DAY = 86400_000;

export function demoRehabRecords(now: Date, tx: Tx, sessions: readonly Session[], language: ActivityDef['language']): RehabRecord[] {
  const at = (d: number, h = 10) => new Date(now.getTime() + d * DAY + (h - 10) * 3600_000);
  const who = tx('Demo clinician');
  const family = tx('Family');
  const out: RehabRecord[] = [];

  // ── Activity library ─────────────────────────────────────────────────────────────────────────
  const act = (d: Partial<ActivityDef>, status: ActivityVersion['status'], day: number): ActivityVersion =>
    newActivityVersion(
      [],
      {
        def: {
          name: '',
          description: '',
          goalCategories: [],
          domain: 'reaching',
          setup: '',
          professionalInstructions: '',
          caregiverInstructions: '',
          steps: [],
          homeSuitable: true,
          measurement: { kind: 'completion_only', exercise: null, detail: '' },
          completionCriteria: '',
          safetyNotes: tx('Stop if the child reports pain or wants to stop. Never continue through pain.'),
          evidenceRefs: [],
          language,
          ...d,
        },
        status,
        changeNote: tx('Demo library item'),
        workspace: 'demo',
        author: who,
        authorRole: 'professional',
      },
      at(day),
    )!;
  const reach = act(
    {
      name: tx('Reach for a cup'),
      description: tx('Seated reaching towards a cup placed on the table, then bringing it closer.'),
      goalCategories: ['reaching', 'daily_activity'],
      domain: 'reaching',
      setup: tx('Stable chair, table at elbow height, a light plastic cup.'),
      professionalInstructions: tx('Set the distance individually; observe trunk lean; adjust at each visit.'),
      caregiverInstructions: tx('Sit next to your child at the table. Put the cup where the therapist showed you. Let your child reach in their own time.'),
      steps: [
        { icon: 'sit', text: tx('Sit up tall') },
        { icon: 'cup', text: tx('Reach for the cup') },
        { icon: 'hold', text: tx('Bring it close') },
        { icon: 'rest', text: tx('Rest your arm') },
      ],
      measurement: { kind: 'imu_session', exercise: 'shoulder_flexion', detail: tx('Shoulder elevation measured during clinic visits only.') },
      completionCriteria: tx('A few calm reaches; stop earlier if tired.'),
      evidenceRefs: ['Jackman et al. 2022, doi:10.1111/dmcn.15055 (goal-directed, task-specific training)'],
    },
    'clinician_approved',
    -70,
  );
  const box = act(
    {
      name: tx('Carry a box with both hands'),
      description: tx('Holding a light box with both hands and carrying it a short distance.'),
      goalCategories: ['bilateral_hand_use'],
      domain: 'bimanual',
      setup: tx('An empty shoebox, a clear path.'),
      professionalInstructions: tx('Observe use of the assisting hand; vary box size at visits.'),
      caregiverInstructions: tx('Give your child the box with both hands. Walk together to the table and put it down.'),
      steps: [
        { icon: 'two_hands', text: tx('Hold with both hands') },
        { icon: 'stand', text: tx('Walk to the table') },
        { icon: 'blocks', text: tx('Put it down gently') },
      ],
      completionCriteria: tx('One or more trips, at the child\'s pace.'),
      evidenceRefs: ['Gordon et al. 2011 (HABIT); see evidence map'],
    },
    'experimental',
    -60,
  );
  const elbow = act(
    {
      name: tx('Elbow bend with a toy'),
      description: tx('Bringing a toy to the mouth and back, elbow supported on the table.'),
      goalCategories: ['object_manipulation'],
      domain: 'upper_limb_range',
      homeSuitable: false,
      measurement: { kind: 'imu_session', exercise: 'elbow_flexion', detail: '' },
      steps: [{ icon: 'ball', text: tx('Hold the toy') }],
    },
    'draft',
    -10,
  );
  out.push(reach, box, elbow);

  // ── demo-p01: two goals, program v1 → review → v2, home reports, an incident ─────────────────
  const p1 = 'demo-p01';
  const s1 = sessions.filter((s) => s.patientId === p1).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const prof1 = { ...newProfile(p1, 'demo', who, at(-63)), assignedProfessional: who, domains: ['reaching' as const, 'bilateral_hand_use' as const], caregiverParticipation: 'regular' as const, assessmentSummary: tx('Right-sided involvement; uses the right hand as an assisting hand. Classification levels as entered at intake.'), baselineSessionIds: s1[0] ? [s1[0].id] : [], child: { ...DEFAULT_CHILD, theme: 'garden' as const } };
  prof1.classifications = [
    { system: 'GMFCS', label: 'GMFCS', level: 'I', enteredBy: who, at: at(-63).toISOString() },
    { system: 'MACS', label: 'MACS', level: 'II', enteredBy: who, at: at(-63).toISOString() },
  ];
  let g1: FunctionalGoal = newGoal(
    p1,
    { category: 'reaching', description: tx('Reach for his cup at breakfast with the right hand'), whyItMatters: tx('He wants to drink by himself like his brother.'), baseline: tx('Reaches about 10 cm with a strong trunk lean.'), target: tx('Takes the cup at 25 cm while seated, most mornings.'), measurement: { kind: 'gas', detail: tx('GAS levels agreed with the family'), exercise: null, side: null }, responsible: who, reviewDate: at(5).toISOString().slice(0, 10), contributors: ['professional', 'family', 'child'], icf: ['d445', 'd560'] },
    'demo',
    who,
    at(-63),
  );
  g1 = setGoalStatus(g1, 'in_progress', who, tx('Program started'), at(-56))!;
  g1 = familyInput(g1, family, tx('At home he tries to reach for the juice too.'), at(-20, 19));
  let g2: FunctionalGoal = newGoal(
    p1,
    { category: 'bilateral_hand_use', description: tx('Carry his lunch box with both hands'), whyItMatters: tx('Going to school without help.'), baseline: tx('Drops the box after a few steps.'), target: tx('Carries it from the door to the table.'), measurement: { kind: 'caregiver_report', detail: tx('Family notes at home'), exercise: null, side: null }, responsible: who, reviewDate: null, contributors: ['professional', 'family'], icf: ['d430', 'd445'] },
    'demo',
    who,
    at(-63),
  );
  g2 = setGoalStatus(g2, 'in_progress', who, '', at(-56))!;
  const g3 = newGoal(
    p1,
    { category: 'reaching', description: tx('Lift the arm to put on a T-shirt'), whyItMatters: tx('Dressing in the morning.'), baseline: '', target: tx('Puts the right arm in the sleeve with little help.'), measurement: { kind: 'imu', detail: tx('Shoulder elevation as context, not as success criterion'), exercise: 'shoulder_flexion', side: 'right' }, responsible: who, reviewDate: null, contributors: ['professional'] },
    'demo',
    who,
    at(-40),
  );

  const titles = { assessment: tx('A — Initial assessment'), supervised: tx('B — Supervised practice'), home: tx('C — Home practice'), review: tx('D — Progress review'), reassessment: tx('E — Reassessment') };
  const def = emptyProgram(who, titles);
  def.name = tx('Reaching and two-hand use, block 1');
  def.description = tx('Goal-directed practice of the family\'s priorities, at the clinic and at home.');
  def.goalIds = [g1.id, g2.id];
  def.domain = 'reaching';
  def.startDate = at(-56).toISOString();
  def.reviewDate = at(-14).toISOString();
  def.plannedWeeks = 8;
  def.plannedSessions = 8;
  def.sessionStructure = tx('Weekly clinic visit (45 min) + short home practice on agreed days.');
  def.measurementRequirements = tx('Upper-limb sensor test at the start and every 2 weeks; GAS at baseline and week 8.');
  const homeReach = { ...newAssignment(reach.id, 'home'), frequencyPerWeek: 4, durationMin: 10, caregiverNote: tx('Mornings are best for him.'), goalIds: [g1.id], feedbackTargetDeg: 120 };
  const homeBox = { ...newAssignment(box.id, 'home'), frequencyPerWeek: 3, durationMin: 5, goalIds: [g2.id] };
  const clinicReach = { ...newAssignment(reach.id, 'clinic'), frequencyPerWeek: 1, durationMin: 20, goalIds: [g1.id] };
  def.modules.find((m) => m.type === 'home')!.assignments.push(homeReach, homeBox);
  def.modules.find((m) => m.type === 'supervised')!.assignments.push(clinicReach);
  def.checkpoints = [{ id: 'cp_demo_1', date: at(-28).toISOString(), label: tx('Mid-block check') }];
  const v1 = newProgramVersion([], { def, participantId: p1, template: false, changeReason: '', basedOnReviewId: null, workspace: 'demo', author: who }, at(-56))!;

  const practice: PracticeRecord[] = [];
  const incidents: RehabRecord[] = [];
  const rep = (d: number, assignmentId: string | null, activityKey: string | null, completion: PracticeRecord['completion'], extra: Partial<PracticeRecord> = {}, programKey = v1.id) => {
    const r = reportPractice(
      { participantId: p1, programKey, assignmentId, activityKey, setting: 'home', source: 'caregiver_report', completion, difficulty: extra.difficulty ?? false, breakRequested: extra.breakRequested ?? false, fatigue: extra.fatigue ?? 0, discomfort: extra.discomfort ?? 'none', barriers: extra.barriers ?? [], durationMin: completion === null ? null : 10, observation: extra.observation ?? '', date: at(d, 18).toISOString() },
      'demo',
      family,
      'caregiver',
      at(d, 18),
    );
    practice.push(r.practice);
    incidents.push(...r.incidents);
    return r;
  };
  for (const d of [-40, -38, -36, -33, -31, -29, -26, -24]) rep(d, homeReach.id, reach.id, 'completed', { fatigue: d % 3 === 0 ? 1 : 0 });
  rep(-35, homeBox.id, box.id, 'partial', { difficulty: true, observation: tx('The box is too big for his hands.') });
  rep(-27, homeBox.id, box.id, 'not_completed', { barriers: ['equipment'] });
  const painful = rep(-22, homeReach.id, reach.id, 'stopped', { fatigue: 2, discomfort: 'pain', breakRequested: true, observation: tx('He said his shoulder hurt, we stopped.') });

  // Professional review 2 weeks ago: incident reviewed, decision to modify (smaller box, shorter sessions)
  const reviewNow = at(-14);
  const obsAtReview = analyze({ participantId: p1, now: reviewNow, demo: true, profile: prof1, goals: [g1, g2], program: v1, practice, incidents: incidents as never, reviews: [], assessments: [], sessions: s1.filter((s) => s.startedAt <= reviewNow.toISOString()) });
  const inc = reviewIncident(painful.incidents[0]!, who, tx('Called the family. Likely too far a reach after school. Distance reduced.'), tx('Check at next visit.'), at(-21));
  const { review } = recordReview(
    {
      participantId: p1,
      programKey: v1.id,
      periodFrom: v1.createdAt,
      observations: obsAtReview,
      responses: obsAtReview.map((o) => ({ observationId: o.id, response: o.category === 'safety' || o.category === 'reported' ? ('agree' as const) : ('needs_more_data' as const), note: '' })),
      decision: 'modify_program',
      reasoning: tx('One pain report after a long reach and difficulty with the box. Agreed with the family: smaller box, shorter home sessions, reach practised in the morning.'),
      goalUpdates: [],
      acknowledged: [...practice.map((p) => p.id), inc.id],
    },
    [g1, g2],
    'demo',
    who,
    reviewNow,
  );
  const def2 = structuredClone(v1.def);
  const h2 = def2.modules.find((m) => m.type === 'home')!;
  h2.assignments = h2.assignments.map((a) => (a.id === homeReach.id ? { ...a, durationMin: 7 } : a.id === homeBox.id ? { ...a, dosageNote: tx('Use the small box.') } : a));
  def2.reviewDate = at(14).toISOString();
  const v2 = newProgramVersion([v1], { seriesId: v1.seriesId, def: def2, participantId: p1, template: false, changeReason: review.reasoning, basedOnReviewId: review.id, workspace: 'demo', author: who }, at(-14, 11))!;
  for (const d of [-12, -10, -8, -5, -3]) rep(d, homeReach.id, reach.id, 'completed', {}, v2.id);
  rep(-9, homeBox.id, box.id, 'completed', { observation: tx('With the small box he walked to the kitchen!') }, v2.id);
  rep(-4, homeBox.id, box.id, 'partial', { fatigue: 2, barriers: ['child_tired'] }, v2.id);
  rep(-1, homeReach.id, reach.id, 'partial', { fatigue: 2, barriers: ['child_tired'], breakRequested: true }, v2.id);
  rep(-2, null, null, null, { observation: tx('Grandmother noticed he uses the right hand more when playing.') }, v2.id);

  const gas = newAssessment(
    { participantId: p1, instrument: 'gas', instrumentName: 'GAS', instrumentVersion: 'Kiresuk & Sherman 1968, ρ = 0.3', scoringMethod: tx('Levels −2…+2 per goal, equal weights'), examiner: who, date: at(-56).toISOString(), timepoint: 'baseline', studyId: null, items: [{ key: g1.id, label: g1.description, value: -1, value2: null, weight: null }, { key: g2.id, label: g2.description, value: -1, value2: null, weight: null }], totals: [], notes: '', supersedes: null },
    'demo',
    who,
    at(-56),
  );
  out.push(prof1, g1, g2, g3, v1, v2, ...practice, ...incidents.filter((i) => i.id !== inc.id), inc, review, gas);

  // ── demo-p02: profile and one goal, no program yet ───────────────────────────────────────────
  const p2 = 'demo-p02';
  const prof2 = { ...newProfile(p2, 'demo', who, at(-59)), domains: ['reaching' as const], caregiverParticipation: 'occasional' as const, child: { ...DEFAULT_CHILD, ageBand: 'early' as const, theme: 'space' as const, textSize: 'xlarge' as const } };
  const g21 = newGoal(p2, { category: 'reaching', description: tx('Reach up for a toy on the shelf with the left hand'), whyItMatters: tx('Choosing his own toys.'), baseline: '', target: tx('Takes a toy from the second shelf.'), measurement: { kind: 'observation', detail: '', exercise: null, side: null }, responsible: who, reviewDate: null, contributors: ['professional', 'family'] }, 'demo', who, at(-59));
  out.push(prof2, g21);
  return out;
}
