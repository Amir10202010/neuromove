// Производительность (P2-3 в docs/ENGINEERING_10H): сколько стоит обработка в сравнении с бюджетом
// реального времени. 100 Гц — 10 мс на кадр; движок и разбор должны тратить малую долю этого.
// Числа пишутся в файл, если задан PERF_OUT; проверки — с большим запасом, чтобы не мигать.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { ImuCsvParser, LineSplitter, serializeImuCsv } from '../devices/contract';
import { generateDemoWorkspace } from '../data/seed/demo';
import { SessionEngine } from '../session/SessionEngine';
import { generate } from './gen';
import { CAL_SEC, armPose, placesFor, repTrack } from './scenarios';

const results: Record<string, number> = {};

function best(fn: () => void, runs = 5): number {
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    b = Math.min(b, performance.now() - t0);
  }
  return b;
}

describe('производительность против бюджета 100 Гц', () => {
  const elbow = repTrack(120, 1.5, 1, 11);
  const gen = generate({ durationSec: CAL_SEC + 56, motion: (t) => armPose('right', { elbow: elbow(t) }), places: placesFor('right'), seed: 1, errors: 'typical' });

  it('движок сеанса: 60 с записи трёх датчиков', () => {
    const ms = best(() => {
      const e = new SessionEngine({ steps: [{ exercise: 'elbow_flexion', side: 'right', reps: 0, durationSec: 1e9 }], autoAdvance: false });
      e.start();
      // Кадры пачками по 4 — как SerialDevice отдаёт их раз в 40 мс
      for (let i = 0; i < gen.frames.length; i += 4) e.process(gen.frames.slice(i, i + 4));
      e.stop();
      e.result();
    });
    results.engineUsPerFrame = (ms * 1000) / gen.frames.length;
    results.engineShareOfBudgetPct = (results.engineUsPerFrame / 10_000) * 100;
    expect(results.engineUsPerFrame).toBeLessThan(500);
  });

  it('разбор потока: строки imu-csv v1 из порта кусками', () => {
    const text = serializeImuCsv({ device: 'NM-01', firmware: '0.1', rateHz: 100, accG: 4, gyroDps: 1000, sensors: ['trunk', 'upper_r', 'fore_r'], extra: {} }, gen.frames);
    const ms = best(() => {
      const split = new LineSplitter();
      const p = new ImuCsvParser();
      for (let i = 0; i < text.length; i += 64) for (const l of split.push(text.slice(i, i + 64))) p.pushLine(l);
    });
    results.parseUsPerLine = (ms * 1000) / gen.frames.length;
    expect(results.parseUsPerLine).toBeLessThan(200);
  });

  it('подготовка демо при первом запуске', async () => {
    const t0 = performance.now();
    await generateDemoWorkspace({ now: new Date('2026-10-02T09:00:00Z'), t: makeT('ru'), clinician: 'Тест' });
    results.demoSeedMs = performance.now() - t0;
    expect(results.demoSeedMs).toBeLessThan(15_000);
  }, 30_000);

  it('итог', () => {
    const out = process.env.PERF_OUT;
    if (out) writeFileSync(out, JSON.stringify({ measured: new Date().toISOString(), node: process.version, ...results }, null, 1));
    expect(Object.keys(results).length).toBe(4);
  });
});
