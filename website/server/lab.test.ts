// Server: computational motor-learning lab records over /api/sync on real PostgreSQL semantics (PGlite).
// Integrity (hashes) and immutability in the database itself, demo refusal, caregiver limits. Synthetic data only.

import { describe, expect, it } from 'vitest';
import type { Patient } from '../src/data/models';
import { DEFAULT_ANALYSIS_CONFIG } from '../src/lab/analysis';
import type { LearningSeries } from '../src/lab/dataset';
import { emptyProtocol, makeVersion } from '../src/lab/protocol';
import { sealTrialSet, type PracticeTrialSet, type TrialRecordingSetting } from '../src/lab/records';
import { createRun } from '../src/lab/runs';
import type { PullResponse, PushResponse } from '../src/sync/types';
import { testApi } from './testing';

const SETUP = 'test-setup-code-123';
const NOW = '2026-11-08T10:00:00.000Z';
const participant = (id: string): Patient => ({ id, workspace: 'clinic', code: id.toUpperCase(), birthYear: 2016, cpForm: 'other', gmfcs: null, macs: null, affectedSide: 'right', status: 'active', courseStart: null, createdAt: NOW, goals: [], nextVisit: null, nextProtocol: null });
let n = 0;
const op = <T extends { id: string }>(payload: T, baseRev: number | null = null, entity = 'lab_record') => ({ opId: `op-lab-${++n}`, entity, entityId: payload.id, baseRev, payload, deleted: false });

function series(): LearningSeries {
  const sessions = [0, 7, 14, 21, 28].map((day, k) => {
    const reps = [100 + 2 * k, 102 + 2 * k, 99 + 2 * k];
    return { sessionId: `s${k}`, date: new Date(Date.parse(NOW) + day * 86400_000).toISOString(), day, reps, n: 3, mean: reps.reduce((a, b) => a + b) / 3, sd: 1.5, included: true, exclusions: [], simulated: false, doseBefore: null, practiceCountBefore: null, signalPercent: 100, algorithmVersion: 'nm-core 0.2.0', appVersion: '0.1.0' };
  });
  return { key: 'p1|shoulder_flexion|right|rom', participantId: 'p1', exercise: 'shoulder_flexion', side: 'right', metric: 'rom', unit: '°', sessions, doseSource: 'unknown' };
}

const trialSet = (participantId: string, overrides: Partial<PracticeTrialSet> = {}): PracticeTrialSet =>
  sealTrialSet({
    id: `ptr_${participantId}_${++n}`,
    kind: 'practice_trials',
    workspace: 'clinic',
    participantId,
    exercise: 'shoulder_flexion',
    side: 'right',
    targetDeg: 120,
    feedback: 'live_angle_with_target',
    startedAt: NOW,
    endedAt: NOW,
    trials: [1, 2, 3].map((i) => ({ index: i, t: i * 5, peakDeg: 100 + i, errorDeg: 20 - i, valid: true })),
    signalPercent: 99,
    algorithmVersion: 'nm-core 0.2.0',
    appVersion: '0.1.0',
    consentId: 'consent_1',
    simulated: false,
    createdAt: NOW,
    ...overrides,
  });

async function setup() {
  const api = await testApi();
  const admin = api.client();
  expect((await admin('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: 'Clinic', email: 'dr@clinic.org', password: 'correct horse battery', displayName: 'Dr A' } })).status).toBe(200);
  const push = async (c: typeof admin, ops: unknown[]) => (await c('/api/sync/push', { body: { deviceId: 'dev', ops } })).json as PushResponse;
  const r = await push(admin, [op(participant('p1'), null, 'participant'), op(participant('p2'), null, 'participant')]);
  expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied']);
  return { api, admin, push };
}

describe('lab records on the server', () => {
  it('protocol versions: stored with hash; definition immutable via sync AND direct SQL; status only moves forward', async () => {
    const { api, admin, push } = await setup();
    const def = { ...emptyProtocol(), title: 'Pilot', researchQuestion: 'Q', hypothesis: 'H' };
    const v1 = makeVersion(null, def, { workspace: 'clinic', author: 'Dr A', now: NOW, id: 'lp_1' });
    expect((await push(admin, [op(v1)])).results[0]).toMatchObject({ status: 'applied', rev: 1 });
    const row = await api.db.query<{ kind: string; content_hash: string; status: string }>('select kind, content_hash, status from nm_lab_records where id = $1', ['lp_1']);
    expect(row[0]).toEqual({ kind: 'learning_protocol', content_hash: v1.defHash, status: 'draft' });

    // Edited definition with the OLD hash → refused by the shared integrity check
    const forged = { ...v1, def: { ...v1.def, hypothesis: 'changed later' } };
    expect((await push(admin, [op(forged, 1)])).results[0]).toMatchObject({ status: 'rejected', error: 'definition_hash_mismatch' });
    // Edited definition WITH a matching new hash under the same id → refused as a definition change
    const rehashed = makeVersion(null, forged.def, { workspace: 'clinic', author: 'Dr A', now: NOW, id: 'lp_1' });
    expect((await push(admin, [op(rehashed, 1)])).results[0]).toMatchObject({ status: 'rejected', error: 'definition_changed' });
    // Freeze, then archive: accepted; un-freeze: refused
    expect((await push(admin, [op({ ...v1, status: 'frozen' }, 1)])).results[0]).toMatchObject({ status: 'applied', rev: 2 });
    expect((await push(admin, [op({ ...v1, status: 'draft' }, 2)])).results[0]).toMatchObject({ status: 'rejected', error: 'invalid_status_change' });
    expect((await push(admin, [op({ ...v1, status: 'archived' }, 2)])).results[0]).toMatchObject({ status: 'applied', rev: 3 });
    // Direct SQL cannot change the definition or delete
    await expect(api.db.query(`update nm_lab_records set payload = jsonb_set(payload, '{def,title}', '"x"') where id = 'lp_1'`)).rejects.toThrow(/immutable/);
    await expect(api.db.query(`update nm_lab_records set deleted_at = now() where id = 'lp_1'`)).rejects.toThrow(/immutable/);
    // Never deleted through sync
    const del = await push(admin, [{ opId: 'op-lab-del', entity: 'lab_record', entityId: 'lp_1', baseRev: 3, payload: null, deleted: true }]);
    expect(del.results[0]).toMatchObject({ status: 'rejected', error: 'lab_records_are_never_deleted' });
  });

  it('frozen runs: accepted only with consistent hashes, then immutable; simulated and demo runs refused', async () => {
    const { api, admin, push } = await setup();
    const run = createRun({ id: 'run_1', workspace: 'clinic', participantId: 'p1', title: 'ROM', now: NOW, author: 'Dr A', series: [series()], config: { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 20 }, protocol: null });
    expect((await push(admin, [op(run)])).results[0]).toMatchObject({ status: 'applied' });
    // Tampered result (selected model and counts changed, hash kept) → refused
    const tampered = { ...run, id: 'run_2', results: run.results.map((r) => ({ ...r, selected: 'learning_retention' as const, included: r.included + 1 })) };
    expect((await push(admin, [op(tampered)])).results[0]).toMatchObject({ status: 'rejected', error: 'result_hash_mismatch' });
    // Tampered snapshot → refused
    const snap = JSON.parse(JSON.stringify(run));
    snap.id = 'run_3';
    snap.snapshot[0].sessions[0].reps[0] = 200;
    expect((await push(admin, [op(snap)])).results[0]).toMatchObject({ status: 'rejected', error: 'snapshot_hash_mismatch' });
    // Any change to a stored run → immutable
    expect((await push(admin, [op({ ...run, title: 'renamed' }, 1)])).results[0]).toMatchObject({ status: 'rejected', error: 'immutable' });
    await expect(api.db.query(`update nm_lab_records set payload = jsonb_set(payload, '{title}', '"x"') where id = 'run_1'`)).rejects.toThrow(/immutable/);
    // Demo or simulated runs never reach the server
    expect((await push(admin, [op({ ...run, id: 'run_demo', workspace: 'demo' as const })])).results[0]).toMatchObject({ status: 'rejected', error: 'demo_data_not_accepted' });
    expect((await push(admin, [op({ ...run, id: 'run_sim', simulated: true })])).results[0]).toMatchObject({ status: 'rejected', error: 'demo_data_not_accepted' });
  });

  it('practice trials: content-hashed and immutable; simulated sets refused; unknown participant refused', async () => {
    const { admin, push } = await setup();
    const set = trialSet('p1');
    expect((await push(admin, [op(set)])).results[0]).toMatchObject({ status: 'applied' });
    const edited = { ...set, trials: set.trials.map((t) => ({ ...t, peakDeg: t.peakDeg + 30 })) };
    expect((await push(admin, [op(edited, 1)])).results[0]).toMatchObject({ status: 'rejected', error: 'invalid_payload' });
    expect((await push(admin, [op(trialSet('p1', { simulated: true }))])).results[0]).toMatchObject({ status: 'rejected', error: 'demo_data_not_accepted' });
    expect((await push(admin, [op(trialSet('p_unknown'))])).results[0]!.status).not.toBe('applied');
  });

  it('caregiver: may add practice trials of the linked child only, and pulls only its recording setting and trials', async () => {
    const { api, admin, push } = await setup();
    expect((await admin('/api/team/caregivers', { body: { email: 'mom@family.kz', displayName: 'Mother', password: 'family password 1', participantIds: ['p1'] } })).status).toBe(200);
    const setting: TrialRecordingSetting = { id: 'trec_1', kind: 'trial_recording', workspace: 'clinic', participantId: 'p1', enabled: true, consentId: 'consent_1', createdAt: NOW, createdBy: 'Dr A' };
    const def = { ...emptyProtocol(), title: 'Pilot', researchQuestion: 'Q', hypothesis: 'H' };
    const run = createRun({ id: 'run_c', workspace: 'clinic', participantId: 'p1', title: 'ROM', now: NOW, author: 'Dr A', series: [series()], config: { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 }, protocol: null });
    const r = await push(admin, [op(setting), op(makeVersion(null, def, { workspace: 'clinic', author: 'Dr A', now: NOW, id: 'lp_c' })), op(run)]);
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied']);

    const mom = api.client();
    expect((await mom('/api/auth/login', { body: { email: 'mom@family.kz', password: 'family password 1' } })).status).toBe(200);
    const pulled = (await mom('/api/sync/pull?since=0')).json as PullResponse;
    const lab = pulled.changes.filter((c) => c.entity === 'lab_record').map((c) => c.entityId);
    expect(lab).toEqual(['trec_1']);

    const mine = trialSet('p1');
    const other = trialSet('p2');
    const res = await push(mom, [op(mine), op(other), op({ ...setting, id: 'trec_mom', enabled: false })]);
    expect(res.results.map((x) => x.status)).toEqual(['applied', 'rejected', 'rejected']);
    expect(res.results[1]).toMatchObject({ error: 'forbidden' });
  });
});
