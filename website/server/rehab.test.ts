// Server: Functional Progression records over /api/sync on real PostgreSQL semantics (PGlite).
// Historical integrity in the database, caregiver accounts limited to their linked child, team isolation.
// All data synthetic, in a throw-away in-memory database.

import { describe, expect, it } from 'vitest';
import type { Patient } from '../src/data/models';
import { familyInput, newGoal, setGoalStatus } from '../src/rehab/goals';
import { emptyProgram, newActivityVersion, newAssignment, newProgramVersion } from '../src/rehab/programs';
import { reportPractice, reviewIncident } from '../src/rehab/workflows';
import type { PullResponse, PushResponse } from '../src/sync/types';
import { testApi } from './testing';

const SETUP = 'test-setup-code-123';
const NOW = new Date('2026-11-08T10:00:00.000Z');
const participant = (id: string, code: string): Patient => ({ id, workspace: 'clinic', code, birthYear: 2016, cpForm: 'other', gmfcs: null, macs: null, affectedSide: 'right', status: 'active', courseStart: null, createdAt: NOW.toISOString(), goals: [], nextVisit: null, nextProtocol: null });
let n = 0;
const op = <T extends { id: string }>(entity: string, payload: T, baseRev: number | null = null) => ({ opId: `op-r-${++n}`, entity, entityId: payload.id, baseRev, payload, deleted: false });
const TITLES = { assessment: 'A', supervised: 'B', home: 'C', review: 'D', reassessment: 'E' };

async function setup() {
  const api = await testApi();
  const admin = api.client();
  expect((await admin('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: 'Clinic', email: 'dr@clinic.org', password: 'correct horse battery', displayName: 'Dr A' } })).status).toBe(200);
  const push = async (c: typeof admin, ops: unknown[]) => (await c('/api/sync/push', { body: { deviceId: 'dev', ops } })).json as PushResponse;
  const r = await push(admin, [op('participant', participant('p1', 'P01')), op('participant', participant('p2', 'P02'))]);
  expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied']);
  const goal = newGoal('p1', { category: 'reaching', description: 'Reach a cup', whyItMatters: 'Breakfast', baseline: '', target: 'Cup at 25 cm', measurement: { kind: 'gas', detail: '', exercise: null, side: null }, responsible: 'Dr A', reviewDate: null, contributors: ['professional'] }, 'clinic', 'Dr A', NOW);
  const act = newActivityVersion([], { def: { name: 'Reach', description: '', goalCategories: ['reaching'], domain: 'reaching', setup: '', professionalInstructions: '', caregiverInstructions: 'Sit at the table', steps: [{ icon: 'cup', text: 'Reach' }], homeSuitable: true, measurement: { kind: 'completion_only', exercise: null, detail: '' }, completionCriteria: '', safetyNotes: '', evidenceRefs: [], language: 'en' }, status: 'clinician_approved', changeNote: '', workspace: 'clinic', author: 'Dr A', authorRole: 'professional' }, NOW)!;
  const def = emptyProgram('Dr A', TITLES);
  def.name = 'Block 1';
  def.modules[2]!.assignments.push(newAssignment(act.id, 'home'));
  const prog = newProgramVersion([], { def, participantId: 'p1', template: false, changeReason: '', basedOnReviewId: null, workspace: 'clinic', author: 'Dr A' }, NOW)!;
  const r2 = await push(admin, [op('rehab_record', goal), op('rehab_record', act), op('rehab_record', prog)]);
  expect(r2.results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied']);
  return { api, admin, push, goal, act, prog };
}

describe('rehab records on the server', () => {
  it('stores typed columns + exact payload; immutable kinds are refused through sync AND direct SQL', async () => {
    const { api, admin, push, prog } = await setup();
    const rows = await api.db.query<{ kind: string; series_id: string; version: number; author_role: string }>("select kind, series_id, version, author_role from nm_rehab_records where kind = 'program'");
    expect(rows).toEqual([{ kind: 'program', series_id: prog.seriesId, version: 1, author_role: 'professional' }]);
    // Editing v1 in place through sync: rejected
    const edited = { ...prog, def: { ...prog.def, name: 'Rewritten' } };
    const r = await push(admin, [op('rehab_record', edited, 1)]);
    expect(r.results[0]).toMatchObject({ status: 'rejected', error: 'immutable' });
    // …and even by direct SQL (trigger)
    await expect(api.db.query(`update nm_rehab_records set payload = '{}'::jsonb where id = $1`, [prog.id])).rejects.toThrow(/immutable/);
    await expect(api.db.query(`update nm_rehab_records set deleted_at = now() where id = $1`, [prog.id])).rejects.toThrow(/immutable/);
    // Deleting rehab history through sync: rejected
    const del = await push(admin, [{ opId: 'op-del-1', entity: 'rehab_record', entityId: prog.id, baseRev: 1, payload: null, deleted: true }]);
    expect(del.results[0]).toMatchObject({ status: 'rejected', error: 'rehab_records_are_never_deleted' });
    // Demo records never reach the server
    const demo = await push(admin, [op('rehab_record', { ...prog, id: 'prg_demo@1', seriesId: 'prg_demo', workspace: 'demo' })]);
    expect(demo.results[0]).toMatchObject({ status: 'rejected', error: 'demo_data_not_accepted' });
  });

  it('goal history is append-only on the server too', async () => {
    const { admin, push, goal } = await setup();
    const g2 = setGoalStatus(goal, 'in_progress', 'Dr A', '', new Date('2026-11-09T10:00:00Z'))!;
    expect((await push(admin, [op('rehab_record', g2, 1)])).results[0]!.status).toBe('applied');
    const rewritten = { ...g2, history: [g2.history[1]!] };
    expect((await push(admin, [op('rehab_record', rewritten, 2)])).results[0]).toMatchObject({ status: 'rejected', error: 'history_rewritten' });
  });

  it('caregiver account: linked child only, reports only, filtered pull, no staff endpoints', async () => {
    const { api, admin, push, goal, prog, act } = await setup();
    // Admin creates a caregiver linked to p1 only (and only an admin may)
    expect((await admin('/api/team/caregivers', { body: { email: 'mom@family.kz', displayName: 'Mother', password: 'family password 1', participantIds: ['p1'] } })).status).toBe(200);
    expect((await admin('/api/team/caregivers', { body: { email: 'x@family.kz', displayName: 'X', password: 'family password 1', participantIds: ['nope'] } })).json).toEqual({ error: 'unknown_participant' });
    // A staff account cannot be turned into a caregiver
    expect((await admin('/api/team/caregivers', { body: { email: 'dr@clinic.org', displayName: 'Dr', participantIds: ['p1'] } })).json).toEqual({ error: 'account_is_staff' });
    // …and team/members cannot create caregivers without links
    expect((await admin('/api/team/members', { body: { email: 'y@family.kz', displayName: 'Y', password: 'family password 1', role: 'caregiver' } })).status).toBe(400);

    const mom = api.client();
    expect((await mom('/api/auth/login', { body: { email: 'mom@family.kz', password: 'family password 1' } })).status).toBe(200);
    const me = (await mom('/api/auth/me')).json as { account: { role: string; participantIds: string[] } };
    expect(me.account).toMatchObject({ role: 'caregiver', participantIds: ['p1'] });
    expect((await mom('/api/team/members')).status).toBe(403);
    expect((await mom('/api/audit')).status).toBe(403);
    expect((await mom('/api/raw?recordingId=x')).status).toBe(403);

    // Admin also writes a clinical note, a family summary, a sensor-less note for p2
    await push(admin, [
      op('note', { id: 'n_clin', workspace: 'clinic', patientId: 'p1', sessionId: null, createdAt: NOW.toISOString(), author: 'Dr A', text: 'clinical', kind: 'clinical' } as never),
      op('note', { id: 'n_sum', workspace: 'clinic', patientId: 'p1', sessionId: null, createdAt: NOW.toISOString(), author: 'Dr A', text: 'Approved summary', kind: 'summary' } as never),
      op('rehab_record', newGoal('p2', { ...goal, category: 'balance', contributors: ['professional'] }, 'clinic', 'Dr A', NOW)),
    ]);

    // Pull: only p1, its goal and program, the approved activity and the summary note
    const pulled = (await mom('/api/sync/pull?since=0')).json as PullResponse;
    const seen = pulled.changes.map((c) => `${c.entity}:${c.entityId}`).sort();
    expect(seen).toEqual([`note:n_sum`, `participant:p1`, `rehab_record:${act.id}`, `rehab_record:${goal.id}`, `rehab_record:${prog.id}`].sort());

    // Writes: a home report for p1 is accepted; pain opens an incident in the same push
    const { practice, incidents } = reportPractice({ participantId: 'p1', programKey: prog.id, assignmentId: null, activityKey: act.id, setting: 'home', source: 'caregiver_report', completion: 'partial', difficulty: true, breakRequested: true, fatigue: 2, discomfort: 'pain', barriers: ['child_tired'], durationMin: 8, observation: '' }, 'clinic', 'Mother', 'caregiver', NOW);
    const ok = await push(mom, [op('rehab_record', practice), op('rehab_record', incidents[0]!)]);
    expect(ok.results.map((x) => x.status)).toEqual(['applied', 'applied']);
    // Family input on the goal: accepted; a status change by the caregiver: rejected
    const fi = familyInput(goal, 'Mother', 'She tries every morning', new Date('2026-11-08T12:00:00Z'));
    expect((await push(mom, [op('rehab_record', fi, 1)])).results[0]!.status).toBe('applied');
    const bad = setGoalStatus(fi, 'achieved', 'Mother', '', new Date('2026-11-08T13:00:00Z'))!;
    expect((await push(mom, [op('rehab_record', bad, 2)])).results[0]).toMatchObject({ status: 'rejected', error: 'caregiver_scope' });
    // Other child, programs, participants: rejected
    const other = reportPractice({ participantId: 'p2', programKey: null, assignmentId: null, activityKey: null, setting: 'home', source: 'caregiver_report', completion: 'completed', difficulty: false, breakRequested: false, fatigue: null, discomfort: null, barriers: [], durationMin: null, observation: '' }, 'clinic', 'Mother', 'caregiver', NOW).practice;
    const def2 = structuredClone(prog.def);
    def2.name = 'Mom edit';
    const progEdit = newProgramVersion([prog], { seriesId: prog.seriesId, def: def2, participantId: 'p1', template: false, changeReason: 'x', basedOnReviewId: null, workspace: 'clinic', author: 'Mother' })!;
    const res = await push(mom, [op('rehab_record', other), op('rehab_record', progEdit), op('participant', participant('p3', 'P03'))]);
    expect(res.results.map((x) => x.error)).toEqual(['not_linked', 'professional_only', 'forbidden_role']);
    // Reviewing the incident is a professional act
    const reviewed = reviewIncident(incidents[0]!, 'Dr A', 'Called family', 'Check next visit', new Date('2026-11-09T09:00:00Z'));
    expect((await push(mom, [op('rehab_record', reviewed, 1)])).results[0]!.error).toBe('caregiver_scope');
    expect((await push(admin, [op('rehab_record', reviewed, 1)])).results[0]!.status).toBe('applied');
    // Audit trail names the caregiver account for its writes
    const audit = await api.db.query<{ email: string }>(`select u.email from nm_audit_events a join nm_users u on u.id = a.user_id where a.entity_id = $1`, [practice.id]);
    expect(audit.map((a) => a.email)).toEqual(['mom@family.kz']);
  });

  it('team isolation: another team can neither read nor overwrite rehab records', async () => {
    const { api, push, goal } = await setup();
    const other = api.client();
    await other('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: 'Other', email: 'b@other.org', password: 'correct horse battery', displayName: 'B' } });
    const pulled = (await other('/api/sync/pull?since=0')).json as PullResponse;
    expect(pulled.changes).toEqual([]);
    const r = await push(other, [op('rehab_record', { ...goal, history: [...goal.history] }, 1)]);
    expect(r.results[0]).toMatchObject({ status: 'rejected', error: 'forbidden' });
  });
});
