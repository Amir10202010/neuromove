// POST-HOC characterisation (not a pre-specified criterion): dissociation power and false-dissociation rate with
// 24 repetitions per set instead of 12. Run only with COORD_POSTHOC_OUT set.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { v7Dissociation } from './validation';

it.runIf(!!process.env.COORD_POSTHOC_OUT)('post-hoc V7 with 24 per set', () => {
  const res = v7Dissociation(20, 24);
  writeFileSync(process.env.COORD_POSTHOC_OUT as string, JSON.stringify({ generatedAt: new Date().toISOString(), note: 'POST-HOC characterisation, nPer = 24, 20 replicates, same seeds scheme as V7', v7: res }, null, 1));
}, 3_600_000);
