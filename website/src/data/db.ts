// Хранение на компьютере — IndexedDB (софт.md, раздел 4). Почему не localStorage:
// там около 5 МБ и только строки, а сырые данные одного теста — мегабайты чисел.
//
// Если IndexedDB недоступна (приватное окно, запрет браузера) — работаем в памяти
// и честно предупреждаем: после закрытия вкладки данные пропадут.
//
// Замена на настоящий сервер позже — это новая реализация интерфейса DataStorage,
// остальной код не меняется.

import { openDB, type IDBPDatabase } from 'idb';
import type { Placement, RawFrame } from '../devices/types';
import type { Alert, Note, Patient, Session, Workspace, WorkspaceData } from './models';

export type CollectionName = 'patients' | 'sessions' | 'notes' | 'alerts';
type Entity = Patient | Session | Note | Alert;

export interface StoredData extends WorkspaceData {
  meta: Record<string, unknown>;
}

export interface DataStorage {
  readonly kind: 'indexeddb' | 'memory';
  loadAll(): Promise<StoredData>;
  put(collection: CollectionName, value: Entity): Promise<void>;
  remove(collection: CollectionName, id: string): Promise<void>;
  /** Заменить всё содержимое пространства (сброс демо, загрузка архива). */
  replaceWorkspace(ws: Workspace, data: WorkspaceData): Promise<void>;
  setMeta(key: string, value: unknown): Promise<void>;
  putRaw(sessionId: string, frames: readonly RawFrame[]): Promise<void>;
  getRaw(sessionId: string): Promise<RawFrame[] | null>;
  removeRaw(sessionId: string): Promise<void>;
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
export const DB_VERSION = 1;
const COLLECTIONS: CollectionName[] = ['patients', 'sessions', 'notes', 'alerts'];
const CHUNK = 1000;

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

  async put(collection: CollectionName, value: Entity): Promise<void> {
    await this.db.put(collection, value);
  }

  async remove(collection: CollectionName, id: string): Promise<void> {
    await this.db.delete(collection, id);
  }

  async replaceWorkspace(ws: Workspace, data: WorkspaceData): Promise<void> {
    const tx = this.db.transaction([...COLLECTIONS, 'raw'], 'readwrite');
    for (const name of COLLECTIONS) {
      const store = tx.objectStore(name);
      const idx = store.index('workspace');
      for (const key of await idx.getAllKeys(ws)) {
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

  async loadAll(): Promise<StoredData> {
    return {
      patients: [...this.data.patients.values()] as Patient[],
      sessions: [...this.data.sessions.values()] as Session[],
      notes: [...this.data.notes.values()] as Note[],
      alerts: [...this.data.alerts.values()] as Alert[],
      meta: { ...this.meta },
    };
  }
  async put(c: CollectionName, v: Entity): Promise<void> {
    this.data[c].set(v.id, v);
  }
  async remove(c: CollectionName, id: string): Promise<void> {
    this.data[c].delete(id);
  }
  async replaceWorkspace(ws: Workspace, d: WorkspaceData): Promise<void> {
    for (const [id, entry] of this.data.sessions) if (entry.workspace === ws) this.raw.delete(id);
    for (const c of COLLECTIONS) {
      for (const [id, v] of this.data[c]) if (v.workspace === ws) this.data[c].delete(id);
      for (const item of d[c]) this.data[c].set(item.id, item);
    }
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta[key] = value;
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
export function upgradeSchema(db: IDBPDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    for (const name of COLLECTIONS) {
      const store = db.createObjectStore(name, { keyPath: 'id' });
      store.createIndex('workspace', 'workspace');
      if (name !== 'patients') store.createIndex('patientId', 'patientId');
    }
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('raw', { keyPath: 'key' }).createIndex('sessionId', 'sessionId');
  }
  // Версия 2 и дальше — здесь: if (oldVersion < 2) { … }, с тестом в storage.test.ts
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
    });
    const db = await Promise.race([opening, timeout]).finally(() => clearTimeout(timer));
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
