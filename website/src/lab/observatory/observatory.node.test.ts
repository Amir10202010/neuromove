// Learning-observatory validation runner (benchmarks O1–O9, W1–W4).
//   npm test                         quick mode: few replicates — every benchmark runs and returns finite values
//   OBSERVATORY_VALIDATE_FULL=1      full mode; OBSERVATORY_VALIDATE_OUT=<file> writes the records as JSON
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { observatoryValidation } from './validation';

const FULL = process.env.OBSERVATORY_VALIDATE_FULL === '1';

describe('learning-observatory validation', () => {
  it(
    FULL ? 'full suite' : 'quick suite',
    () => {
      const started = new Date().toISOString();
      const records = observatoryValidation(FULL);
      const out = process.env.OBSERVATORY_VALIDATE_OUT;
      if (out) writeFileSync(out, JSON.stringify({ started, finished: new Date().toISOString(), full: FULL, node: process.version, records }, null, 1));
      for (const r of records) if (r.value !== null) expect(Number.isFinite(r.value), `${r.id} value`).toBe(true);
      if (FULL && process.env.OBSERVATORY_VALIDATE_NOASSERT !== '1') for (const r of records) if (r.pass !== null) expect(r.pass, `${r.id}: ${r.criterion} (value ${r.value}, ${JSON.stringify(r.detail)})`).toBe(true);
    },
    FULL ? 3_600_000 : 300_000,
  );
});
