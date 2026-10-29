// Эксперименты C1–C17 на независимом эталоне. Критерии записаны до прогона
// (docs/ENGINEERING_10H/EXPERIMENTS.md). Полный прогон с записью сырых результатов:
//   npm run experiments — 8 зёрен, 10 минут в долгом сценарии, JSON в docs/ENGINEERING_10H/data/

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runExperiments } from './experiments';

const full = process.env.EXPERIMENTS_FULL === '1';
const started = new Date().toISOString();
const results = runExperiments({ full });

const out = process.env.EXPERIMENTS_OUT;
if (out) {
  mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(out, JSON.stringify({ started, finished: new Date().toISOString(), full, node: process.version, results }, null, 1));
}

describe('эксперименты на независимом эталоне', () => {
  for (const r of results) {
    const detail = `${r.setup}\nсводка: ${JSON.stringify(r.summary)}\nпо зёрнам: ${JSON.stringify(r.perSeed)}`;
    if (r.knownLimitation && r.guard) {
      const guard = r.guard;
      it(`${r.id} — ограничение ${r.knownLimitation}, защита от регрессии: ${guard.rule}`, () => {
        expect(guard.ok, detail).toBe(true);
      });
    } else if (r.knownLimitation) {
      it(`${r.id} — известное ограничение ${r.knownLimitation}: по-прежнему не проходит`, () => {
        expect(r.pass, `сценарий начал проходить — обновите находку ${r.knownLimitation} в FINDINGS.md\n${detail}`).toBe(false);
      });
    } else {
      it(`${r.id} — ${r.criterion}`, () => {
        expect(r.pass, detail).toBe(true);
      });
    }
  }
});
