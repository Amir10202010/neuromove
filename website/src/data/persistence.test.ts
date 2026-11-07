// Regression tests for the clinic data-loss bug found on 8 Nov 2026.
//
// Symptom (clinic backup 2026-10-27): alerts referenced sessions s_fcf24f… and s_8529…, but the backup
// had `sessions: []`. Root cause: single-sensor sessions carry protocolId 'single', which the load-time
// validator (data/backup.ts) did not know. The sessions WERE written to IndexedDB, then hidden as
// "corrupted" on every reload, so they were missing from screens and from exported backups. Worse,
// importing a backup or "clear clinic" called replaceWorkspace, which deleted the hidden records for good.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_SENSOR_EXERCISES, singleSensorSteps } from '../core/protocols';
import { buildSession } from '../session/buildSession';
import { buildProfile } from '../simulation/profiles';
import { runVirtualSession } from '../simulation/runVirtualSession';
import type { Patient, Session } from './models';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

const patient: Patient = {
  id: 'p_real01',
  workspace: 'clinic',
  code: 'Участник01',
  birthYear: 2017,
  cpForm: 'diplegia',
  gmfcs: 3,
  macs: 2,
  affectedSide: 'left',
  status: 'active',
  courseStart: null,
  createdAt: '2026-10-27T07:43:34.885Z',
  goals: [],
  nextVisit: null,
  nextProtocol: null,
};

function singleSensorSession(id: string): Session {
  // Engine output from the real pipeline (virtual participant), recorded as a non-simulated USB session —
  // exactly the shape a clinic single-sensor test produces.
  const steps = singleSensorSteps('fore', 'left', SINGLE_SENSOR_EXERCISES.fore, 3);
  const result = runVirtualSession({ profile: buildProfile({ left: 0.4, right: 0.05 }), steps, seed: 7, singleSensor: 'fore_l' });
  return buildSession({
    id,
    workspace: 'clinic',
    patientId: patient.id,
    protocolId: 'single',
    result,
    startedAt: new Date('2026-10-27T07:56:45.004Z'),
    device: { kind: 'usb', name: 'NeuroMove Stand', firmware: 'stand-1', format: 'imu-csv v1', rateHz: 100, simulated: false },
    clinician: 'Operator',
    demo: false,
    hasRaw: false,
  });
}

async function freshStore() {
  const { useAppStore } = await import('../state/appStore');
  await useAppStore.getState().init();
  return useAppStore;
}

describe('clinic data survives reload', () => {
  it('a single-sensor session is still listed after reload (root cause of the lost sessions)', async () => {
    const store = await freshStore();
    store.getState().savePatient(patient);
    store.getState().saveSession(singleSensorSession('s_fcf24f56052c4ca4'));
    expect(await store.getState().flush()).toBe(true);

    vi.resetModules(); // = page reload: new module state, same IndexedDB
    const reloaded = await freshStore();
    const st = reloaded.getState();
    expect(st.storageRejected).toBe(0);
    expect(st.sessions.filter((s) => s.workspace === 'clinic').map((s) => s.id)).toEqual(['s_fcf24f56052c4ca4']);
    // And therefore it is in the exported backup
    reloaded.getState().setWorkspace('clinic');
    const backup = JSON.parse(reloaded.getState().exportBackup()) as { data: { sessions: Session[] } };
    expect(backup.data.sessions.map((s) => s.id)).toEqual(['s_fcf24f56052c4ca4']);
  }, 60_000);

  it('every clinic write is queued for the server in the same transaction', async () => {
    const store = await freshStore();
    store.getState().savePatient(patient);
    store.getState().saveSession(singleSensorSession('s_q1'));
    expect(await store.getState().flush()).toBe(true);
    const outbox = await store.getState().storage()!.listOutbox();
    const entities = outbox.map((o) => `${o.entity}:${o.entityId}`);
    expect(entities).toContain('participant:p_real01');
    expect(entities).toContain('rehab_session:s_q1');
    // Participant (parent) is queued before its session (child)
    expect(entities.indexOf('participant:p_real01')).toBeLessThan(entities.indexOf('rehab_session:s_q1'));
    // Demo writes never enter the outbox
    expect(outbox.every((o) => (o.payload as { workspace?: string } | null)?.workspace !== 'demo')).toBe(true);
  }, 60_000);
});

describe('quarantined records are never deleted', () => {
  it('importing a backup and clearing the clinic keep records that failed validation', async () => {
    const { openStorage } = await import('./db');
    const raw = await openStorage();
    // A record the current validator does not accept (e.g. written by a future app version)
    await raw.put('sessions', { id: 's_future', workspace: 'clinic', patientId: 'p_real01', protocolId: 'future_protocol' } as never);
    const store = await freshStore();
    expect(store.getState().storageRejected).toBe(1);
    const q = JSON.parse(store.getState().exportQuarantine()) as { records: { id: string }[] };
    expect(q.records.map((r) => r.id)).toEqual(['s_future']);

    store.getState().setWorkspace('clinic');
    const backup = JSON.stringify({
      format: 'neuromove-backup',
      version: 1,
      workspace: 'clinic',
      exportedAt: new Date().toISOString(),
      data: { patients: [patient], sessions: [], notes: [], alerts: [] },
    });
    expect(await store.getState().importBackup(backup)).toBe(true);
    await store.getState().clearClinic();

    const again = await openStorage();
    expect((await again.loadAll()).sessions.map((s) => s.id)).toContain('s_future');
  }, 60_000);
});
