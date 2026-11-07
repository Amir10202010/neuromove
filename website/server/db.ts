// Database access: one tiny interface, two implementations.
//   - production: `postgres` (porsager) against DATABASE_URL (Supabase, Neon, any PostgreSQL ≥ 14)
//   - tests: PGlite (real PostgreSQL compiled to WASM), see server/testing.ts
// All SQL is parameterised ($1, $2 …). No string interpolation of values anywhere.

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run `fn` in a transaction; rolls back when it throws. Nested calls use savepoints. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Run a multi-statement script (migrations only). */
  exec(sql: string): Promise<void>;
}

export class SqlError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

export function sqlCode(e: unknown): string | undefined {
  if (e instanceof SqlError) return e.code;
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

type PostgresSql = {
  unsafe(sql: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (sql: PostgresSql) => Promise<T>): Promise<T>;
  savepoint<T>(fn: (sql: PostgresSql) => Promise<T>): Promise<T>;
};

function wrap(sql: PostgresSql, inTx: boolean): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      return (await sql.unsafe(text, params as unknown[])) as T[];
    },
    async tx<T>(fn: (db: Db) => Promise<T>) {
      return inTx ? sql.savepoint((s) => fn(wrap(s, true))) : sql.begin((s) => fn(wrap(s, true)));
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
  };
}

let shared: Db | null = null;

/** Connection from DATABASE_URL (or POSTGRES_URL, set by the Vercel/Neon/Supabase integrations). */
export async function databaseFromEnv(env: Record<string, string | undefined> = process.env): Promise<Db | null> {
  if (shared) return shared;
  const url = env.DATABASE_URL || env.POSTGRES_URL;
  if (!url) return null;
  const { default: postgres } = await import('postgres');
  // Serverless: few connections per instance; use the provider's pooled URL (pgbouncer / Supavisor).
  const sql = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => undefined });
  shared = wrap(sql as unknown as PostgresSql, false);
  return shared;
}
