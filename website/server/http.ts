// HTTP routing for /api/*. Web-standard Request → Response, so the same code runs on Vercel
// (api/index.js) and in tests (in-process, against PGlite).
//
// Security baseline for every route:
//   - state-changing requests need `X-NeuroMove: 1` (a custom header forces a CORS preflight, which
//     this API never grants) + SameSite=Strict cookie  → no cross-site request forgery
//   - JSON bodies only, ≤ 4 MB
//   - authorization from the server-side session (team, role); client-sent team ids are ignored
//   - rate limits on login, bootstrap, push (Upstash when configured, else per instance)
//   - no-store caching, nosniff

import { createSession, clearCookie, hashPassword, passwordProblem, principalFromToken, readCookie, revokeSession, ROLES, safeEqual, sessionCookie, verifyPassword, type Principal, type Role } from './auth';
import type { Db } from './db';
import { pendingMigrations } from './migrate';
import type { Redis } from './redis';
import { pull, push, type IncomingOp } from './sync';
import { putRawChunk, listRawChunks } from './storage';
import { PUSH_BATCH } from '../src/sync/types';

export interface Deps {
  db: Db | null;
  redis: Redis;
  env: Record<string, string | undefined>;
}

const MAX_BODY = 4 * 1024 * 1024;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

const err = (status: number, error: string) => json(status, { error });

function routeOf(req: Request): string {
  const url = new URL(req.url);
  // vercel.json rewrites /api/<path> → /api/index?path=<path>; tests call /api/<path> directly
  const p = url.searchParams.get('path');
  return p !== null ? p.replace(/^\/+|\/+$/g, '') : url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

async function body<T>(req: Request): Promise<T | Response> {
  if (req.headers.get('x-neuromove') !== '1') return err(403, 'csrf_header_required');
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return err(415, 'json_required');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return err(413, 'body_too_large');
  const text = await req.text();
  if (text.length > MAX_BODY) return err(413, 'body_too_large');
  try {
    return JSON.parse(text || '{}') as T;
  } catch {
    return err(400, 'invalid_json');
  }
}

async function limited(redis: Redis, key: string, max: number, windowSec: number): Promise<boolean> {
  const n = await redis.hit(`nm:rl:${key}`, windowSec);
  return n !== null && n > max;
}

const account = (p: Principal) => ({ userId: p.userId, email: p.email, displayName: p.displayName, teamId: p.teamId, teamName: p.teamName, role: p.role });
const isEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const route = routeOf(req);
  const method = req.method.toUpperCase();
  const secure = new URL(req.url).protocol === 'https:';
  const { db, redis, env } = deps;

  if (route === 'health' && method === 'GET') {
    let dbState: 'not_configured' | 'ok' | 'error' = 'not_configured';
    let pending: string[] = [];
    if (db) {
      try {
        await db.query('select 1');
        dbState = 'ok';
        pending = await pendingMigrations(db);
      } catch {
        dbState = 'error';
      }
    }
    return json(200, { ok: dbState === 'ok' && pending.length === 0, database: dbState, pendingMigrations: pending, redis: redis.configured ? 'configured' : 'not_configured', signup: env.NEUROMOVE_SETUP_CODE ? 'setup_code' : 'disabled' });
  }

  if (!db) return err(503, 'database_not_configured');
  const token = readCookie(req.headers.get('cookie'));

  // ── Auth ───────────────────────────────────────────────────────────────────────────────────
  if (route === 'auth/bootstrap' && method === 'POST') {
    const b = await body<{ setupCode?: string; teamName?: string; email?: string; password?: string; displayName?: string }>(req);
    if (b instanceof Response) return b;
    if (await limited(redis, `boot:${clientIp(req)}`, 5, 3600)) return err(429, 'rate_limited');
    const code = env.NEUROMOVE_SETUP_CODE;
    if (!code || code.length < 12) return err(403, 'setup_disabled');
    if (typeof b.setupCode !== 'string' || !safeEqual(b.setupCode, code)) return err(403, 'invalid_setup_code');
    const email = b.email?.trim().toLowerCase();
    if (!isEmail(email) || typeof b.password !== 'string' || !b.teamName?.trim() || !b.displayName?.trim()) return err(400, 'invalid_input');
    const pw = passwordProblem(b.password);
    if (pw) return err(400, pw);
    const hash = await hashPassword(b.password);
    try {
      const p = await db.tx(async (t) => {
        const exists = await t.query('select 1 from nm_users where email = $1', [email]);
        if (exists.length) throw new Error('email_taken');
        const team = (await t.query<{ id: string }>('insert into nm_teams (name) values ($1) returning id', [b.teamName!.trim().slice(0, 200)]))[0]!;
        const user = (await t.query<{ id: string }>('insert into nm_users (email, display_name, password_hash) values ($1, $2, $3) returning id', [email, b.displayName!.trim().slice(0, 200), hash]))[0]!;
        await t.query("insert into nm_memberships (team_id, user_id, role) values ($1, $2, 'admin')", [team.id, user.id]);
        await t.query("insert into nm_audit_events (team_id, user_id, action, details) values ($1, $2, 'team_bootstrap', '{}'::jsonb)", [team.id, user.id]);
        return { userId: user.id, email, displayName: b.displayName!.trim(), teamId: team.id, teamName: b.teamName!.trim(), role: 'admin' as Role };
      });
      const s = await createSession(db, p.userId, p.teamId);
      return json(200, { account: account(p) }, { 'Set-Cookie': sessionCookie(s.token, s.expires, secure) });
    } catch (e) {
      if (e instanceof Error && e.message === 'email_taken') return err(409, 'email_taken');
      throw e;
    }
  }

  if (route === 'auth/login' && method === 'POST') {
    const b = await body<{ email?: string; password?: string; teamId?: string }>(req);
    if (b instanceof Response) return b;
    const email = b.email?.trim().toLowerCase() ?? '';
    if (await limited(redis, `login:${clientIp(req)}:${email}`, 10, 300)) return err(429, 'rate_limited');
    const u = (await db.query<{ id: string; password_hash: string }>('select id, password_hash from nm_users where email = $1 and disabled_at is null', [email]))[0];
    // Same work whether or not the user exists (no account enumeration by timing)
    const ok = u ? await verifyPassword(b.password ?? '', u.password_hash) : (await verifyPassword(b.password ?? '', 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==')) && false;
    if (!u || !ok) {
      await db.query("insert into nm_audit_events (action, details) values ('login_failed', $1)", [{ email }]);
      return err(401, 'invalid_credentials');
    }
    const teams = await db.query<{ team_id: string }>('select team_id from nm_memberships where user_id = $1 order by created_at', [u.id]);
    const teamId = teams.find((x) => x.team_id === b.teamId)?.team_id ?? teams[0]?.team_id;
    if (!teamId) return err(403, 'no_team');
    const s = await createSession(db, u.id, teamId);
    const p = await principalFromToken(db, s.token);
    await db.query("insert into nm_audit_events (team_id, user_id, action) values ($1, $2, 'login')", [teamId, u.id]);
    return json(200, { account: account(p!) }, { 'Set-Cookie': sessionCookie(s.token, s.expires, secure) });
  }

  const p = await principalFromToken(db, token);

  if (route === 'auth/logout' && method === 'POST') {
    const b = await body(req);
    if (b instanceof Response) return b;
    if (token) await revokeSession(db, token);
    return json(200, { ok: true }, { 'Set-Cookie': clearCookie(secure) });
  }

  if (!p) return err(401, 'unauthenticated');

  if (route === 'auth/me' && method === 'GET') return json(200, { account: account(p) });

  // ── Team ───────────────────────────────────────────────────────────────────────────────────
  if (route === 'team/members' && method === 'GET') {
    const rows = await db.query('select u.id, u.email, u.display_name, m.role, m.created_at from nm_memberships m join nm_users u on u.id = m.user_id where m.team_id = $1 order by m.created_at', [p.teamId]);
    return json(200, { members: rows });
  }
  if (route === 'team/members' && method === 'POST') {
    if (p.role !== 'admin') return err(403, 'admin_only');
    const b = await body<{ email?: string; displayName?: string; role?: Role; password?: string }>(req);
    if (b instanceof Response) return b;
    const email = b.email?.trim().toLowerCase();
    if (!isEmail(email) || !b.role || !ROLES.includes(b.role) || !b.displayName?.trim()) return err(400, 'invalid_input');
    const existing = (await db.query<{ id: string }>('select id from nm_users where email = $1', [email]))[0];
    let userId = existing?.id;
    if (!userId) {
      if (typeof b.password !== 'string') return err(400, 'password_required');
      const pw = passwordProblem(b.password);
      if (pw) return err(400, pw);
      userId = (await db.query<{ id: string }>('insert into nm_users (email, display_name, password_hash) values ($1, $2, $3) returning id', [email, b.displayName.trim(), await hashPassword(b.password)]))[0]!.id;
    }
    await db.query('insert into nm_memberships (team_id, user_id, role) values ($1, $2, $3) on conflict (team_id, user_id) do update set role = $3', [p.teamId, userId, b.role]);
    await db.query("insert into nm_audit_events (team_id, user_id, action, details) values ($1, $2, 'member_upsert', $3)", [p.teamId, p.userId, { email, role: b.role }]);
    return json(200, { ok: true });
  }

  // ── Sync ───────────────────────────────────────────────────────────────────────────────────
  if (route === 'sync/push' && method === 'POST') {
    const b = await body<{ deviceId?: string; ops?: IncomingOp[] }>(req);
    if (b instanceof Response) return b;
    if (await limited(redis, `push:${p.userId}`, 240, 60)) return err(429, 'rate_limited');
    if (!Array.isArray(b.ops) || b.ops.length > PUSH_BATCH || typeof b.deviceId !== 'string' || b.deviceId.length > 80) return err(400, 'invalid_input');
    for (const op of b.ops) if (!op || typeof op.opId !== 'string' || op.opId.length > 80 || typeof op.entityId !== 'string' || op.entityId.length > 120 || typeof op.deleted !== 'boolean' || !(op.baseRev === null || Number.isInteger(op.baseRev))) return err(400, 'invalid_op');
    return json(200, await push(db, redis, p, b.deviceId, b.ops));
  }
  if (route === 'sync/pull' && method === 'GET') {
    const since = Number(new URL(req.url).searchParams.get('since') ?? '0');
    if (!Number.isSafeInteger(since) || since < 0) return err(400, 'invalid_cursor');
    return json(200, await pull(db, redis, p, since));
  }

  // ── Raw recordings (chunked, idempotent) ───────────────────────────────────────────────────
  if (route === 'raw' && method === 'POST') {
    if (p.role === 'observer') return err(403, 'forbidden_role');
    const b = await body<{ recordingId?: string; chunkIndex?: number; frameCount?: number; encoding?: string; sha256?: string; data?: string }>(req);
    if (b instanceof Response) return b;
    const r = await putRawChunk(db, env, p, b);
    return 'error' in r ? err(r.status, r.error) : json(200, r);
  }
  if (route === 'raw' && method === 'GET') {
    const id = new URL(req.url).searchParams.get('recordingId') ?? '';
    return json(200, { chunks: await listRawChunks(db, p, id) });
  }

  // ── Audit trail (read-only) ────────────────────────────────────────────────────────────────
  if (route === 'audit' && method === 'GET') {
    if (p.role === 'observer') return err(403, 'forbidden_role');
    const q = new URL(req.url).searchParams;
    const rows = await db.query(
      `select a.at, a.action, a.entity, a.entity_id, a.rev, a.device_id, u.email from nm_audit_events a left join nm_users u on u.id = a.user_id
        where a.team_id = $1 and ($2 = '' or a.entity = $2) and ($3 = '' or a.entity_id = $3) order by a.at desc limit 200`,
      [p.teamId, q.get('entity') ?? '', q.get('id') ?? ''],
    );
    return json(200, { events: rows });
  }

  // ── Dataset manifests (export registry; the files themselves stay with the user) ───────────
  if (route === 'datasets' && method === 'POST') {
    const b = await body<{ id?: string; filter?: unknown; schemaVersion?: number; rowCount?: number }>(req);
    if (b instanceof Response) return b;
    if (typeof b.id !== 'string' || !/^ds-[\w-]{6,80}$/.test(b.id) || !Number.isInteger(b.schemaVersion) || !Number.isInteger(b.rowCount)) return err(400, 'invalid_input');
    // A dataset id is written once; an existing id is never replaced
    await db.query('insert into nm_datasets (id, team_id, created_by, filter, schema_version, row_count) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing', [b.id, p.teamId, p.userId, b.filter ?? {}, b.schemaVersion, b.rowCount]);
    return json(200, { ok: true });
  }

  return err(404, 'not_found');
}
