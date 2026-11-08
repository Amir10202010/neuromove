// SYNTHETIC demonstration participant for the coordination workspace. Generated, never stored, never mixed with
// participant data; participant id "SYN-DEMO", every recording `simulated: true`, `source: 'synthetic'`.
// Design (known ground truth): 4 sessions × 12 shoulder-flexion repetitions; the share of the arm-dominant strategy
// rises 0 → 25 → 58 → 83 %, the rest are trunk-assisted (same world arm inclination ≈ 120°).

import { createRng } from '../../lib/random';
import { STRATEGIES, generateSession, type StrategySpec, type SynthRecording } from './synthetic';

export const DEMO_PARTICIPANT = 'SYN-DEMO';

export function syntheticDemoParticipant(seed = 1): SynthRecording[] {
  const rng = createRng(seed);
  const shares = [0, 0.25, 0.58, 0.83];
  return shares.map((f, s) => {
    const nArm = Math.round(12 * f);
    const seq = [...Array(12 - nArm).fill(STRATEGIES.trunkAssisted), ...Array(nArm).fill(STRATEGIES.armDominant)] as StrategySpec[];
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [seq[i], seq[j]] = [seq[j] as StrategySpec, seq[i] as StrategySpec];
    }
    return generateSession({ participantId: DEMO_PARTICIPANT, sessionIndex: s, exercise: 'shoulder_flexion', side: 'right', sequence: seq, duration: { mean: 1.2, cv: 0.12 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.04, seed: seed * 1000 + 17 * s });
  });
}
