// Место в браузере кончилось на сырых данных (P1-6): сеанс сохранён, но честно «без сырых данных».

import { describe, expect, it, vi } from 'vitest';

vi.mock('../data/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/db')>();
  return {
    ...real,
    openStorage: async () => {
      const s = real.createMemoryStorage();
      s.putRaw = () => Promise.reject(new DOMException('Квота исчерпана', 'QuotaExceededError'));
      return s;
    },
  };
});

describe('нет места для сырых данных', () => {
  it('сеанс сохранён с hasRaw = false и предупреждением', async () => {
    const { useAppStore } = await import('./appStore');
    await useAppStore.getState().init();
    const demo = useAppStore.getState().sessions.find((s) => s.workspace === 'demo');
    expect(demo).toBeDefined();
    const session = { ...demo!, id: 'quota-1', hasRaw: true };
    useAppStore.getState().saveSession(session, [{ seq: 0, t: 0, data: { trunk: new Int16Array(6) } }]);
    await new Promise((r) => setTimeout(r, 0));
    const saved = useAppStore.getState().sessions.find((s) => s.id === 'quota-1');
    expect(saved?.hasRaw).toBe(false);
    expect(useAppStore.getState().toasts.at(-1)?.kind).toBe('critical');
  }, 30_000);
});
