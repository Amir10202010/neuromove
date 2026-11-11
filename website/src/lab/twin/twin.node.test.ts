// Twin-layer validation runner (benchmarks T1–T5; acceptance tests E, G and H of the research mission).
//   npm test                   quick mode: few replicates — every benchmark runs and returns finite values
//   TWIN_VALIDATE_FULL=1       full mode; TWIN_VALIDATE_OUT=<file> writes the records as JSON
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { twinValidation } from './validation';

const FULL = process.env.TWIN_VALIDATE_FULL === '1';

describe('twin-layer validation', () => {
  it(
    FULL ? 'full suite' : 'quick suite',
    () => {
      const started = new Date().toISOString();
      const records = twinValidation(FULL);
      const out = process.env.TWIN_VALIDATE_OUT;
      if (out) writeFileSync(out, JSON.stringify({ started, finished: new Date().toISOString(), full: FULL, node: process.version, records }, null, 1));
      for (const r of records) if (r.value !== null) expect(Number.isFinite(r.value), `${r.id} value`).toBe(true);
      if (FULL && process.env.TWIN_VALIDATE_NOASSERT !== '1') for (const r of records) if (r.pass !== null) expect(r.pass, `${r.id}: ${r.criterion} (value ${r.value}, ${JSON.stringify(r.detail)})`).toBe(true);
    },
    FULL ? 3_600_000 : 600_000,
  );
});
