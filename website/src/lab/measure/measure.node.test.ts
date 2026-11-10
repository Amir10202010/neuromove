// Measurement-layer validation runner (benchmarks M2–M4, U1–U2, E1, R1).
//   npm test                         quick mode: few replicates — every benchmark runs and returns finite values;
//                                    only the deterministic ones are asserted
//   MEASURE_VALIDATE_FULL=1          full mode (≈ 4 min); with MEASURE_VALIDATE_OUT=<file> the records are written as JSON
// A failed criterion in full mode is a finding reported in research/SCIENTIFIC_VALIDATION.md, not a reason to edit it.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureValidation } from './validation';

const FULL = process.env.MEASURE_VALIDATE_FULL === '1';

describe('measurement-science validation', () => {
  it(
    FULL ? 'full suite' : 'quick suite',
    () => {
      const started = new Date().toISOString();
      const records = measureValidation(FULL);
      const out = process.env.MEASURE_VALIDATE_OUT;
      if (out) writeFileSync(out, JSON.stringify({ started, finished: new Date().toISOString(), full: FULL, node: process.version, records }, null, 1));
      for (const r of records) if (r.value !== null) expect(Number.isFinite(r.value), `${r.id} value`).toBe(true);
      const by = Object.fromEntries(records.map((r) => [r.id, r]));
      // deterministic regardless of replicate count
      for (const id of ['M2a2', 'M3', 'M4']) expect(by[id]?.pass, `${id}: ${by[id]?.criterion} (value ${by[id]?.value})`).toBe(true);
      if (FULL && process.env.MEASURE_VALIDATE_NOASSERT !== '1') {
        // M2a is a DOCUMENTED failure (research/SCIENTIFIC_VALIDATION.md): asserted as still failing so that a
        // change is noticed and the document updated.
        for (const r of records) if (r.pass !== null && r.id !== 'M2a') expect(r.pass, `${r.id}: ${r.criterion} (value ${r.value}, ${JSON.stringify(r.detail)})`).toBe(true);
        expect(by.M2a?.pass, 'M2a documented failure changed — update research/SCIENTIFIC_VALIDATION.md').toBe(false);
      }
    },
    FULL ? 3_600_000 : 300_000,
  );
});
