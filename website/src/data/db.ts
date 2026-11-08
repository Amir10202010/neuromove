// Хранение на компьютере — IndexedDB (софт.md, раздел 4). Почему не localStorage:
// там около 5 МБ и только строки, а сырые данные одного теста — мегабайты чисел.
//
// Если IndexedDB недоступна (приватное окно, запрет браузера) — работаем в памяти
// и честно предупреждаем: после закрытия вкладки данные пропадут.
//
// IndexedDB is the local, offline-first copy. When team cloud sync is enabled, PostgreSQL (server/)
// is the authoritative store; every clinic write is committed here together with an outbox op in ONE
// transaction, and the sync engine (src/sync/engine.ts) uploads it.

import { openDB, type IDBPDatabase } from 'idb';
import type { Placement, RawFrame } from '../devices/types';
import type { ProtocolVersion, Trial, ValidationSession } from '../research/model';
import type { RehabRecord } from '../rehab/model';
import type { OutboxOp, SyncStateRow } from '../sync/types';
import type { Alert, Note, Patient, Session, Workspace, WorkspaceData } from './models';

export type CollectionName = 'patients' | 'sessions' | 'notes' | 'alerts';
type Entity = Patient | Session | Note | Alert;

export interface StoredData extends WorkspaceData {
  meta: Record<string, unknown>;
}

/** Research stores added in schema v2 (validation studies) and v3 (rehabilitation records, one store for all kinds). */
export type ResearchStore = 'protocols' | 'vsessions' | 'trials' | 'rehab';
export interface ResearchRecords {
  protocols: ProtocolVersion;
  vsessions: ValidationSession;
  trials: Trial;
  rehab: RehabRecord;
}

export interface DataStorage {
  readonly kind: 'indexeddb' | 'memory';
  loadAll(): Promise<StoredData>;
  /**
   * Записать сущность. С `op` сущность и операция очереди синхронизации ложатся в ОДНОЙ транзакции:
   * на диске либо обе, либо ни одной (нет «сохранено, но никогда не уйдёт на сервер»).
   */
  put(collection: CollectionName, value: Entity, op?: OutboxOp): Promise<void>;
  remove(collection: CollectionName, id: string): Promise<void>;
  /**
   * Заменить всё содержимое пространства (сброс демо, загрузка архива).
   * `preserve` — id записей, которые не удаляются ни при каких условиях: записи, не прошедшие проверку
   * при загрузке («карантин»). Раньше импорт архива удалял и их — скрытые сеансы пропадали навсегда.
   */
  replaceWorkspace(ws: Workspace, data: WorkspaceData, preserve?: ReadonlySet<string>): Promise<void>;
  setMeta(key: string, value: unknown): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  putRaw(sessionId: string, frames: readonly RawFrame[]): Promise<void>;
  getRaw(sessionId: string): Promise<RawFrame[] | null>;
  removeRaw(sessionId: string): Promise<void>;
  putResearch<S extends ResearchStore>(store: S, value: ResearchRecords[S], op?: OutboxOp): Promise<void>;
  /** Several records of one store and their outbox ops in ONE transaction (all or nothing). */
  putResearchBatch<S extends ResearchStore>(store: S, values: readonly ResearchRecords[S][], ops: readonly OutboxOp[]): Promise<void>;
  getAllResearch<S extends ResearchStore>(store: S): Promise<ResearchRecords[S][]>;
  /** Demo housekeeping only (re-seeding the demo workspace). Clinic records are never removed. */
  removeResearch(store: ResearchStore, keys: readonly string[]): Promise<void>;
  /** Очередь синхронизации: новая правка сущности сливается с ещё не подтверждённой (с новым opId). */
  enqueue(op: OutboxOp): Promise<void>;
  listOutbox(): Promise<OutboxOp[]>;
  updateOp(op: OutboxOp): Promise<void>;
  /** Убрать подтверждённые операции — только если в очереди всё ещё именно этот opId. */
  removeOps(opIds: readonly string[]): Promise<void>;
  getSyncState(): Promise<SyncStateRow[]>;
  putSyncState(rows: readonly SyncStateRow[]): Promise<void>;
}

/** Сырые отсчёты кусками по 10 секунд: номера и числа в типизированных массивах. */
interface RawChunk {
  key: string;
  sessionId: string;
  index: number;
  placements: Placement[];
  seq: Int32Array;
  t: Float64Array;
  /** n × placements × 6 чисел; отсутствующий датчик в кадре — нули и mask = 0. */
  data: Int16Array;
  mask: Uint8Array;
}

const DB_NAME = 'neuromove';
export const DB_VERSION = 3;
const COLLECTIONS: CollectionName[] = ['patients', 'sessions', 'notes', 'alerts'];
const CHUNK = 1000;

const researchKey = (store: ResearchStore, v: { id?: string; key?: string }): string => (store === 'protocols' ? v.key : v.id) as string;

function packChunk(sessionId: string, index: number, frames: readonly RawFrame[]): RawChunk {
  const placements = [...new Set(frames.flatMap((f) => Object.keys(f.data) as Placement[]))];
  const n = frames.length;
  const P = placements.length;
  const data = new Int16Array(n * P * 6);
  const mask = new Uint8Array(n * P);
  const seq = new Int32Array(n);
  const t = new Float64Array(n);
  frames.forEach((f, i) => {
    seq[i] = f.seq;
    t[i] = f.t;
    placements.forEach((p, j) => {
      const d = f.data[p];
      if (!d) return;
      mask[i * P + j] = 1;
      data.set(d, (i * P + j) * 6);
    });
  });
  return { key: `${sessionId}:${index}`, sessionId, index, placements, seq, t, data, mask };
}

function unpackChunk(c: RawChunk): RawFrame[] {
  const P = c.placements.length;
  const out: RawFrame[] = [];
  for (let i = 0; i < c.seq.length; i++) {
    const data: RawFrame['data'] = {};
    c.placements.forEach((p, j) => {
      if (!c.mask[i * P + j]) return;
      data[p] = c.data.slice((i * P + j) * 6, (i * P + j) * 6 + 6);
    });
    out.push({ seq: c.seq[i] as number, t: c.t[i] as number, data });
  }
  return out;
}

/** Minimal surface of the outbox object store used by `enqueueIn`. */
interface OutboxStore {
  index(name: 'entityKey'): { getAll(key: string): Promise<OutboxOp[]> };
  put(value: OutboxOp): Promise<unknown>;
}

/**
 * Coalescing: an entity edited five times while offline is uploaded once, with its latest payload, in the
 * queue position of its FIRST pending op (parents stay ahead of children). The coalesced op gets a NEW
 * opId, so a stale in-flight copy of the old op can never be acknowledged in its place. Ops in 'conflict'
 * are never overwritten silently: the new edit queues behind them.
 */
async function enqueueIn(store: OutboxStore, op: OutboxOp): Promise<void> {
  const entityKey = `${op.entity}:${op.entityId}`;
  const existing = (await store.index('entityKey').getAll(entityKey)).find((x) => x.state !== 'conflict');
  const row = { ...op, entityKey } as OutboxOp & { entityKey: string };
  if (existing) {
    await store.put({ ...row, seq: existing.seq, baseRev: existing.baseRev ?? op.baseRev, attempts: 0, nextAttemptAt: 0, lastError: null, state: 'pending' } as OutboxOp);
  } else {
    delete row.seq;
    await store.put(row);
  }
}

class IdbStorage implements DataStorage {
  readonly kind = 'indexeddb' as const;
  constructor(private readonly db: IDBPDatabase) {}

  async loadAll(): Promise<StoredData> {
    const [patients, sessions, notes, alerts, metaRows] = await Promise.all([
      this.db.getAll('patients'),
      this.db.getAll('sessions'),
      this.db.getAll('notes'),
      this.db.getAll('alerts'),
      this.db.getAll('meta'),
    ]);
    const meta: Record<string, unknown> = {};
    for (const row of metaRows as { key: string; value: unknown }[]) meta[row.key] = row.value;
    return { patients, sessions, notes, alerts, meta } as StoredData;
  }

  async put(collection: CollectionName, value: Entity, op?: OutboxOp): Promise<void> {
    if (!op) {
      await this.db.put(collection, value);
      return;
    }
    const tx = this.db.transaction([collection, 'outbox'], 'readwrite');
    await tx.objectStore(collection).put(value);
    await enqueueIn(tx.objectStore('outbox') as unknown as OutboxStore, op);
    await tx.done;
  }

  async remove(collection: CollectionName, id: string): Promise<void> {
    await this.db.delete(collection, id);
  }

  async replaceWorkspace(ws: Workspace, data: WorkspaceData, preserve: ReadonlySet<string> = new Set()): Promise<void> {
    const tx = this.db.transaction([...COLLECTIONS, 'raw'], 'readwrite');
    for (const name of COLLECTIONS) {
      const store = tx.objectStore(name);
      const idx = store.index('workspace');
      for (const key of await idx.getAllKeys(ws)) {
        if (preserve.has(String(key))) continue;
        if (name === 'sessions') {
          // Вместе с сеансом удаляем его сырые данные
          const raw = tx.objectStore('raw');
          for (const rk of await raw.index('sessionId').getAllKeys(String(key))) await raw.delete(rk);
        }
        await store.delete(key);
      }
      for (const item of data[name]) await store.put(item);
    }
    await tx.done;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', { key, value });
  }

  async getMeta(key: string): Promise<unknown> {
    return ((await this.db.get('meta', key)) as { value: unknown } | undefined)?.value;
  }

  async removeResearch(store: ResearchStore, keys: readonly string[]): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    for (const k of keys) await tx.store.delete(k);
    await tx.done;
  }

  async putRaw(sessionId: string, frames: readonly RawFrame[]): Promise<void> {
    const tx = this.db.transaction('raw', 'readwrite');
    for (let i = 0; i * CHUNK < frames.length; i++) {
      await tx.store.put(packChunk(sessionId, i, frames.slice(i * CHUNK, (i + 1) * CHUNK)));
    }
    await tx.done;
  }

  async getRaw(sessionId: string): Promise<RawFrame[] | null> {
    const chunks = (await this.db.getAllFromIndex('raw', 'sessionId', sessionId)) as RawChunk[];
    if (!chunks.length) return null;
    chunks.sort((a, b) => a.index - b.index);
    return chunks.flatMap(unpackChunk);
  }

  async removeRaw(sessionId: string): Promise<void> {
    const tx = this.db.transaction('raw', 'readwrite');
    for (const k of await tx.store.index('sessionId').getAllKeys(sessionId)) await tx.store.delete(k);
    await tx.done;
  }

  async putResearch<S extends ResearchStore>(store: S, value: ResearchRecords[S], op?: OutboxOp): Promise<void> {
    const tx = this.db.transaction(op ? [store, 'outbox'] : [store], 'readwrite');
    await tx.objectStore(store).put(value);
    if (op) await enqueueIn(tx.objectStore('outbox') as unknown as OutboxStore, op);
    await tx.done;
  }

  async getAllResearch<S extends ResearchStore>(store: S): Promise<ResearchRecords[S][]> {
    return (await this.db.getAll(store)) as ResearchRecords[S][];
  }

  async putResearchBatch<S extends ResearchStore>(store: S, values: readonly ResearchRecords[S][], ops: readonly OutboxOp[]): Promise<void> {
    const tx = this.db.transaction([store, 'outbox'], 'readwrite');
    for (const v of values) await tx.objectStore(store).put(v);
    for (const op of ops) await enqueueIn(tx.objectStore('outbox') as unknown as OutboxStore, op);
    await tx.done;
  }

  async enqueue(op: OutboxOp): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    await enqueueIn(tx.store as unknown as OutboxStore, op);
    await tx.done;
  }

  async listOutbox(): Promise<OutboxOp[]> {
    return (await this.db.getAll('outbox')) as OutboxOp[];
  }

  async updateOp(op: OutboxOp): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    const current = (await tx.store.index('opId').get(op.opId)) as OutboxOp | undefined;
    // Coalesced meanwhile (new payload → new opId): the newer op wins, this update is stale
    if (current) await tx.store.put({ ...current, ...op, seq: current.seq });
    await tx.done;
  }

  async removeOps(opIds: readonly string[]): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const id of opIds) {
      const key = await tx.store.index('opId').getKey(id);
      if (key !== undefined) await tx.store.delete(key);
    }
    await tx.done;
  }

  async getSyncState(): Promise<SyncStateRow[]> {
    return (await this.db.getAll('syncstate')) as SyncStateRow[];
  }

  async putSyncState(rows: readonly SyncStateRow[]): Promise<void> {
    const tx = this.db.transaction('syncstate', 'readwrite');
    for (const r of rows) await tx.store.put(r);
    await tx.done;
  }
}

/** Запасной вариант: всё в памяти вкладки. */
class MemoryStorage implements DataStorage {
  readonly kind = 'memory' as const;
  private data: Record<CollectionName, Map<string, Entity>> = {
    patients: new Map(),
    sessions: new Map(),
    notes: new Map(),
    alerts: new Map(),
  };
  private meta: Record<string, unknown> = {};
  private raw = new Map<string, RawFrame[]>();
  private research: { [S in ResearchStore]: Map<string, ResearchRecords[S]> } = { protocols: new Map(), vsessions: new Map(), trials: new Map(), rehab: new Map() };
  private outbox: OutboxOp[] = [];
  private seq = 0;
  private syncState = new Map<string, SyncStateRow>();

  async loadAll(): Promise<StoredData> {
    return {
      patients: [...this.data.patients.values()] as Patient[],
      sessions: [...this.data.sessions.values()] as Session[],
      notes: [...this.data.notes.values()] as Note[],
      alerts: [...this.data.alerts.values()] as Alert[],
      meta: { ...this.meta },
    };
  }
  async put(c: CollectionName, v: Entity, op?: OutboxOp): Promise<void> {
    this.data[c].set(v.id, v);
    if (op) await this.enqueue(op);
  }
  async remove(c: CollectionName, id: string): Promise<void> {
    this.data[c].delete(id);
  }
  async replaceWorkspace(ws: Workspace, d: WorkspaceData, preserve: ReadonlySet<string> = new Set()): Promise<void> {
    for (const [id, entry] of this.data.sessions) if (entry.workspace === ws && !preserve.has(id)) this.raw.delete(id);
    for (const c of COLLECTIONS) {
      for (const [id, v] of this.data[c]) if (v.workspace === ws && !preserve.has(id)) this.data[c].delete(id);
      for (const item of d[c]) this.data[c].set(item.id, item);
    }
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta[key] = value;
  }
  async getMeta(key: string): Promise<unknown> {
    return this.meta[key];
  }
  async removeResearch(store: ResearchStore, keys: readonly string[]): Promise<void> {
    for (const k of keys) this.research[store].delete(k);
  }
  async putRaw(id: string, frames: readonly RawFrame[]): Promise<void> {
    this.raw.set(id, [...frames]);
  }
  async getRaw(id: string): Promise<RawFrame[] | null> {
    return this.raw.get(id) ?? null;
  }
  async removeRaw(id: string): Promise<void> {
    this.raw.delete(id);
  }
  async putResearch<S extends ResearchStore>(store: S, value: ResearchRecords[S], op?: OutboxOp): Promise<void> {
    (this.research[store] as Map<string, ResearchRecords[S]>).set(researchKey(store, value as never), structuredClone(value));
    if (op) await this.enqueue(op);
  }
  async getAllResearch<S extends ResearchStore>(store: S): Promise<ResearchRecords[S][]> {
    return [...(this.research[store] as Map<string, ResearchRecords[S]>).values()].map((v) => structuredClone(v));
  }
  async putResearchBatch<S extends ResearchStore>(store: S, values: readonly ResearchRecords[S][], ops: readonly OutboxOp[]): Promise<void> {
    for (const v of values) (this.research[store] as Map<string, ResearchRecords[S]>).set(researchKey(store, v as never), structuredClone(v));
    for (const op of ops) await this.enqueue(op);
  }
  async enqueue(op: OutboxOp): Promise<void> {
    const i = this.outbox.findIndex((x) => x.entity === op.entity && x.entityId === op.entityId && x.state !== 'conflict');
    const copy = structuredClone(op);
    if (i >= 0) {
      const ex = this.outbox[i] as OutboxOp;
      this.outbox[i] = { ...copy, seq: ex.seq as number, baseRev: ex.baseRev ?? op.baseRev, attempts: 0, nextAttemptAt: 0, lastError: null, state: 'pending' };
    } else this.outbox.push({ ...copy, seq: ++this.seq });
  }
  async listOutbox(): Promise<OutboxOp[]> {
    return this.outbox.map((x) => structuredClone(x));
  }
  async updateOp(op: OutboxOp): Promise<void> {
    const i = this.outbox.findIndex((x) => x.opId === op.opId);
    if (i >= 0) this.outbox[i] = { ...(this.outbox[i] as OutboxOp), ...structuredClone(op), seq: (this.outbox[i] as OutboxOp).seq as number };
  }
  async removeOps(opIds: readonly string[]): Promise<void> {
    const ids = new Set(opIds);
    this.outbox = this.outbox.filter((x) => !ids.has(x.opId));
  }
  async getSyncState(): Promise<SyncStateRow[]> {
    return [...this.syncState.values()].map((r) => ({ ...r }));
  }
  async putSyncState(rows: readonly SyncStateRow[]): Promise<void> {
    for (const r of rows) this.syncState.set(r.key, { ...r });
  }
}

/**
 * Сколько ждать хранилище браузера. Бывает, что IndexedDB не отвечает вовсе: база занята другой
 * вкладкой, браузер запретил её для файла с диска. Тогда — как если бы её не было: работаем
 * в памяти, и приложение честно предупреждает, что данные не сохранятся. Вечная «Загрузка…» хуже.
 */
const OPEN_TIMEOUT_MS = 5000;

/**
 * Схема базы по версиям. Каждая версия — свой шаг `if (oldVersion < N)`: так база любой старой версии
 * доходит до новой по шагам, а уже созданные хранилища не создаются второй раз. Без этого первая же
 * новая версия упала бы на «хранилище уже есть», и приложение тихо ушло бы работать в память —
 * человек увидел бы пустой список пациентов.
 */
export function upgradeSchema(db: IDBPDatabase, oldVersion: number, newVersion: number = DB_VERSION): void {
  if (oldVersion < 1) {
    for (const name of COLLECTIONS) {
      const store = db.createObjectStore(name, { keyPath: 'id' });
      store.createIndex('workspace', 'workspace');
      if (name !== 'patients') store.createIndex('patientId', 'patientId');
    }
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('raw', { keyPath: 'key' }).createIndex('sessionId', 'sessionId');
  }
  // v2 (8 Nov 2026): validation studies + sync outbox. Purely additive — no v1 store is touched.
  if (oldVersion < 2 && newVersion >= 2) {
    const protocols = db.createObjectStore('protocols', { keyPath: 'key' });
    protocols.createIndex('workspace', 'workspace');
    protocols.createIndex('protocolId', 'protocolId');
    const vs = db.createObjectStore('vsessions', { keyPath: 'id' });
    vs.createIndex('workspace', 'workspace');
    vs.createIndex('participantId', 'participantId');
    const trials = db.createObjectStore('trials', { keyPath: 'id' });
    trials.createIndex('sessionId', 'sessionId');
    trials.createIndex('workspace', 'workspace');
    const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
    outbox.createIndex('opId', 'opId', { unique: true });
    outbox.createIndex('entityKey', 'entityKey');
    db.createObjectStore('syncstate', { keyPath: 'key' });
  }
  // v3 (8 Nov 2026): Functional Progression System — ONE store for every rehab record kind (profile, goal,
  // activity, program, practice, review, assessment, study, consent, incident). Additive.
  if (oldVersion < 3 && newVersion >= 3) {
    const rehab = db.createObjectStore('rehab', { keyPath: 'id' });
    rehab.createIndex('workspace', 'workspace');
    rehab.createIndex('kind', 'kind');
    rehab.createIndex('participantId', 'participantId');
  }
  // Версия 4 и дальше — здесь: if (oldVersion < 4) { … }, с тестом в storage.test.ts
}

export async function openStorage(): Promise<DataStorage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('indexedDB timeout')), OPEN_TIMEOUT_MS);
    });
    const opening = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        upgradeSchema(db as unknown as IDBPDatabase, oldVersion);
      },
      // Another tab (possibly running the previous app version) still holds the old schema open.
      // Falling back to memory here would silently lose everything recorded in this tab, so instead we
      // stop the timeout and ask the user to close the other NeuroMove tabs; the open completes then.
      blocked() {
        clearTimeout(timer);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('neuromove:db-blocked'));
      },
    });
    const db = await Promise.race([opening, timeout]).finally(() => clearTimeout(timer));
    // A newer version opened in another tab: close so its upgrade can proceed; this tab asks for reload
    db.addEventListener('versionchange', () => {
      db.close();
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('neuromove:db-outdated'));
    });
    // Просим браузер не чистить данные самостоятельно (софт.md, «Сохранность»)
    void navigator.storage?.persist?.().catch(() => false);
    return new IdbStorage(db);
  } catch {
    return new MemoryStorage();
  }
}

export function createMemoryStorage(): DataStorage {
  return new MemoryStorage();
}
