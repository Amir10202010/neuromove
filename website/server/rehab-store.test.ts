// End-to-end inside Node: the real app store + rehab store on IndexedDB (fake-indexeddb), then the real
// sync engine against the real API handler (PGlite). Covers: create participant → goals → program →
// new version → assign → home completion → caregiver observation → reopen the app → offline changes
// synchronised → nothing rewritten.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openStorage } from '../src/data/db';
import type { Patient } from '../src/data/models';
import { familyInput, newGoal } from '../src/rehab/goals';
import type { Actor } from '../src/rehab/policy';
import { emptyProgram, newActivityVersion, newAssignment, newProgramVersion } from '../src/rehab/programs';
import { ofKind, useRehabStore } from '../src/rehab/store';
import { newProfile, reportPractice } from '../src/rehab/workflows';
import { handle } from './http';
import { testApi } from './testing';

const PRO: Actor = { role: 'admin', name: 'Dr A', participantIds: [] };
const CARE: Actor = { role: 'caregiver', name: 'Mother', participantIds: ['p_store'] };
const TITLES = { assessment: 'A', supervised: 'B', home: 'C', review: 'D', reassessment: 'E' };

describe('rehab store: IndexedDB, reopen, offline sync', () => {
  it('full home-to-clinic workflow persists atomically, survives reopening and synchronises', async () => {
    globalThis.indexedDB = new IDBFactory();
    const { useAppStore } = await import('../src/state/appStore');
    await useAppStore.getState().init();
    useAppStore.getState().setWorkspace('clinic');
    const patient: Patient = { id: 'p_store', workspace: 'clinic', code: 'P07', birthYear: 2017, cpForm: 'hemiplegia', gmfcs: 2, macs: 2, affectedSide: 'right', status: 'active', courseStart: null, createdAt: new Date().toISOString(), goals: [], nextVisit: null, nextProtocol: null };
    useAppStore.getState().savePatient(patient);
    expect(await useAppStore.getState().flush()).toBe(true);

    const rs = useRehabStore.getState();
    await rs.load();
    // 1–2. profile + goal
    const profile = newProfile(patient.id, 'clinic', 'Dr A');
    const goal = newGoal(patient.id, { category: 'bilateral_hand_use', description: 'Hold a box with both hands', whyItMatters: 'Carry her lunch box', baseline: 'Drops it after 2 s', target: 'Carries it across the room', measurement: { kind: 'gas', detail: '', exercise: null, side: null }, responsible: 'Dr A', reviewDate: null, contributors: ['professional', 'family'] }, 'clinic', 'Dr A');
    expect(await useRehabStore.getState().save([profile, goal], PRO)).toMatchObject({ ok: true });
    // 3–5. activity, program v1, assignment, then v2
    const act = newActivityVersion([], { def: { name: 'Box carry', description: '', goalCategories: ['bilateral_hand_use'], domain: 'bimanual', setup: 'Shoebox', professionalInstructions: '', caregiverInstructions: 'Walk together with the box', steps: [{ icon: 'two_hands', text: 'Hold with both hands' }], homeSuitable: true, measurement: { kind: 'completion_only', exercise: null, detail: '' }, completionCriteria: '', safetyNotes: '', evidenceRefs: [], language: 'en' }, status: 'clinician_approved', changeNote: '', workspace: 'clinic', author: 'Dr A', authorRole: 'professional' })!;
    const def = emptyProgram('Dr A', TITLES);
    def.name = 'Bimanual block';
    def.goalIds = [goal.id];
    const as = newAssignment(act.id, 'home');
    as.frequencyPerWeek = 3;
    def.modules[2]!.assignments.push(as);
    const v1 = newProgramVersion([], { def, participantId: patient.id, template: false, changeReason: '', basedOnReviewId: null, workspace: 'clinic', author: 'Dr A' })!;
    expect(await useRehabStore.getState().save([act, v1], PRO)).toMatchObject({ ok: true });
    const def2 = structuredClone(def);
    def2.modules[2]!.assignments[0]!.durationMin = 10;
    const v2 = newProgramVersion([v1], { seriesId: v1.seriesId, def: def2, participantId: patient.id, template: false, changeReason: 'Duration agreed with family', basedOnReviewId: null, workspace: 'clinic', author: 'Dr A' })!;
    expect(await useRehabStore.getState().save([v2], PRO)).toMatchObject({ ok: true });
    // A caregiver cannot save a program version: nothing is written
    const v3 = newProgramVersion([v1, v2], { seriesId: v1.seriesId, def: { ...def2, name: 'x' }, participantId: patient.id, template: false, changeReason: 'x', basedOnReviewId: null, workspace: 'clinic', author: 'Mother' })!;
    expect(await useRehabStore.getState().save([v3], CARE)).toMatchObject({ ok: false, error: 'professional_only' });
    // 6–7. home completion + caregiver observation (+ family goal input)
    const { practice, incidents } = reportPractice({ participantId: patient.id, programKey: v2.id, assignmentId: as.id, activityKey: act.id, setting: 'home', source: 'caregiver_report', completion: 'completed', difficulty: false, breakRequested: true, fatigue: 1, discomfort: 'none', barriers: [], durationMin: 10, observation: 'Liked it' }, 'clinic', 'Mother', 'caregiver');
    expect(await useRehabStore.getState().save([practice, ...incidents, familyInput(goal, 'Mother', 'Lunch box matters most')], CARE)).toMatchObject({ ok: true });

    // Same transaction: every record has its outbox op
    const st = useAppStore.getState().storage()!;
    const ops = (await st.listOutbox()).filter((o) => o.entity === 'rehab_record').map((o) => o.entityId);
    expect(ops.sort()).toEqual([profile.id, goal.id, act.id, v1.id, v2.id, practice.id].sort());
    expect(ops).not.toContain(v3.id);

    // 8. Reopen: a new connection to the same database sees everything, versions intact
    const again = await openStorage();
    const stored = await again.getAllResearch('rehab');
    expect(stored.map((r) => r.id).sort()).toEqual([profile.id, goal.id, act.id, v1.id, v2.id, practice.id].sort());
    useRehabStore.setState({ loaded: false, records: [] });
    await useRehabStore.getState().load();
    const programs = ofKind(useRehabStore.getState().records, 'program', 'clinic', patient.id);
    expect(programs.map((p) => p.version).sort()).toEqual([1, 2]);
    expect(programs.find((p) => p.version === 1)!.def.modules[2]!.assignments[0]!.durationMin).toBeNull();
    expect(ofKind(useRehabStore.getState().records, 'goal', 'clinic', patient.id)[0]!.history.map((h) => h.type)).toEqual(['created', 'family_input']);

    // 9. Offline changes synchronise once a team account enables sync
    const api = await testApi();
    const { configureSync, useSyncStore } = await import('../src/sync/engine');
    let cookie = '';
    configureSync({
      transport: async (path, init) => {
        const method = init?.method ?? 'GET';
        const res = await handle(new Request(`https://app.test${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-neuromove': '1' } : {}) }, ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), api.deps);
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0]!;
        return { status: res.status, json: await res.json().catch(() => null) };
      },
    });
    expect(await useSyncStore.getState().bootstrap({ setupCode: 'test-setup-code-123', teamName: 'Clinic', email: 'dr@c.org', password: 'correct horse battery', displayName: 'Dr A' })).toBeNull();
    await useSyncStore.getState().setEnabled(true);
    useSyncStore.getState().stop();
    await useSyncStore.getState().syncNow();
    useSyncStore.getState().stop();
    expect((await st.listOutbox()).filter((o) => o.state !== 'pending' || o.entity === 'rehab_record')).toEqual([]);
    const server = await api.db.query<{ id: string; kind: string; author_role: string }>('select id, kind, author_role from nm_rehab_records order by kind, id');
    expect(server.map((r) => r.id).sort()).toEqual([profile.id, goal.id, act.id, v1.id, v2.id, practice.id].sort());
    // Synced by a professional account: the caregiver-authored report keeps its author role
    expect(server.find((r) => r.id === practice.id)!.author_role).toBe('caregiver');
  }, 60_000);
});
