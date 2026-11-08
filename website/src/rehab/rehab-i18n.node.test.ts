// Translation completeness of the Functional Progression screens and validity of the demo seed.
//  - every literal xt('…') / tx('…') key has Russian
//  - every key used by the family and child screens and the demo content has Kazakh
//  - every enum label exists in ru / kk / en (typed in labels.ts; checked here at runtime too)
//  - every demo record passes the same validator as real data, and nothing in the demo is clinic data

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN, KK, RU } from '../features/rehab/i18n';
import { LABELS } from '../features/rehab/labels';
import { demoRehabRecords } from './demoSeed';
import { syntheticSession } from './testing';
import { validRehabRecord } from './validate';
import { METRIC_ORDER } from './movement';
import { STEP_ICONS } from './model';

const dir = join(__dirname, '../features/rehab');
// xt() in screens, tx() in the demo seed, fx() marks summary fact templates (src/rehab/summary.ts)
const KEY = /\b(?:xt|tx|fx)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const FAMILY_FILES = ['FamilyHomePage.tsx', 'ChildPlayPage.tsx', 'CaregiverGate.tsx', 'LivePractice.tsx'];

function keysOf(file: string): string[] {
  const s = readFileSync(file, 'utf8');
  return [...s.matchAll(KEY)].map((m) => (m[2] as string).replace(/\\'/g, "'"));
}

describe('rehab translations', () => {
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && f !== 'i18n.ts');
  const all = new Set(files.flatMap((f) => keysOf(join(dir, f))).concat(keysOf(join(__dirname, 'demoSeed.ts')), keysOf(join(__dirname, 'summary.ts'))));

  it('Russian covers every key', () => {
    expect([...all].filter((k) => !(k in RU))).toEqual([]);
  });

  it('Kazakh covers every family, child and demo key', () => {
    const fam = new Set(FAMILY_FILES.flatMap((f) => keysOf(join(dir, f))).concat(keysOf(join(__dirname, 'demoSeed.ts'))));
    // Saving from the family screens surfaces these messages too
    for (const k of ['Saved on this device', 'Not saved', 'This account is not linked to this child.', 'Families can add reports and notes, but cannot change this.']) fam.add(k);
    expect([...fam].filter((k) => !(k in KK))).toEqual([]);
  });

  it('identifier keys have English and Russian wording', () => {
    const ids = [...METRIC_ORDER.map((m) => `metric.${m}`), ...STEP_ICONS.map((i) => `icon.${i}`)];
    expect(ids.filter((k) => !(k in EN) || !(k in RU))).toEqual([]);
  });

  it('enum labels exist in every language', () => {
    for (const loc of ['ru', 'kk', 'en'] as const) for (const group of Object.values(LABELS[loc])) for (const v of Object.values(group)) expect(String(v).length).toBeGreaterThan(0);
    expect(Object.keys(LABELS.kk.goalCategory)).toEqual(Object.keys(LABELS.en.goalCategory));
  });
});

describe('demo seed', () => {
  it('every record is valid demo data, in every language', () => {
    const sessions = [syntheticSession('demo-p01-s1', 'demo-p01', '2026-09-10T10:00:00.000Z', [100, 104, 102], { simulated: true })].map((s) => ({ ...s, workspace: 'demo' as const, demo: true }));
    for (const lang of ['ru', 'kk', 'en'] as const) {
      const recs = demoRehabRecords(new Date('2026-11-08T10:00:00Z'), (en) => (lang === 'en' ? en : lang === 'kk' ? (KK[en] ?? en) : (RU[en] ?? en)), sessions, lang);
      const bad = recs.filter((r) => !validRehabRecord(JSON.parse(JSON.stringify(r))));
      expect(bad.map((r) => `${r.kind}:${r.id}`)).toEqual([]);
      expect(recs.every((r) => r.workspace === 'demo')).toBe(true);
      expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
      expect(recs.some((r) => r.kind === 'program' && r.version === 2 && r.basedOnReviewId)).toBe(true);
    }
  });
});
