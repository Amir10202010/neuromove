// Migration runner: applies MIGRATIONS in order, each in its own transaction, recording what ran.
// A transaction-scoped advisory lock serialises concurrent runs (two deploys at once).
// Never drops or rewrites anything; re-running is a no-op.

import type { Db } from './db';
import { MIGRATIONS, type Migration } from './migrations';

const LOCK_KEY = 4_217_661_013; // arbitrary, constant

export async function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  await db.exec(`create table if not exists nm_schema_migrations (id text primary key, applied_at timestamptz not null default now())`);
  const applied: string[] = [];
  for (const m of migrations) {
    const did = await db.tx(async (t) => {
      await t.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const done = await t.query('select 1 from nm_schema_migrations where id = $1', [m.id]);
      if (done.length) return false;
      await t.exec(m.sql);
      await t.query('insert into nm_schema_migrations (id) values ($1)', [m.id]);
      return true;
    });
    if (did) applied.push(m.id);
  }
  return applied;
}

export async function pendingMigrations(db: Db): Promise<string[]> {
  try {
    const rows = await db.query<{ id: string }>('select id from nm_schema_migrations');
    const done = new Set(rows.map((r) => r.id));
    return MIGRATIONS.map((m) => m.id).filter((id) => !done.has(id));
  } catch {
    return MIGRATIONS.map((m) => m.id);
  }
}
