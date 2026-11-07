// Test harness: a real PostgreSQL (PGlite, WASM) behind the same Db interface as production.
// Test data is synthetic and lives in an in-memory database that disappears after the test run —
// it can never mix with real experimental data.

import { PGlite } from '@electric-sql/pglite';
import type { Db } from './db';
import { handle, type Deps } from './http';
import { migrate } from './migrate';
import { memoryRedis, type Redis } from './redis';

type Q = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; exec(sql: string): Promise<unknown> };

function wrap(q: Q, root: PGlite | null): Db {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return (await q.query<T>(sql, params as unknown[])).rows;
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      if (!root) {
        // Nested: emulate a savepoint so a failing inner block does not poison the outer transaction
        await q.exec('savepoint nm_sp');
        try {
          const r = await fn(wrap(q, null));
          await q.exec('release savepoint nm_sp');
          return r;
        } catch (e) {
          await q.exec('rollback to savepoint nm_sp');
          throw e;
        }
      }
      return root.transaction((t) => fn(wrap(t as unknown as Q, null)));
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  };
}

export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db = wrap(pg as unknown as Q, pg);
  await migrate(db);
  return db;
}

export interface TestApi {
  db: Db;
  redis: Redis;
  deps: Deps;
  /** Call the API like a browser on https://app.test, with its own cookie jar. */
  client(): (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; json: unknown }>;
}

export async function testApi(env: Record<string, string> = { NEUROMOVE_SETUP_CODE: 'test-setup-code-123' }): Promise<TestApi> {
  const db = await testDb();
  const redis = memoryRedis();
  const deps: Deps = { db, redis, env };
  return {
    db,
    redis,
    deps,
    client() {
      let cookie = '';
      return async (path, init) => {
        const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
        const headers: Record<string, string> = { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-neuromove': '1' } : {}), ...(init?.headers ?? {}) };
        const res = await handle(new Request(`https://app.test${path}`, { method, headers, ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), deps);
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
        return { status: res.status, json: await res.json().catch(() => null) };
      };
    },
  };
}
