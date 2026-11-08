// The only device-format recordings in the repository are the firmware test fixtures (bench patterns of 3–30 frames,
// not human movement). MCSE must refuse them explicitly rather than produce numbers.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseImuCsv } from '../../devices/contract';
import { runMcse } from './engine';

const dir = new URL('../../../../firmware/test/fixtures/', import.meta.url);
const files = [...readdirSync(dir).map((f) => new URL(f, dir)), new URL('../golden.csv', dir)];

describe('firmware fixture recordings', () => {
  it.each(files.map((f) => [f.pathname.split('/').pop() as string, f] as const))('%s is refused with a reason', (_name, f) => {
    const parsed = parseImuCsv(readFileSync(f, 'utf8'));
    const res = runMcse([{ frames: parsed.frames, meta: { id: 'fixture', participantId: 'bench', startedAt: '2026-11-08T00:00:00Z', rateHz: parsed.passport.rateHz || 100, side: 'right', steps: [{ exercise: 'shoulder_flexion', side: 'right', tStart: 0, tEnd: 1e9 }], calibrationEnd: null, source: 'file', simulated: false } }], { exercise: 'shoulder_flexion' });
    expect(res.status).toBe('no_repetitions');
    expect(res.recordings[0]?.refused ?? res.recordings[0]?.repetitions === 0 ? 'refused' : null).toBeTruthy();
  });
});
