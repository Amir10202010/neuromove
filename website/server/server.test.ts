// Server integration tests against real PostgreSQL semantics (PGlite): migrations, auth, team
// isolation, idempotent sync, conflicts, immutability of protocol versions, derived metrics, raw chunks.
// All data here is synthetic and lives in a throw-away in-memory database.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Patient } from '../src/data/models';
import type { ProtocolVersion, Trial, ValidationSession } from '../src/research/model';
import { TEMPLATES } from '../src/research/protocols';
import type { PullResponse, PushResponse } from '../src/sync/types';
import { migrate } from './migrate';
import { testApi, testDb } from './testing';

const SETUP = 'test-setup-code-123';
const NOW = '2026-11-08T10:00:00.000Z';

const participant = (id: string, code = 'P01'): Patient => ({
  id,
  workspace: 'clinic',
  code,
  birthYear: 2015,
  cpForm: 'other',
  gmfcs: null,
  macs: null,
  affectedSide: 'none',
  status: 'active',
  courseStart: null,
  createdAt: NOW,
  goals: [],
  nextVisit: null,
  nextProtocol: null,
});

const def = { ...TEMPLATES[0]!.definition, repetitions: 3 };
const protocol = (version = 1, d = def): ProtocolVersion => ({ key: `prot_a@${version}`, protocolId: 'prot_a', version, workspace: 'clinic', definition: d, createdAt: NOW, createdBy: 'A', archived: false });
const vsession = (id: string, pid: string, status: ValidationSession['status'] = 'active'): ValidationSession => ({
  id,
  workspace: 'clinic',
  participantId: pid,
  operator: 'A',
  protocolKey: 'prot_a@1',
  protocol: def,
  protocolVersion: 1,
  device: { kind: 'usb', name: 'Stand', firmware: 'stand-1', format: 'imu-csv v1', rateHz: 100, simulated: false, sensors: [{ placement: 'upper_r', moduleId: '5A4C6311' }, { placement: 'fore_r', moduleId: '5A4C6333' }] },
  algorithmVersion: 'algo-1',
  appVersion: '0.1.0',
  startedAt: NOW,
  endedAt: null,
  status,
  calibration: { at: NOW, attempts: 1, poseDeg: { upper_r: 3, fore_r: 4 } },
  signal: null,
  notes: '',
  createdAt: NOW,
  updatedAt: NOW,
});
const trial = (id: string, sid: string, pid: string, rep: number, imu: number, ref: number | null, status: Trial['status'] = 'valid'): Trial => ({
  id,
  workspace: 'clinic',
  sessionId: sid,
  participantId: pid,
  set: 1,
  repetition: rep,
  pointId: 'p1',
  attempt: 1,
  status,
  imu: { angleDeg: imu, method: 'hold', tFrom: 1, tTo: 2, samples: 100, windowSdDeg: 0.2, windowMinDeg: imu - 0.3, windowMaxDeg: imu + 0.3, capturedAt: NOW },
  referenceDeg: ref,
  referenceAt: ref === null ? null : NOW,
  reason: '',
  notes: '',
  operator: 'A',
  createdAt: NOW,
  updatedAt: NOW,
});

let opSeq = 0;
const op = (entity: string, entityId: string, payload: unknown, baseRev: number | null = null, deleted = false) => ({ opId: `op-${++opSeq}`, entity, entityId, baseRev, payload, deleted });

async function team(api: Awaited<ReturnType<typeof testApi>>, name: string, email: string) {
  const c = api.client();
  const r = await c('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: name, email, password: 'correct horse battery', displayName: name } });
  expect(r.status).toBe(200);
  return c;
}

describe('migrations', () => {
  it('apply once, are idempotent, and never drop anything', async () => {
    const db = await testDb(); // already migrated
    expect(await migrate(db)).toEqual([]);
    const tables = await db.query<{ tablename: string }>("select tablename from pg_tables where tablename like 'nm_%' order by tablename");
    expect(tables.map((t) => t.tablename)).toEqual(
      expect.arrayContaining(['nm_participants', 'nm_protocol_versions', 'nm_trials', 'nm_validation_sessions', 'nm_audit_events', 'nm_raw_chunks', 'nm_sensor_configurations', 'nm_derived_metrics', 'nm_idempotency', 'nm_changes']),
    );
    const { MIGRATIONS } = await import('./migrations');
    for (const m of MIGRATIONS) expect(m.sql).not.toMatch(/\bdrop\s+(table|column|schema|index|trigger)\b|\btruncate\b/i);
  });
});

describe('auth', () => {
  it('bootstrap needs the setup code; login, me, logout', async () => {
    const api = await testApi();
    const c = api.client();
    expect((await c('/api/auth/bootstrap', { body: { setupCode: 'wrong-code-000', teamName: 'T', email: 'a@x.org', password: 'correct horse battery', displayName: 'A' } })).status).toBe(403);
    expect((await c('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: 'T', email: 'a@x.org', password: 'short', displayName: 'A' } })).json).toEqual({ error: 'password_too_short' });
    await team(api, 'Lab', 'lead@lab.org');
    const fresh = api.client();
    expect((await fresh('/api/auth/me')).status).toBe(401);
    expect((await fresh('/api/auth/login', { body: { email: 'lead@lab.org', password: 'nope nope nope' } })).status).toBe(401);
    expect((await fresh('/api/auth/login', { body: { email: 'LEAD@lab.org', password: 'correct horse battery' } })).status).toBe(200);
    const me = (await fresh('/api/auth/me')).json as { account: { role: string; teamName: string } };
    expect(me.account).toMatchObject({ role: 'admin', teamName: 'Lab' });
    expect((await fresh('/api/auth/logout', { body: {} })).status).toBe(200);
    expect((await fresh('/api/auth/me')).status).toBe(401);
    // Password is stored hashed only
    const rows = await api.db.query<{ password_hash: string }>('select password_hash from nm_users');
    expect(rows.every((r) => r.password_hash.startsWith('scrypt$') && !r.password_hash.includes('horse'))).toBe(true);
  });

  it('state-changing requests require the CSRF header', async () => {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    const r = await c('/api/sync/push', { body: { deviceId: 'd', ops: [] }, headers: { 'x-neuromove': '' } });
    expect(r.status).toBe(403);
  });

  it('login is rate limited', async () => {
    const api = await testApi();
    const c = api.client();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await c('/api/auth/login', { body: { email: 'x@y.org', password: 'wrong wrong wrong' } })).status;
    expect(last).toBe(429);
  });

  it('without a database the API says so (503), health reports it', async () => {
    const { handle } = await import('./http');
    const { memoryRedis } = await import('./redis');
    const deps = { db: null, redis: memoryRedis(), env: {} };
    expect((await handle(new Request('https://x/api/auth/me'), deps)).status).toBe(503);
    const h = await handle(new Request('https://x/api/index?path=health'), deps);
    expect(await h.json()).toMatchObject({ ok: false, database: 'not_configured', redis: 'not_configured' });
  });
});

describe('sync push / pull', () => {
  it('applies, deduplicates by opId, and never duplicates records', async () => {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    const o = op('participant', 'p_1', participant('p_1'));
    const r1 = (await c('/api/sync/push', { body: { deviceId: 'dev1', ops: [o] } })).json as PushResponse;
    expect(r1.results[0]).toMatchObject({ status: 'applied', rev: 1 });
    // The same op again (lost response, retry) → duplicate, nothing new
    const r2 = (await c('/api/sync/push', { body: { deviceId: 'dev1', ops: [o] } })).json as PushResponse;
    expect(r2.results[0]).toMatchObject({ status: 'duplicate', rev: 1 });
    // Same payload under a new opId → also a no-op
    const r3 = (await c('/api/sync/push', { body: { deviceId: 'dev1', ops: [op('participant', 'p_1', participant('p_1'), 1)] } })).json as PushResponse;
    expect(r3.results[0]!.status).toBe('duplicate');
    expect(await api.db.query('select * from nm_participants')).toHaveLength(1);
    expect(await api.db.query('select * from nm_changes')).toHaveLength(1);
    expect((await api.db.query<{ action: string }>("select action from nm_audit_events where entity = 'participant'")).map((x) => x.action)).toEqual(['create']);
  });

  it('detects conflicts instead of overwriting; resolves with the server rev', async () => {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    await c('/api/sync/push', { body: { deviceId: 'd1', ops: [op('participant', 'p_1', participant('p_1', 'P01'))] } });
    // Device 1 edits based on rev 1 → rev 2
    expect(((await c('/api/sync/push', { body: { deviceId: 'd1', ops: [op('participant', 'p_1', participant('p_1', 'P01-a'), 1)] } })).json as PushResponse).results[0]!.status).toBe('applied');
    // Device 2 still thinks rev 1 → conflict, server copy returned, nothing overwritten
    const conflict = ((await c('/api/sync/push', { body: { deviceId: 'd2', ops: [op('participant', 'p_1', participant('p_1', 'P01-b'), 1)] } })).json as PushResponse).results[0]!;
    expect(conflict).toMatchObject({ status: 'conflict', rev: 2 });
    expect((conflict.server as Patient).code).toBe('P01-a');
    // Operator chooses "keep mine": resend based on rev 2
    expect(((await c('/api/sync/push', { body: { deviceId: 'd2', ops: [op('participant', 'p_1', participant('p_1', 'P01-b'), 2)] } })).json as PushResponse).results[0]).toMatchObject({ status: 'applied', rev: 3 });
  });

  it('teams are isolated: another team cannot read, overwrite, or reference records', async () => {
    const api = await testApi();
    const a = await team(api, 'A', 'a@a.org');
    const b = await team(api, 'B', 'b@b.org');
    await a('/api/sync/push', { body: { deviceId: 'd', ops: [op('participant', 'p_a', participant('p_a'))] } });
    // Team B tries to overwrite team A's participant id
    const over = ((await b('/api/sync/push', { body: { deviceId: 'd', ops: [op('participant', 'p_a', participant('p_a', 'HIJACK'), 1)] } })).json as PushResponse).results[0]!;
    expect(over).toMatchObject({ status: 'rejected', error: 'forbidden' });
    // ...or attach a session to it
    const ref = ((await b('/api/sync/push', { body: { deviceId: 'd', ops: [op('protocol_version', 'prot_a@1', protocol()), op('validation_session', 'vs_b', vsession('vs_b', 'p_a'))] } })).json as PushResponse).results[1]!;
    expect(ref.status).toBe('rejected');
    // ...and pulls see nothing of team A
    const pb = (await b('/api/sync/pull?since=0')).json as PullResponse;
    expect(pb.changes.map((x) => x.entityId)).not.toContain('p_a');
    const pa = (await a('/api/sync/pull?since=0')).json as PullResponse;
    expect(pa.changes.map((x) => [x.entityId, (x.payload as Patient).code])).toEqual([['p_a', 'P01']]);
  });

  it('rejects demo / simulated data and invalid payloads', async () => {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    const r = (await c('/api/sync/push', {
      body: {
        deviceId: 'd',
        ops: [
          op('participant', 'p_demo', { ...participant('p_demo'), workspace: 'demo' }),
          op('participant', 'p_bad', { ...participant('p_bad'), code: '=HYPERLINK("x")' }),
          op('participant', 'p_1', participant('p_1')),
          op('protocol_version', 'prot_a@1', protocol()),
          op('validation_session', 'vs_sim', { ...vsession('vs_sim', 'p_1'), device: { ...vsession('x', 'p_1').device, kind: 'simulator', simulated: true } }),
        ],
      },
    })).json as PushResponse;
    expect(r.results.map((x) => x.error ?? x.status)).toEqual(['demo_data_not_accepted', 'invalid_payload', 'applied', 'applied', 'simulated_data_not_accepted']);
  });

  it('child before parent → retry (not lost); applied once the parent arrives', async () => {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    const early = ((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('note', 'n_1', { id: 'n_1', workspace: 'clinic', patientId: 'p_9', sessionId: null, createdAt: NOW, author: 'A', text: 'x', kind: 'clinical' })] } })).json as PushResponse).results[0]!;
    expect(early.status).toBe('retry');
    await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('participant', 'p_9', participant('p_9'))] } });
    const later = ((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('note', 'n_1', { id: 'n_1', workspace: 'clinic', patientId: 'p_9', sessionId: null, createdAt: NOW, author: 'A', text: 'x', kind: 'clinical' })] } })).json as PushResponse).results[0]!;
    expect(later.status).toBe('applied');
  });

  it('observers are read-only; measurement operators may only record trials', async () => {
    const api = await testApi();
    const admin = await team(api, 'Lab', 'a@lab.org');
    expect((await admin('/api/team/members', { body: { email: 'obs@lab.org', displayName: 'O', role: 'observer', password: 'observer password 1' } })).status).toBe(200);
    expect((await admin('/api/team/members', { body: { email: 'mo@lab.org', displayName: 'M', role: 'measurement_operator', password: 'measure password 1' } })).status).toBe(200);
    const obs = api.client();
    await obs('/api/auth/login', { body: { email: 'obs@lab.org', password: 'observer password 1' } });
    expect(((await obs('/api/sync/push', { body: { deviceId: 'd', ops: [op('participant', 'p_x', participant('p_x'))] } })).json as PushResponse).results[0]!.error).toBe('forbidden_role');
    expect((await obs('/api/team/members', { body: { email: 'z@lab.org', displayName: 'Z', role: 'admin', password: 'zzzzzzzzzzzz' } })).status).toBe(403);
    const mo = api.client();
    await mo('/api/auth/login', { body: { email: 'mo@lab.org', password: 'measure password 1' } });
    expect(((await mo('/api/sync/push', { body: { deviceId: 'd', ops: [op('participant', 'p_y', participant('p_y'))] } })).json as PushResponse).results[0]!.error).toBe('forbidden_role');
  });
});

describe('research records', () => {
  async function seeded() {
    const api = await testApi();
    const c = await team(api, 'Lab', 'a@lab.org');
    const r = (await c('/api/sync/push', {
      body: {
        deviceId: 'd',
        ops: [op('participant', 'p_1', participant('p_1')), op('protocol_version', 'prot_a@1', protocol()), op('validation_session', 'vs_1', vsession('vs_1', 'p_1'))],
      },
    })).json as PushResponse;
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied']);
    return { api, c };
  }

  it('protocol versions are immutable (old sessions keep their definition)', async () => {
    const { api, c } = await seeded();
    const changed = protocol(1, { ...def, repetitions: 99 });
    const r = ((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('protocol_version', 'prot_a@1', changed, 1)] } })).json as PushResponse).results[0]!;
    expect(r).toMatchObject({ status: 'rejected', error: 'immutable' });
    const row = await api.db.query<{ definition: { repetitions: number } }>("select definition from nm_protocol_versions where key = 'prot_a@1'");
    expect(row[0]!.definition.repetitions).toBe(3);
    // Archiving (envelope change) is allowed; a new version is a new row
    expect(((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('protocol_version', 'prot_a@1', { ...protocol(), archived: true }, 1), op('protocol_version', 'prot_a@2', protocol(2, changed.definition))] } })).json as PushResponse).results.map((x) => x.status)).toEqual(['applied', 'applied']);
    // Even a direct SQL update is refused by the trigger
    await expect(api.db.query("update nm_protocol_versions set definition = '{}'::jsonb where key = 'prot_a@1'")).rejects.toThrow(/immutable/);
  });

  it('trials store observed values; errors are generated by the database; metrics carry the algorithm version', async () => {
    const { api, c } = await seeded();
    const trials = [trial('t1', 'vs_1', 'p_1', 1, 92.4, 90), trial('t2', 'vs_1', 'p_1', 2, 88.1, 89), trial('t3', 'vs_1', 'p_1', 3, 95, 92)];
    const r = (await c('/api/sync/push', { body: { deviceId: 'd', ops: trials.map((t) => op('trial', t.id, t)) } })).json as PushResponse;
    expect(r.results.every((x) => x.status === 'applied')).toBe(true);
    const rows = await api.db.query<{ signed_error_deg: number; abs_error_deg: number }>('select signed_error_deg, abs_error_deg from nm_trials order by repetition');
    expect(rows.map((x) => Number(x.signed_error_deg.toFixed(6)))).toEqual([2.4, -0.9, 3]);
    // Completing the session computes derived metrics with the shared analytics code
    await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('validation_session', 'vs_1', { ...vsession('vs_1', 'p_1', 'completed'), endedAt: NOW }, 1)] } });
    const m = await api.db.query<{ metric: string; value: number; algorithm_version: string }>("select metric, value, algorithm_version from nm_derived_metrics where entity_id = 'vs_1'");
    const bias = m.find((x) => x.metric === 'bias_deg')!;
    expect(bias.value).toBeCloseTo((2.4 - 0.9 + 3) / 3, 10);
    expect(bias.algorithm_version).toMatch(/^stats-1\//);
    expect(m.find((x) => x.metric === 'n_valid_pairs')!.value).toBe(3);
    // Device registry, sensors and an immutable configuration row were derived from the session
    expect(await api.db.query('select * from nm_sensors')).toHaveLength(2);
    expect(await api.db.query('select * from nm_sensor_configurations')).toHaveLength(1);
    expect(await api.db.query("select * from nm_calibration_records where kind = 'stand_still'")).toHaveLength(1);
  });

  it('a valid trial without a reference value is refused', async () => {
    const { c } = await seeded();
    const bad = trial('t9', 'vs_1', 'p_1', 1, 90, null, 'valid');
    expect(((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('trial', 't9', bad)] } })).json as PushResponse).results[0]!.error).toBe('invalid_payload');
  });

  it('raw chunks: checksum verified, idempotent, never overwritten', async () => {
    const { c } = await seeded();
    const data = Buffer.from('# imu-csv v1\nseq,t,upper_r_ax\n1,0.01,123\n');
    const sha = createHash('sha256').update(data).digest('hex');
    const body = { recordingId: 'vs_1', chunkIndex: 0, frameCount: 1, encoding: 'imu-csv-v1+base64', sha256: sha, data: data.toString('base64') };
    expect((await c('/api/raw', { body })).json).toEqual({ ok: true, duplicate: false });
    expect((await c('/api/raw', { body })).json).toEqual({ ok: true, duplicate: true });
    const other = Buffer.from('different');
    expect((await c('/api/raw', { body: { ...body, data: other.toString('base64'), sha256: createHash('sha256').update(other).digest('hex') } })).status).toBe(409);
    expect((await c('/api/raw', { body: { ...body, sha256: '0'.repeat(64) } })).json).toEqual({ error: 'checksum_mismatch' });
    expect(((await c('/api/raw?recordingId=vs_1')).json as { chunks: unknown[] }).chunks).toHaveLength(1);
  });

  it('soft delete: the row stays, pull reports a tombstone', async () => {
    const { api, c } = await seeded();
    const n = { id: 'n_1', workspace: 'clinic', patientId: 'p_1', sessionId: null, createdAt: NOW, author: 'A', text: 'x', kind: 'clinical' };
    await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('note', 'n_1', n)] } });
    const del = ((await c('/api/sync/push', { body: { deviceId: 'd', ops: [op('note', 'n_1', null, 1, true)] } })).json as PushResponse).results[0]!;
    expect(del).toMatchObject({ status: 'applied', rev: 2 });
    expect(await api.db.query('select * from nm_notes where deleted_at is not null')).toHaveLength(1);
    const pulled = ((await c('/api/sync/pull?since=0')).json as PullResponse).changes.find((x) => x.entityId === 'n_1')!;
    expect(pulled).toMatchObject({ deleted: true, payload: null, rev: 2 });
  });
});

describe('API bundle', () => {
  it('api/index.js is up to date with server/ and src/', async () => {
    const { readFileSync } = await import('node:fs');
    // @ts-expect-error — plain .mjs build script without type declarations
    const { bundleApi } = await import('../scripts/build-api.mjs');
    expect(readFileSync(new URL('../api/index.js', import.meta.url), 'utf8')).toBe(await bundleApi());
  }, 60_000);
});
