// End-to-end: the browser sync engine + outbox (src/sync) against the real API handler (server/http)
// on PostgreSQL semantics (PGlite). Two "devices" share one team.

import { describe, expect, it } from 'vitest';
import { createMemoryStorage, type DataStorage } from '../src/data/db';
import type { Patient } from '../src/data/models';
import { makeOp, resetKnownRevs } from '../src/sync/ops';
import type { PullChange } from '../src/sync/types';
import { handle } from './http';
import { testApi } from './testing';

const NOW = '2026-11-08T10:00:00.000Z';
const participant = (id: string, code = 'P01'): Patient => ({
  id, workspace: 'clinic', code, birthYear: 2015, cpForm: 'other', gmfcs: null, macs: null, affectedSide: 'none', status: 'active', courseStart: null, createdAt: NOW, goals: [], nextVisit: null, nextProtocol: null,
});

/** A fresh engine module instance per device (the engine keeps module state, like in a browser tab). */
async function device(api: Awaited<ReturnType<typeof testApi>>, opts: { online: () => boolean; clock: () => number }) {
  const { vi } = await import('vitest');
  vi.resetModules();
  const engine = await import('../src/sync/engine');
  const ops = await import('../src/sync/ops');
  let cookie = '';
  engine.configureSync({
    clock: opts.clock,
    transport: async (path, init) => {
      if (!opts.online()) throw new Error('offline');
      const method = init?.method ?? 'GET';
      const res = await handle(
        new Request(`https://app.test${path}`, {
          method,
          headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-neuromove': '1' } : {}) },
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        }),
        api.deps,
      );
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0]!;
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  });
  const storage: DataStorage = createMemoryStorage();
  const applied: PullChange[] = [];
  const store = engine.useSyncStore;
  await store.getState().start(storage, async (ch) => void applied.push(ch), { enabled: false }, async () => undefined);
  return { store, storage, applied, makeOp: ops.makeOp };
}

describe('sync engine ⇄ server', () => {
  it('offline → retry with backoff → online → acknowledged; synced only after the server confirms', async () => {
    resetKnownRevs();
    const api = await testApi();
    let online = true;
    let now = 1_000_000;
    const d1 = await device(api, { online: () => online, clock: () => now });
    expect(await d1.store.getState().bootstrap({ setupCode: 'test-setup-code-123', teamName: 'Lab', email: 'a@lab.org', password: 'correct horse battery', displayName: 'A' })).toBeNull();
    await d1.store.getState().setEnabled(true);
    d1.store.getState().stop(); // drive cycles manually

    online = false;
    await d1.storage.put('patients', participant('p_1'), d1.makeOp('participant', 'p_1', participant('p_1')));
    await d1.store.getState().syncNow();
    const waiting = await d1.storage.listOutbox();
    expect(waiting).toHaveLength(1); // still pending locally — not reported as synced
    expect(waiting[0]!.attempts).toBe(1);
    expect(waiting[0]!.nextAttemptAt).toBeGreaterThan(now); // backoff scheduled
    expect(d1.store.getState().phase).toBe('offline');
    expect(await api.db.query('select * from nm_participants')).toHaveLength(0);

    online = true;
    now += 1000; // before the backoff expires the engine would wait; "Sync now" retries immediately
    await d1.store.getState().syncNow();
    expect(await d1.storage.listOutbox()).toHaveLength(0);
    expect(d1.store.getState().phase).toBe('idle');
    expect(d1.store.getState().pending).toBe(0);
    expect(await api.db.query('select * from nm_participants')).toHaveLength(1);
    expect((await d1.storage.getSyncState()).find((r) => r.key === 'participant:p_1')?.serverRev).toBe(1);
  });

  it('a second device pulls the record; concurrent edits become a parked conflict, never a silent overwrite', async () => {
    resetKnownRevs();
    const api = await testApi();
    const clock = () => 2_000_000;
    const d1 = await device(api, { online: () => true, clock });
    await d1.store.getState().bootstrap({ setupCode: 'test-setup-code-123', teamName: 'Lab', email: 'a@lab.org', password: 'correct horse battery', displayName: 'A' });
    await d1.store.getState().setEnabled(true);
    d1.store.getState().stop();
    await d1.storage.put('patients', participant('p_1'), d1.makeOp('participant', 'p_1', participant('p_1', 'P01')));
    await d1.store.getState().syncNow();

    const d2 = await device(api, { online: () => true, clock });
    expect(await d2.store.getState().login('a@lab.org', 'correct horse battery')).toBeNull();
    await d2.store.getState().setEnabled(true);
    d2.store.getState().stop();
    await d2.store.getState().syncNow();
    expect(d2.applied.map((c) => [c.entityId, (c.payload as Patient).code])).toEqual([['p_1', 'P01']]);

    // Both edit offline-ish from rev 1; device 1 syncs first
    await d1.storage.put('patients', participant('p_1'), d1.makeOp('participant', 'p_1', participant('p_1', 'P01-d1')));
    await d2.storage.put('patients', participant('p_1'), d2.makeOp('participant', 'p_1', participant('p_1', 'P01-d2')));
    await d1.store.getState().syncNow();
    await d2.store.getState().syncNow();
    const c = d2.store.getState().conflicts;
    expect(c).toHaveLength(1);
    expect((c[0]!.server!.payload as Patient).code).toBe('P01-d1');
    const rows = await api.db.query<{ code: string }>('select code from nm_participants');
    expect(rows[0]!.code).toBe('P01-d1'); // not overwritten

    await d2.store.getState().resolveConflict(c[0]!.opId, 'mine');
    await d2.store.getState().syncNow();
    expect(d2.store.getState().conflicts).toHaveLength(0);
    expect((await api.db.query<{ code: string; rev: number }>('select code, rev from nm_participants'))[0]).toMatchObject({ code: 'P01-d2', rev: 3 });
  });

  it('raw recording uploads in checksummed chunks after its session, resumes, and never duplicates', async () => {
    const api = await testApi();
    const c = api.client();
    await c('/api/auth/bootstrap', { body: { setupCode: 'test-setup-code-123', teamName: 'Lab', email: 'a@lab.org', password: 'correct horse battery', displayName: 'A' } });
    const transport = async (path: string, init?: { method?: string; body?: unknown }) => c(path, init?.body !== undefined ? { method: init.method ?? 'POST', body: init.body } : {});
    const { uploadRaw, RAW_CHUNK_FRAMES } = await import('../src/sync/raw');
    const storage = createMemoryStorage();
    const frames = Array.from({ length: 2500 }, (_, i) => ({ seq: i, t: i / 100, data: { fore_r: Int16Array.from([i, 2, 8192, 0, 1, -1]) } }));
    const source = { sessions: () => ['s_raw'], get: async () => frames };
    // Session not on the server yet → 409, nothing marked as uploaded
    expect(await uploadRaw(storage, source, transport)).toBe(0);
    await c('/api/sync/push', { body: { deviceId: 'd', ops: [makeOp('participant', 'p_1', participant('p_1'))] } });
    const steps = [{ summary: { exercise: 'forearm_rotation', side: 'right', targetReps: 0, reps: [], rom: null, romBest: null, supination: null, pronation: null, sparc: null, peakVelocity: null, repDuration: null, trunk: null, check: null, cv: null, flags: [] }, trace: { t: [], angle: [], trunk: [] }, status: 'done' }];
    const session = { id: 's_raw', workspace: 'clinic', patientId: 'p_1', startedAt: NOW, endedAt: NOW, protocolId: 'single', steps, events: [], quality: { received: 2500, lost: 0, saturated: 0, percent: 100 }, activeSec: 25, totalSec: 25, calibrationAttempts: 1, status: 'completed', device: { kind: 'usb', name: 'Stand', firmware: 'f', format: 'imu-csv v1', rateHz: 100, simulated: false }, algorithmVersion: 'a', appVersion: 'b', clinician: 'A', note: '', demo: false, hasRaw: true };
    expect(((await c('/api/sync/push', { body: { deviceId: 'd', ops: [makeOp('rehab_session', 's_raw', session)] } })).json as { results: { status: string; error?: string }[] }).results[0]).toMatchObject({ status: 'applied' });
    expect(await uploadRaw(storage, source, transport, 1)).toBe(1); // interrupted after one chunk
    expect(await uploadRaw(storage, source, transport)).toBe(Math.ceil(2500 / RAW_CHUNK_FRAMES) - 1); // resumes
    expect(await uploadRaw(storage, source, transport)).toBe(0); // nothing left
    const rows = await api.db.query<{ chunk_index: number; frame_count: number }>('select chunk_index, frame_count from nm_raw_chunks order by chunk_index');
    expect(rows.map((r) => [r.chunk_index, r.frame_count])).toEqual([
      [0, 1000],
      [1, 1000],
      [2, 500],
    ]);
  });

  it('outbox coalesces repeated offline edits and keeps parents ahead of children', async () => {
    const storage = createMemoryStorage();
    await storage.enqueue(makeOp('participant', 'p_1', participant('p_1', 'v1')));
    await storage.enqueue(makeOp('rehab_session', 's_1', { id: 's_1' }));
    const first = (await storage.listOutbox())[0]!;
    await storage.enqueue(makeOp('participant', 'p_1', participant('p_1', 'v2')));
    const all = await storage.listOutbox();
    expect(all.map((o) => o.entityId)).toEqual(['p_1', 's_1']);
    expect((all[0]!.payload as Patient).code).toBe('v2');
    expect(all[0]!.opId).not.toBe(first.opId); // new idempotency key for the new payload
  });
});
