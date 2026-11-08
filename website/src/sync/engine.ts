// Sync engine: IndexedDB outbox ⇄ /api/sync (PostgreSQL is the authoritative store when enabled).
//
// Guarantees
//  - A record is "synchronised" only after the server acknowledged its exact op (applied | duplicate).
//  - Every op carries an idempotency key (opId); retries after a timeout can never create duplicates.
//  - Failures back off exponentially (2 s … 5 min, jittered); "Sync now" retries immediately.
//  - Conflicts (record changed on the server since this device last saw it) are never auto-resolved:
//    the op is parked in state 'conflict' with the server's version until the operator chooses.
//  - Closing the browser loses nothing: the outbox lives in IndexedDB and resumes on next start.
//
// Transport is injectable (tests run the engine against the real server handler in-process).

import { create } from 'zustand';
import type { DataStorage } from '../data/db';
import { newId } from '../lib/ids';
import { backoffMs, rememberRev } from './ops';
import { uploadRaw, type RawSource } from './raw';
import { PUSH_BATCH, type OutboxOp, type PullChange, type PullResponse, type PushResponse, type SyncEntity } from './types';

export type Transport = (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;

export const fetchTransport: Transport = async (path, init) => {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-NeuroMove': '1' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json };
};

export interface Account {
  userId: string;
  email: string;
  displayName: string;
  teamId: string;
  teamName: string;
  role: 'admin' | 'session_operator' | 'measurement_operator' | 'observer' | 'caregiver';
  /** Caregiver accounts: the children this account is linked to (from the server). */
  participantIds?: string[];
}

export interface SyncConfig {
  enabled: boolean;
  deviceId: string;
  cursor: number;
  lastSyncAt: string | null;
}

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'unauthenticated' | 'unavailable' | 'error';

/** Applies a pulled server change to local storage + in-memory state. Provided by the app at start. */
export type RemoteApplier = (change: PullChange) => Promise<void>;

interface SyncState {
  config: SyncConfig;
  account: Account | null;
  phase: SyncPhase;
  pending: number;
  conflicts: OutboxOp[];
  rejected: OutboxOp[];
  lastError: string | null;
  lastSyncAt: string | null;
}

interface SyncActions {
  start(storage: DataStorage, apply: RemoteApplier, saved: Partial<SyncConfig> | undefined, persist: (c: SyncConfig) => Promise<void>): Promise<void>;
  refreshCounts(): Promise<void>;
  checkSession(): Promise<void>;
  login(email: string, password: string): Promise<string | null>;
  bootstrap(args: { setupCode: string; teamName: string; email: string; password: string; displayName: string }): Promise<string | null>;
  logout(): Promise<void>;
  setEnabled(v: boolean): Promise<void>;
  syncNow(): Promise<void>;
  resolveConflict(opId: string, choice: 'mine' | 'server'): Promise<void>;
  retryRejected(opId: string): Promise<void>;
  stop(): void;
}

let transport: Transport = fetchTransport;
let storage: DataStorage | null = null;
let applyRemote: RemoteApplier = async () => undefined;
let persistConfig: (c: SyncConfig) => Promise<void> = async () => undefined;
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let rawSource: RawSource | null = null;

/** The app registers where raw recordings come from (clinic sessions with raw frames). */
export function setRawSource(s: RawSource | null): void {
  rawSource = s;
}
let again = false;
let now: () => number = () => Date.now();

/** Tests: in-process transport and a controllable clock. */
export function configureSync(o: { transport?: Transport; clock?: () => number }): void {
  if (o.transport) transport = o.transport;
  if (o.clock) now = o.clock;
}

const INTERVAL_MS = 15_000;

export const useSyncStore = create<SyncState & SyncActions>((set, get) => {
  const save = async (patch: Partial<SyncConfig>) => {
    const config = { ...get().config, ...patch };
    set({ config });
    await persistConfig(config);
  };

  async function pushOnce(): Promise<boolean> {
    if (!storage) return false;
    const all = (await storage.listOutbox()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const due = all.filter((o) => o.state === 'pending' && o.nextAttemptAt <= now()).slice(0, PUSH_BATCH);
    if (!due.length) return false;
    let res: { status: number; json: unknown };
    try {
      res = await transport('/api/sync/push', { method: 'POST', body: { deviceId: get().config.deviceId, ops: due.map(({ opId, entity, entityId, baseRev, payload, deleted }) => ({ opId, entity, entityId, baseRev, payload, deleted })) } });
    } catch (e) {
      await backoff(due, e instanceof Error ? e.message : 'network error');
      set({ phase: 'offline', lastError: 'network' });
      return false;
    }
    if (res.status === 401) {
      set({ phase: 'unauthenticated', account: null });
      return false;
    }
    if (res.status === 503) {
      set({ phase: 'unavailable', lastError: 'server not configured' });
      await backoff(due, 'server unavailable');
      return false;
    }
    if (res.status !== 200) {
      await backoff(due, `HTTP ${res.status}`);
      set({ phase: 'error', lastError: `HTTP ${res.status}` });
      return false;
    }
    const body = res.json as PushResponse;
    const done: string[] = [];
    const states = [];
    for (const r of body.results) {
      const op = due.find((o) => o.opId === r.opId);
      if (!op) continue;
      if (r.status === 'applied' || r.status === 'duplicate') {
        done.push(op.opId);
        if (r.rev !== undefined) {
          rememberRev(op.entity, op.entityId, r.rev);
          states.push({ key: `${op.entity}:${op.entityId}`, serverRev: r.rev, syncedAt: new Date(now()).toISOString() });
        }
      } else if (r.status === 'conflict') {
        await storage.updateOp({ ...op, state: 'conflict', lastError: 'conflict', server: { rev: r.rev ?? 0, payload: r.server ?? null } });
      } else if (r.status === 'rejected') {
        await storage.updateOp({ ...op, state: 'rejected', lastError: r.error ?? 'rejected' });
      } else {
        await backoff([op], r.error ?? 'retry');
      }
    }
    if (states.length) await storage.putSyncState(states);
    if (done.length) await storage.removeOps(done);
    return done.length > 0;
  }

  async function backoff(ops: OutboxOp[], error: string) {
    if (!storage) return;
    for (const op of ops) {
      const attempts = op.attempts + 1;
      await storage.updateOp({ ...op, attempts, nextAttemptAt: now() + backoffMs(attempts), lastError: error });
    }
  }

  async function pullOnce(): Promise<boolean> {
    if (!storage) return false;
    let res: { status: number; json: unknown };
    try {
      res = await transport(`/api/sync/pull?since=${get().config.cursor}`);
    } catch {
      set({ phase: 'offline' });
      return false;
    }
    if (res.status === 401) {
      set({ phase: 'unauthenticated', account: null });
      return false;
    }
    if (res.status !== 200) return false;
    const body = res.json as PullResponse;
    const outbox = await storage.listOutbox();
    const local = new Set(outbox.map((o) => `${o.entity}:${o.entityId}`));
    const states = [];
    for (const ch of body.changes) {
      rememberRev(ch.entity, ch.entityId, ch.rev);
      // A local unsent edit wins locally; the server will judge it on push (conflict if needed)
      if (!local.has(`${ch.entity}:${ch.entityId}`)) await applyRemote(ch);
      states.push({ key: `${ch.entity}:${ch.entityId}`, serverRev: ch.rev, syncedAt: new Date(now()).toISOString() });
    }
    if (states.length) await storage.putSyncState(states);
    await save({ cursor: body.cursor });
    return body.more;
  }

  async function cycle(): Promise<void> {
    if (!get().config.enabled || !storage || !get().account) return;
    set({ phase: 'syncing' });
    try {
      // Push first (local edits are the ones at risk), then pull
      for (let i = 0; i < 20 && (await pushOnce()); i++);
      if (get().phase === 'syncing') for (let i = 0; i < 20 && (await pullOnce()); i++);
      // Raw recordings after their session records (server needs the session first); failures retry next cycle
      if (get().phase === 'syncing' && rawSource) {
        const acked = new Set((await storage.getSyncState()).map((r) => r.key));
        await uploadRaw(storage, { sessions: () => rawSource!.sessions().filter((id) => acked.has(`rehab_session:${id}`)), get: rawSource.get }, transport);
      }
      if (get().phase === 'syncing') {
        const at = new Date(now()).toISOString();
        set({ phase: 'idle', lastError: null, lastSyncAt: at });
        await save({ lastSyncAt: at });
      }
    } catch (e) {
      set({ phase: 'error', lastError: e instanceof Error ? e.message : String(e) });
    }
    await get().refreshCounts();
  }

  // A request that arrives while a cycle is running must not be answered by that (older) cycle:
  // it may have listed the outbox before the newest write. Run one more pass after it.
  const runCycle = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await cycle();
      } while (again);
    })().finally(() => (running = null));
    return running;
  };

  return {
    config: { enabled: false, deviceId: '', cursor: 0, lastSyncAt: null },
    account: null,
    phase: 'off',
    pending: 0,
    conflicts: [],
    rejected: [],
    lastError: null,
    lastSyncAt: null,

    async start(st, apply, saved, persist) {
      storage = st;
      applyRemote = apply;
      persistConfig = persist;
      const config: SyncConfig = { enabled: saved?.enabled ?? false, deviceId: saved?.deviceId || newId('dev'), cursor: saved?.cursor ?? 0, lastSyncAt: saved?.lastSyncAt ?? null };
      set({ config, lastSyncAt: config.lastSyncAt, phase: config.enabled ? 'idle' : 'off' });
      if (!saved?.deviceId) await persist(config);
      await get().refreshCounts();
      if (config.enabled) {
        await get().checkSession();
        get().stop();
        timer = setInterval(() => void runCycle(), INTERVAL_MS);
        if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
        void runCycle();
      }
    },

    async refreshCounts() {
      if (!storage) return;
      const all = await storage.listOutbox();
      set({ pending: all.filter((o) => o.state === 'pending').length, conflicts: all.filter((o) => o.state === 'conflict'), rejected: all.filter((o) => o.state === 'rejected') });
    },

    async checkSession() {
      try {
        const r = await transport('/api/auth/me');
        if (r.status === 200) set({ account: (r.json as { account: Account }).account, phase: get().config.enabled ? 'idle' : 'off' });
        else if (r.status === 401) set({ account: null, phase: get().config.enabled ? 'unauthenticated' : 'off' });
        else set({ phase: get().config.enabled ? 'unavailable' : 'off' });
      } catch {
        set({ phase: get().config.enabled ? 'offline' : 'off' });
      }
    },

    async login(email, password) {
      try {
        const r = await transport('/api/auth/login', { method: 'POST', body: { email, password } });
        if (r.status === 200) {
          set({ account: (r.json as { account: Account }).account });
          void runCycle();
          return null;
        }
        return (r.json as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
      } catch {
        return 'network';
      }
    },

    async bootstrap(args) {
      try {
        const r = await transport('/api/auth/bootstrap', { method: 'POST', body: args });
        if (r.status === 200) {
          set({ account: (r.json as { account: Account }).account });
          return null;
        }
        return (r.json as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
      } catch {
        return 'network';
      }
    },

    async logout() {
      try {
        await transport('/api/auth/logout', { method: 'POST', body: {} });
      } catch {
        /* the cookie expires anyway */
      }
      set({ account: null, phase: get().config.enabled ? 'unauthenticated' : 'off' });
    },

    async setEnabled(v) {
      await save({ enabled: v });
      if (!v) {
        get().stop();
        set({ phase: 'off' });
        return;
      }
      set({ phase: 'idle' });
      await get().checkSession();
      get().stop();
      timer = setInterval(() => void runCycle(), INTERVAL_MS);
      if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
      void runCycle();
    },

    async syncNow() {
      if (!storage) return;
      // Manual retry: everything pending becomes due now
      for (const op of await storage.listOutbox()) if (op.state === 'pending' && op.nextAttemptAt > now()) await storage.updateOp({ ...op, nextAttemptAt: 0 });
      await runCycle();
    },

    async resolveConflict(opId, choice) {
      if (!storage) return;
      const op = (await storage.listOutbox()).find((o) => o.opId === opId);
      if (!op || op.state !== 'conflict') return;
      if (choice === 'server') {
        if (op.server) await applyRemote({ seq: 0, entity: op.entity, entityId: op.entityId, rev: op.server.rev, payload: op.server.payload, deleted: op.server.payload === null });
        await storage.removeOps([op.opId]);
      } else {
        // Overwrite: re-send my version based on the server's current revision (audited server side)
        await storage.removeOps([op.opId]);
        await storage.enqueue({ ...op, opId: newId('op'), baseRev: op.server?.rev ?? op.baseRev, state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null });
      }
      await get().refreshCounts();
      void runCycle();
    },

    async retryRejected(opId) {
      if (!storage) return;
      const op = (await storage.listOutbox()).find((o) => o.opId === opId);
      if (!op) return;
      await storage.updateOp({ ...op, state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null });
      await get().refreshCounts();
      void runCycle();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    },
  };
});

function onOnline() {
  void useSyncStore.getState().syncNow();
}

/** Kick a sync soon after local writes (debounced). */
let kick: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delayMs = 1500): void {
  const s = useSyncStore.getState();
  if (!s.config.enabled) return;
  if (kick) clearTimeout(kick);
  kick = setTimeout(() => {
    kick = null;
    void s.refreshCounts().then(() => s.syncNow());
  }, delayMs);
}

export type { SyncEntity };

/** Extra in-memory listeners for pulled changes (the research store registers one). */
export const remoteListeners = new Set<(change: PullChange) => void>();
