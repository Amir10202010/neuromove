// ICF-CY tags, family-access helpers, grounded summaries, and the live-practice controller mode.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupLinks, suggestPassword } from './caregivers';
import { newGoal, type GoalDraft } from './goals';
import { GOAL_ICF_SUGGESTIONS, ICF_CATALOG, METRIC_ICF, goalIcf } from './icf';
import { METRIC_ORDER } from './movement';
import { analyze } from './progress';
import { buildFacts, checkDraft, factsPrompt, systemPrompt, validFactsPayload } from './summary';
import { buildStudyDataset } from './study';
import { syntheticSession } from './testing';
import { validRehabRecord } from './validate';
import { newConsent, newProfile, newStudy, reportPractice } from './workflows';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86400_000);
const draft: GoalDraft = {
  category: 'bilateral_hand_use',
  description: 'Carry Alikhan’s lunch box with both hands',
  whyItMatters: 'School',
  baseline: '',
  target: 'Door to table',
  measurement: { kind: 'gas', detail: '', exercise: null, side: null },
  responsible: 'Dr Saule Akhmetova',
  reviewDate: null,
  contributors: ['professional'],
};

describe('ICF-CY tags', () => {
  it('goals carry confirmed codes or a marked suggestion; unknown codes are rejected', () => {
    const g = newGoal('p1', draft, 'clinic', 'Dr A', NOW);
    expect(goalIcf(g)).toEqual({ codes: GOAL_ICF_SUGGESTIONS.bilateral_hand_use, confirmed: false });
    const confirmed = { ...g, icf: ['d430', 'd445'] };
    expect(validRehabRecord(confirmed)).toBe(true);
    expect(goalIcf(confirmed)).toEqual({ codes: ['d430', 'd445'], confirmed: true });
    expect(validRehabRecord({ ...g, icf: ['x999'] })).toBe(false);
    // Records stored before ICF tags existed stay valid
    expect(validRehabRecord(g)).toBe(true);
  });

  it('every IMU metric is a body-function (b) descriptor, never activity/participation', () => {
    for (const m of METRIC_ORDER) expect(ICF_CATALOG.find((c) => c.code === METRIC_ICF[m])?.component).toBe('b');
  });

  it('every suggested code exists in the catalogue', () => {
    for (const codes of Object.values(GOAL_ICF_SUGGESTIONS)) for (const c of codes) expect(ICF_CATALOG.some((x) => x.code === c)).toBe(true);
  });

  it('the research export carries the ICF codes and whether they were confirmed', () => {
    const study = { ...newStudy({ title: 'S', shortCode: 'NM1', ethics: { committee: 'c', reference: 'r', approvedOn: '2026-10-01' }, protocolSummary: '', domains: ['feasibility'], startDate: null, endDate: null, programTemplateKeys: [] }, 'clinic', 'R', NOW), status: 'active' as const };
    const consent = newConsent({ participantId: 'p1', studyId: study.id, pseudonym: 'NM1-001', guardianPermission: { obtained: true, date: day(-20).toISOString(), formVersion: 'v1' }, childAssent: 'obtained', exportAllowed: true }, 'clinic', 'Dr A', day(-20));
    const g = { ...newGoal('p1', draft, 'clinic', 'Dr A', day(-10)), icf: ['d430'] };
    const ds = buildStudyDataset({ study, consents: [consent], patients: [], goals: [g], programs: [], practice: [], sessions: [], assessments: [], incidents: [], reviews: [], now: NOW }, 'ds-x-000001');
    expect(ds.tables.goals![0]).toMatchObject({ icf: 'd430', icf_confirmed: true });
    expect(ds.dictionary.some((d) => d.column === 'icf')).toBe(true);
  });
});

describe('family access helpers', () => {
  it('groups server rows per account; revoked links are kept apart, not lost', () => {
    const rows = [
      { id: 'u1', email: 'mom@x.kz', display_name: 'Mother', participant_id: 'p1', created_at: '', revoked_at: null },
      { id: 'u1', email: 'mom@x.kz', display_name: 'Mother', participant_id: 'p2', created_at: '', revoked_at: '2026-11-01' },
      { id: 'u2', email: 'dad@x.kz', display_name: 'Father', participant_id: 'p1', created_at: '', revoked_at: null },
    ];
    expect(groupLinks(rows)).toEqual([
      { userId: 'u2', email: 'dad@x.kz', displayName: 'Father', active: ['p1'], revoked: [] },
      { userId: 'u1', email: 'mom@x.kz', displayName: 'Mother', active: ['p1'], revoked: ['p2'] },
    ]);
  });

  it('suggested passwords meet the server minimum (≥ 10 characters)', () => {
    const p = suggestPassword((n) => Uint8Array.from({ length: n }, (_, i) => i * 7));
    expect(p).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(p.length).toBeGreaterThanOrEqual(10);
  });
});

describe('grounded summaries', () => {
  const g = newGoal('p1', draft, 'clinic', 'Dr Saule Akhmetova', day(-30));
  const { practice, incidents } = reportPractice({ participantId: 'p1', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'stopped', difficulty: true, breakRequested: true, fatigue: 3, discomfort: 'pain', barriers: ['child_tired'], durationMin: 4, observation: 'Alikhan cried at grandma Saule’s house' }, 'clinic', 'Mother', 'caregiver', day(-2));
  const sessions = [syntheticSession('s1', 'p1', day(-20).toISOString(), [80, 82, 81]), syntheticSession('s2', 'p1', day(-3).toISOString(), [95, 96, 94])];
  const input = (includeGoalText: boolean) => {
    const profile = newProfile('p1', 'clinic', 'Dr A', day(-30));
    const observations = analyze({ participantId: 'p1', now: NOW, demo: false, profile, goals: [g], program: null, practice: [practice], incidents, reviews: [], assessments: [], sessions });
    return { now: NOW, demo: false, profile, goals: [g], program: null, practice: [practice], incidents, reviews: [], assessments: [], sessions, observations, includeGoalText };
  };

  it('facts are numbered, sourced and traceable to records', () => {
    const facts = buildFacts(input(true));
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
    expect(new Set(facts.map((f) => f.source))).toEqual(new Set(['professional', 'reported', 'imu', 'analysis']));
    const safety = facts.find((f) => f.section === 'safety')!;
    expect(safety.refs).toEqual([{ kind: 'incident', id: incidents[0]!.id }]);
    expect(facts.find((f) => f.section === 'measurements')!.text).toContain('not clinically validated');
  });

  it('the AI payload holds no names, no professional names and no free text unless goal wording is opted in', () => {
    const facts = buildFacts(input(false));
    const payload = JSON.stringify(facts.map(({ id, section, source, text }) => ({ id, section, source, text })));
    expect(payload).not.toMatch(/Alikhan|Saule|Akhmetova|grandma|Mother|p1"|s1"/);
    expect(validFactsPayload(JSON.parse(payload))).toBe(true);
    // With the opt-in, the professional's goal wording is included (and only that)
    expect(JSON.stringify(buildFacts(input(true)))).toContain('lunch box');
    expect(JSON.stringify(buildFacts(input(true)))).not.toMatch(/grandma|Akhmetova/);
  });

  it('the prompt forbids diagnosis, prescription and improvement claims and requires citations', () => {
    const s = systemPrompt('ru');
    expect(s).toMatch(/Do not diagnose/);
    expect(s).toMatch(/do not recommend or change treatment/);
    expect(s).toMatch(/must cite/);
    expect(s).toMatch(/Russian/);
    expect(factsPrompt([{ id: 'F1', section: 'safety', source: 'reported', text: 'x' }])).toBe('Facts:\nF1 [safety; source: reported] x');
  });

  it('a draft is checked against the facts: uncited, unknown-fact and diagnosing sentences are flagged, not hidden', () => {
    const facts = [{ id: 'F1' }, { id: 'F2' }];
    const checked = checkDraft(
      {
        sections: [
          {
            section: 'practice',
            sentences: [
              { text: 'Two home sessions were stopped after reported pain.', facts: ['F1'] },
              { text: 'The range improved a lot.', facts: ['F2'] },
              { text: 'Рекомендуется увеличить нагрузку.', facts: ['F1'] },
              { text: 'Floating claim.', facts: [] },
              { text: 'Made-up source.', facts: ['F9'] },
            ],
          },
        ],
      },
      facts,
    );
    expect(checked.sections[0]!.sentences.map((s) => s.flags)).toEqual([[], ['wording'], ['wording'], ['uncited'], ['unknown_fact']]);
    expect(checked.flagged).toBe(4);
    expect(checked.sections[0]!.sentences[4]!.facts).toEqual([]);
  });
});

describe('live practice never becomes a stored measurement', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("purpose 'practice' writes no crash-recovery copy; a rehab test does", async () => {
    const { SessionController } = await import('../state/sessionController');
    const patient = { id: 'p1', workspace: 'demo' as const, code: 'P01', birthYear: 2018, cpForm: 'other' as const, gmfcs: null, macs: null, affectedSide: 'right' as const, status: 'active' as const, courseStart: null, createdAt: NOW.toISOString(), goals: [], nextVisit: null, nextProtocol: null };
    const setup = (purpose: 'practice' | 'rehab') => ({ workspace: 'demo' as const, patientId: 'p1', protocolId: 'custom' as const, steps: [{ exercise: 'elbow_flexion' as const, side: 'right' as const, reps: 0, durationSec: 60 }], deviceKind: 'simulator' as const, scenario: 'normal' as const, autoAdvance: false, purpose });
    const practice = new SessionController(setup('practice'), patient, []);
    practice.beginTest();
    vi.advanceTimersByTime(6000);
    expect(store.size).toBe(0);
    await practice.dispose();
    const rehab = new SessionController(setup('rehab'), patient, []);
    rehab.beginTest();
    vi.advanceTimersByTime(6000);
    expect(store.size).toBe(1);
    await rehab.dispose();
  });
});
