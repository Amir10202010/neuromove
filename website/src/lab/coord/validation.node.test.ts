// MCSE validation suite runner. Quick mode (default `npm test`): few replicates, asserts that the suite runs and that
// the core ground-truth checks pass. Full mode: COORD_VALIDATE_FULL=1 COORD_VALIDATE_OUT=<file> (npm run coord:validate).
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runValidation } from './validation';

const FULL = process.env.COORD_VALIDATE_FULL === '1';

describe('MCSE validation suite', () => {
  it(
    FULL ? 'full suite' : 'quick suite',
    () => {
      const report = runValidation({ replicates: FULL ? Number(process.env.COORD_VALIDATE_REPLICATES ?? 20) : 2, full: FULL });
      const out = process.env.COORD_VALIDATE_OUT;
      if (out) writeFileSync(out, JSON.stringify(report, null, 1));
      const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
      // quick mode asserts only the deterministic ground-truth checks; rates need the full replicate count.
      // V2d (elbow flexion during abduction) is a DOCUMENTED failure (research/mcse-validation.md): asserted as
      // still failing, so a future change that fixes or worsens it is noticed and the document updated.
      if (process.env.COORD_VALIDATE_NOASSERT !== '1') {
        for (const id of ['V1a', 'V1b', 'V2a', 'V2b', 'V2c', 'V3a', 'V3b', 'V4', 'V10']) expect(byId[id]?.pass, `${id}: ${byId[id]?.criterion} (value ${byId[id]?.value})`).toBe(true);
        expect(byId.V2d?.pass, 'V2d documented failure changed — update research/mcse-validation.md').toBe(false);
      }
    },
    FULL ? 3_600_000 : 600_000,
  );
});
