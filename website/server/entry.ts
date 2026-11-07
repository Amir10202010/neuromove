// Vercel Function entry (bundled by scripts/build-api.mjs into api/index.js).
// vercel.json rewrites /api/<path> → /api/index?path=<path>; this file exports one handler per method.

import { databaseFromEnv } from './db';
import { handle } from './http';
import { migrate } from './migrate';
import { redisFromEnv } from './redis';

async function serve(request: Request): Promise<Response> {
  try {
    const db = await databaseFromEnv();
    return await handle(request, { db, redis: redisFromEnv(), env: process.env });
  } catch (e) {
    // Never leak internals (SQL, stack) to the client; the log has the details
    console.error('[api] unhandled', e);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;

/** Used by scripts/db-migrate.mjs (npm run db:migrate). */
export async function runMigrations(): Promise<string[]> {
  const db = await databaseFromEnv();
  if (!db) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set');
  return migrate(db);
}
