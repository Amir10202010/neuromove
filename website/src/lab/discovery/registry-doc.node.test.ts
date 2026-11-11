// Documents that are derived from the code stay in step with it:
//   • research/HYPOTHESIS_REGISTRY.md is exactly what hypothesesDoc.ts generates (HYPOTHESES_WRITE=1 rewrites it);
//   • every literature key cited by a hypothesis or by the report builder exists in research/references.bib;
//   • every benchmark a hypothesis names exists in the last full run or in one of the earlier suites.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_BENCHMARKS } from '../scenario/latest';
import { HYPOTHESES } from './hypotheses';
import { hypothesesMarkdown } from './hypothesesDoc';
import { METHOD_REFERENCES } from './report';

const research = (name: string) => new URL(`../../../../research/${name}`, import.meta.url);
const lf = (s: string) => s.replace(/\r\n/g, '\n');

describe('documents derived from the code', () => {
  it('research/HYPOTHESIS_REGISTRY.md is the generated registry', () => {
    const want = hypothesesMarkdown();
    if (process.env.HYPOTHESES_WRITE === '1') writeFileSync(research('HYPOTHESIS_REGISTRY.md'), want);
    expect(lf(readFileSync(research('HYPOTHESIS_REGISTRY.md'), 'utf8'))).toBe(want);
  });

  it('every cited literature key is in research/references.bib', () => {
    const bib = readFileSync(research('references.bib'), 'utf8');
    const keys = new Set([...bib.matchAll(/^@\w+\{([\w-]+),/gm)].map((m) => m[1] as string));
    const cited = new Set([...HYPOTHESES.flatMap((h) => h.references), ...Object.values(METHOD_REFERENCES)]);
    expect([...cited].filter((k) => !keys.has(k))).toEqual([]);
    expect(cited.size).toBeGreaterThan(20);
  });

  it('every benchmark named by a hypothesis exists', () => {
    // E… and V… are the earlier suites (research/model-validation.md, research/mcse-validation.md)
    const earlier = (id: string) => /^E[1-8]$/.test(id) || /^V([1-9]|1[01])$/.test(id);
    const recorded = new Set((LATEST_BENCHMARKS?.records ?? []).map((r) => r.id));
    // S5 is named as a pair (S5a, S5b) in one sample-size sentence only; ids in `benchmarks` are exact
    const missing = HYPOTHESES.flatMap((h) => h.benchmarks.filter((b) => !earlier(b) && !recorded.has(b)).map((b) => `${h.id}:${b}`));
    if (LATEST_BENCHMARKS) expect(missing).toEqual([]);
  });
});
