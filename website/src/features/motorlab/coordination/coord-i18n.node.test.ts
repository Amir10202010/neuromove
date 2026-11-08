// Every literal ct('…') key of the coordination workspace has a Russian and a Kazakh string.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COORD_KK_KEYS, COORD_RU_KEYS } from './i18n';

describe('coordination workspace strings', () => {
  it('RU and KK cover every key used in the page and the overview tile', () => {
    const files = ['./CoordinationPage.tsx', '../LabOverviewPage.tsx'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
    const used = new Set(files.flatMap((src) => [...src.matchAll(/ct\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => (m[1] as string).replace(/\\\\/g, '\\'))));
    const ru = new Set(COORD_RU_KEYS);
    const kk = new Set(COORD_KK_KEYS);
    const missing = [...used].filter((k) => !ru.has(k) || !kk.has(k));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });
});
