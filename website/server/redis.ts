// Upstash Redis over its REST API (works in serverless; no TCP connection to keep alive).
//
// Responsibilities — all OPTIONAL accelerators, never the record of anything:
//   - rate limiting (login, bootstrap, sync push) — fixed window INCR + EXPIRE
//   - team change cursor cache: lets idle clients poll /api/sync/pull without touching PostgreSQL
//   - realtime notification: PUBLISH nm:team:<id> after a commit (best effort, may be lost)
// PostgreSQL is written FIRST; Redis is touched only after the commit, and every Redis failure is
// swallowed: the request still succeeds and data stays correct (at worst a client sees a change up
// to CURSOR_TTL_S later). Without credentials everything here is a no-op / in-memory fallback.
//
// Not used for: idempotency (PostgreSQL nm_idempotency is the ledger, inside the same transaction)
// and locks (PostgreSQL row locks / advisory locks are sufficient and transactional).

export interface Redis {
  readonly configured: boolean;
  /** INCR key, set TTL on first hit; returns the new count, or null when Redis is unavailable. */
  hit(key: string, ttlSec: number): Promise<number | null>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
}

export const CURSOR_TTL_S = 30;

export function redisFromEnv(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Redis {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return memoryRedis();
  const call = async (body: unknown[][]): Promise<unknown[] | null> => {
    try {
      const res = await fetcher(`${url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: unknown; error?: string }[];
      return json.map((r) => (r.error ? null : r.result));
    } catch {
      return null;
    }
  };
  return {
    configured: true,
    async hit(key, ttl) {
      const r = await call([
        ['INCR', key],
        ['EXPIRE', key, ttl, 'NX'],
      ]);
      const n = r?.[0];
      return typeof n === 'number' ? n : null;
    },
    async get(key) {
      const r = await call([['GET', key]]);
      return typeof r?.[0] === 'string' ? (r[0] as string) : null;
    },
    async set(key, value, ttl) {
      await call([['SET', key, value, 'EX', ttl]]);
    },
    async publish(channel, message) {
      await call([['PUBLISH', channel, message]]);
    },
  };
}

/**
 * Fallback without Upstash: per-instance memory. Rate limits then hold per serverless instance only
 * (weaker, documented); the cursor cache is local; publish is a no-op.
 */
export function memoryRedis(): Redis {
  const store = new Map<string, { v: string; until: number }>();
  const alive = (k: string) => {
    const e = store.get(k);
    if (e && e.until < Date.now()) store.delete(k);
    return store.get(k);
  };
  return {
    configured: false,
    async hit(key, ttl) {
      const e = alive(key);
      const n = (e ? Number(e.v) : 0) + 1;
      store.set(key, { v: String(n), until: e?.until ?? Date.now() + ttl * 1000 });
      return n;
    },
    async get(key) {
      return alive(key)?.v ?? null;
    },
    async set(key, value, ttl) {
      store.set(key, { v: value, until: Date.now() + ttl * 1000 });
    },
    async publish() {
      /* no subscribers without Redis */
    },
  };
}
