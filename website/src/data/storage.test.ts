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
    const v1 = await openDB('nm-test', 1, { upgrade: (db, old) => upgradeSchema(db, old) });
    await v1.put('patients', { id: 'p1', workspace: 'clinic' });
    v1.close();
    // Будущая версия 2: тот же upgradeSchema плюс свой шаг
    const v2 = await openDB('nm-test', 2, {
      upgrade: (db, old) => {
        upgradeSchema(db, old);
        if (old < 2) db.createObjectStore('v2-only');
      },
    });
    expect([...v2.objectStoreNames].sort()).toEqual(['alerts', 'meta', 'notes', 'patients', 'raw', 'sessions', 'v2-only']);
    // Данные версии 1 на месте
    expect(await v2.get('patients', 'p1')).toEqual({ id: 'p1', workspace: 'clinic' });
    v2.close();
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
