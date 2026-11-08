// Хранилище браузера (P1-6 в docs/ENGINEERING_10H): IndexedDB в тестах — fake-indexeddb, та же
// спецификация, что в браузере. Проверяется то, что раньше не было покрыто ничем.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RawFrame } from '../devices/types';
import { openStorage, upgradeSchema } from './db';

beforeEach(() => {
  // Своя пустая база на каждый тест
  globalThis.indexedDB = new IDBFactory();
});

describe('хранилище IndexedDB', () => {
  it('сырые данные кусками: пропавший датчик остаётся пропавшим, а не нулями', async () => {
    const storage = await openStorage();
    expect(storage.kind).toBe('indexeddb');
    const d = (k: number) => Int16Array.from([k, -k, 8192, 1, 2, 3]);
    // 2 500 кадров — три куска по 1 000; с 1 200 по 1 299 датчика плеча нет
    const frames: RawFrame[] = Array.from({ length: 2500 }, (_, i) => ({
      seq: i,
      t: i / 100,
      data: i >= 1200 && i < 1300 ? { trunk: d(i), fore_r: d(i + 1) } : { trunk: d(i), upper_r: d(i + 2), fore_r: d(i + 1) },
    }));
    await storage.putRaw('s1', frames);
    const back = await storage.getRaw('s1');
    expect(back).toHaveLength(2500);
    expect(Object.keys(back?.[1250]?.data ?? {}).sort()).toEqual(['fore_r', 'trunk']);
    expect(Array.from(back?.[2499]?.data.upper_r ?? [])).toEqual(Array.from(d(2501)));
    expect(back?.map((f) => f.seq)).toEqual(frames.map((f) => f.seq));
  });

  it('схема по версиям: база версии 1 переходит на следующую без «хранилище уже есть»', async () => {
    // A v1 database exactly as the previous app version created it (only the v1 stores)
    const v1 = await openDB('neuromove', 1, {
      upgrade: (db) => {
        for (const name of ['patients', 'sessions', 'notes', 'alerts']) {
          const st = db.createObjectStore(name, { keyPath: 'id' });
          st.createIndex('workspace', 'workspace');
          if (name !== 'patients') st.createIndex('patientId', 'patientId');
        }
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('raw', { keyPath: 'key' }).createIndex('sessionId', 'sessionId');
      },
    });
    await v1.put('patients', { id: 'p1', workspace: 'clinic' });
    await v1.put('sessions', { id: 's1', workspace: 'clinic', patientId: 'p1' });
    v1.close();
    // The real app opens it at the current version: additive upgrade, v1 data untouched
    const storage = await openStorage();
    expect(storage.kind).toBe('indexeddb');
    const loaded = await storage.loadAll();
    expect(loaded.patients).toEqual([{ id: 'p1', workspace: 'clinic' }]);
    expect(loaded.sessions).toEqual([{ id: 's1', workspace: 'clinic', patientId: 'p1' }]);
    expect(await storage.listOutbox()).toEqual([]);
    expect(await storage.getAllResearch('trials')).toEqual([]);
    expect(await storage.getAllResearch('rehab')).toEqual([]);
    // And a future v4 step on top of upgradeSchema still works
    const v4 = await openDB('nm-test', 4, {
      upgrade: (db, old) => {
        upgradeSchema(db, old);
        if (old < 4) db.createObjectStore('v4-only');
      },
    });
    expect([...v4.objectStoreNames]).toContain('v4-only');
    expect([...v4.objectStoreNames]).toContain('outbox');
    expect([...v4.objectStoreNames]).toContain('rehab');
    v4.close();
  });

  it('v2 → v3 is additive: validation records and the outbox survive, the rehab store appears', async () => {
    const v2 = await openDB('neuromove', 2, { upgrade: (db, old) => upgradeSchema(db, old, 2) });
    await v2.put('trials', { id: 't1', sessionId: 'vs1', workspace: 'clinic' });
    await v2.put('outbox', { opId: 'op-1', entity: 'trial', entityId: 't1', entityKey: 'trial:t1', state: 'pending' });
    expect([...v2.objectStoreNames]).not.toContain('rehab');
    v2.close();
    const storage = await openStorage();
    expect(await storage.getAllResearch('trials')).toEqual([{ id: 't1', sessionId: 'vs1', workspace: 'clinic' }]);
    expect((await storage.listOutbox()).map((o) => o.opId)).toEqual(['op-1']);
    expect(await storage.getAllResearch('rehab')).toEqual([]);
  });
});

describe('повреждённая запись в базе', async () => {
  const { useAppStore } = await import('../state/appStore');
  it('при загрузке скрыта и посчитана, но из базы не удалена', async () => {
    const storage = await openStorage();
    // Запись без шагов и устройства — так выглядит обрывок после сбоя или подмена
    await storage.put('sessions', { id: 'broken-1', workspace: 'clinic', patientId: 'p1' } as never);
    await useAppStore.getState().init();
    const st = useAppStore.getState();
    expect(st.status).toBe('ready');
    expect(st.storageRejected).toBe(1);
    expect(st.sessions.some((s) => s.id === 'broken-1')).toBe(false);
    expect(st.toasts.some((t) => t.kind === 'critical')).toBe(true);
    // Демо загрузилось как обычно
    expect(st.sessions.some((s) => s.workspace === 'demo')).toBe(true);
    // В базе запись осталась — для разбора
    const again = await openStorage();
    expect((await again.loadAll()).sessions.some((s) => s.id === 'broken-1')).toBe(true);
  }, 30_000);
});
