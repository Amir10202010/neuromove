// Unit tests of the coordination engine's contracts. Synthetic data only (generator: synthetic.ts).
import { describe, expect, it } from 'vitest';
import { dtw } from './align';
import { buildChannels } from './channels';
import { selectComponents } from './components';
import { compareGroups, DEFAULT_DISSOCIATION, matchOnOutcome, type RepVector } from './dissociation';
import { runMcse } from './engine';
import { practiceInput, sessionInput } from './inputs';
import { buildManifest, hashFrames, verifyManifest } from './provenance';
import { madgwickSeries, qFromAxisAngle, qFromGravity, qRotate } from './quat';
import { segmentRepetitions } from './segment';
import { adjustedRand, createRng, entropyMillerMadow } from './stats';
import { discoverStrategies } from './strategy';
import { STRATEGIES, generateSession, worldArmInclination, type StrategySpec } from './synthetic';
import type { Vec3 } from '../../lib/vec3';

const BASE = { duration: { mean: 1.2, cv: 0.1 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.04 };

describe('orientation (quat.ts)', () => {
  it('gravity initialisation maps the measured up vector to world +Z', () => {
    const up: Vec3 = [0.3, -0.5, 0.81];
    const q = qFromGravity(up);
    const w = qRotate(q, [up[0] / Math.hypot(...up), up[1] / Math.hypot(...up), up[2] / Math.hypot(...up)]);
    expect(w[2]).toBeCloseTo(1, 9);
  });
  it('pure gyro integration (beta = 0) reproduces an analytic rotation', () => {
    const t = Array.from({ length: 300 }, (_, i) => i / 100);
    const gyro = t.map(() => [0, 0, 90] as Vec3);
    const acc = t.map(() => [0, 0, 1] as Vec3);
    const q = madgwickSeries(t, gyro, acc, 0).q.at(-1)!;
    const ref = qFromAxisAngle([0, 0, 1], (90 * 2.99 * Math.PI) / 180);
    const a = qRotate(q, [1, 0, 0]);
    const b = qRotate(ref, [1, 0, 0]);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-3);
  });
});

describe('channels and segmentation on ground-truth synthetic data', () => {
  const rec = generateSession({ participantId: 'SYN-T', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: [STRATEGIES.armDominant, STRATEGIES.trunkAssisted, STRATEGIES.armDominant, STRATEGIES.trunkAssisted], seed: 3, ...BASE });
  const cs = buildChannels(rec.frames, rec.meta);
  it('uses the session calibration window and reports drift diagnostics', () => {
    expect(cs.calibration.source).toBe('session_calibration');
    expect(cs.drift.relativeHeadingDriftDps).not.toBeNull();
  });
  it('upper-arm inclination tracks the kinematic ground truth within 2° RMSE', () => {
    let s = 0;
    let n = 0;
    rec.frames.forEach((f, i) => {
      if (f.t < 5) return;
      const v = cs.channels.upper_elev?.[i] as number;
      if (!Number.isFinite(v)) return;
      s += (v - worldArmInclination(rec.poseAt(f.t), 'right')) ** 2;
      n++;
    });
    expect(Math.sqrt(s / n)).toBeLessThan(2);
  });
  it('trunk extension is negative pitch (sign convention)', () => {
    const tr = rec.truth[1]!;
    const i = rec.frames.findIndex((f) => f.t >= tr.endpoint + 0.1);
    expect(cs.channels.trunk_pitch![i]!).toBeLessThan(-10);
  });
  it('finds every repetition with complete phases and boundary uncertainty', () => {
    const reps = segmentRepetitions(cs, 'shoulder_flexion', { start: 0, end: cs.t.length - 1 });
    expect(reps).toHaveLength(4);
    for (const r of reps) {
      expect(r.complete).toBe(true);
      expect(r.onset!.lo).toBeLessThanOrEqual(r.onset!.t);
      expect(r.onset!.hi).toBeGreaterThanOrEqual(r.onset!.t);
      expect(r.outcome).toBeGreaterThan(100);
    }
  });
  it('a removed sensor makes its channels unavailable with a reason, never estimated', () => {
    const noTrunk = generateSession({ participantId: 'SYN-T', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: [STRATEGIES.armDominant], seed: 4, ...BASE, perturb: { removeSensor: 'trunk' } });
    const c2 = buildChannels(noTrunk.frames, noTrunk.meta);
    expect(c2.channels.trunk_pitch).toBeUndefined();
    expect(c2.unavailable.trunk_pitch).toMatch(/trunk/);
    expect(c2.unavailable.humerothoracic).toBeDefined();
  });
});

describe('refusal to over-interpret', () => {
  it('pure noise has no coordination components', () => {
    const rng = createRng(8);
    const X = Array.from({ length: 30 }, () => Array.from({ length: 200 }, () => rng.normal()));
    expect(selectComponents(X).selection.k).toBe(0);
  });
  it('fewer than 12 repetitions is insufficient_data', () => {
    const rng = createRng(9);
    expect(discoverStrategies(Array.from({ length: 10 }, () => [rng.normal()])).verdict).toBe('insufficient_data');
  });
  it('one Gaussian cloud is a single pattern', () => {
    const rng = createRng(10);
    expect(discoverStrategies(Array.from({ length: 60 }, () => [rng.normal(), rng.normal()])).verdict).toBe('single_pattern');
  });
  it('two well-separated clouds are recovered (ARI 1)', () => {
    const rng = createRng(11);
    const Z = Array.from({ length: 60 }, (_, i) => [(i % 2) * 10 + rng.normal(), rng.normal()]);
    const d = discoverStrategies(Z);
    expect(d.verdict).toBe('multiple_strategies');
    expect(adjustedRand(d.assignments.map((a) => a.label ?? '?'), Z.map((_, i) => i % 2))).toBe(1);
  });
  it('clusters that only separate whole sessions are not reported as strategies', () => {
    const rng = createRng(12);
    const Z = Array.from({ length: 60 }, (_, i) => [(i < 30 ? 0 : 10) + rng.normal(), rng.normal()]);
    const d = discoverStrategies(Z, { seed: 5, bootstraps: 20, sessions: Z.map((_, i) => (i < 30 ? 's1' : 's2')) });
    expect(d.verdict).toBe('inconclusive');
    expect(d.reasons.join()).toMatch(/clusters_coincide_with_sessions/);
  });
});

describe('performance–strategy dissociation logic', () => {
  const rng = createRng(21);
  const vec = (id: string, outcome: number, shift: number): RepVector => ({ id, outcome, x: Array.from({ length: 101 * 2 }, (_, j) => (j < 101 ? shift * Math.sin((Math.PI * j) / 100) : 0) + rng.normal()), scores: [] });
  const chans = ['trunk_pitch', 'upper_elev'] as const;
  const cfg = { ...DEFAULT_DISSOCIATION, permutations: 499, bootstraps: 400, splits: 5 };
  it('equivalent outcomes + different trajectories → dissociation, localised to the right channel', () => {
    const A = Array.from({ length: 10 }, (_, i) => vec(`a${i}`, 120 + rng.normal(), 0));
    const B = Array.from({ length: 10 }, (_, i) => vec(`b${i}`, 120 + rng.normal(), 8));
    const c = compareGroups('A', A, 'B', B, chans, cfg);
    expect(c.verdict).toBe('dissociation');
    expect(c.trajectory.rmsByChannel[0]!.share).toBeGreaterThan(0.9);
  });
  it('different outcomes are never called a dissociation', () => {
    const A = Array.from({ length: 10 }, (_, i) => vec(`a${i}`, 120 + rng.normal(), 0));
    const B = Array.from({ length: 10 }, (_, i) => vec(`b${i}`, 100 + rng.normal(), 8));
    expect(compareGroups('A', A, 'B', B, chans, cfg).verdict).toBe('outcome_not_equivalent');
  });
  it('a cross-session difference below the re-placement margin is not a dissociation', () => {
    const A = Array.from({ length: 10 }, (_, i) => vec(`a${i}`, 120 + rng.normal(), 0));
    const B = Array.from({ length: 10 }, (_, i) => vec(`b${i}`, 120 + rng.normal(), 2.5));
    const c = compareGroups('A', A, 'B', B, chans, { ...cfg, crossSession: true, replacementMarginDeg: 5 });
    expect(['within_replacement_margin', 'no_coordination_difference']).toContain(c.verdict);
  });
  it('caliper matching only pairs outcomes within the margin', () => {
    const A = [vec('a', 100, 0), vec('b', 120, 0)];
    const B = [vec('c', 103, 0), vec('d', 140, 0)];
    const m = matchOnOutcome(A, B, 5);
    expect(m.a.map((r) => r.id)).toEqual(['a']);
    expect(m.b.map((r) => r.id)).toEqual(['c']);
  });
});

describe('raw provenance', () => {
  const rec = generateSession({ participantId: 'SYN-P', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: Array(3).fill(STRATEGIES.armDominant) as StrategySpec[], seed: 5, ...BASE });
  const m = buildManifest(rec.frames, { rateHz: 100, sync: 'simulated', accCalibrated: false, timeline: { calibrationEnd: 4, steps: rec.meta.steps }, algorithm: 'a', app: 'b' })!;
  it('verifies an unchanged stream and detects a single changed sample', () => {
    expect(verifyManifest(rec.frames, m)).toBe('verified');
    const tampered = rec.frames.map((f) => ({ ...f, data: { ...f.data } }));
    const raw = Int16Array.from(tampered[500]!.data.upper_r!);
    raw[2] = (raw[2] as number) + 1;
    tampered[500]!.data.upper_r = raw;
    expect(hashFrames(tampered)).not.toBe(m.sha256);
    expect(verifyManifest(tampered, m)).toBe('hash_mismatch');
  });
  it('the engine refuses a recording whose stream does not match its manifest', () => {
    const tampered = rec.frames.slice(0, -1);
    const res = runMcse([{ frames: tampered, meta: rec.meta, manifest: m }], { exercise: 'shoulder_flexion' });
    expect(res.recordings[0]!.refused).toMatch(/manifest/);
    expect(res.reps).toHaveLength(0);
  });
  it('input adapters keep the session and practice provenance', () => {
    const session = { id: 's1', patientId: 'p', startedAt: '2026-01-01T00:00:00Z', device: { rateHz: 100, kind: 'usb', simulated: false, name: '', firmware: '', format: '' }, demo: false, events: [], steps: [], rawManifest: m, hasRaw: true } as unknown as Parameters<typeof sessionInput>[0];
    const inp = sessionInput(session, rec.frames, 'right');
    expect(inp.meta.calibrationEnd).toBe(4);
    expect(inp.meta.source).toBe('session');
    const set = { id: 'ptr1', participantId: 'p', startedAt: '2026-01-01T00:00:00Z', side: 'right', simulated: false, rawManifest: m } as unknown as Parameters<typeof practiceInput>[0];
    expect(practiceInput(set, rec.frames)?.meta.source).toBe('practice');
  });
});

describe('statistics helpers', () => {
  it('Miller–Madow entropy of a uniform two-label sequence is ≥ 1 bit', () => {
    expect(entropyMillerMadow([10, 10])).toBeGreaterThanOrEqual(1);
  });
  it('DTW of identical sequences is 0', () => {
    const a = [[0], [1], [2], [1]];
    expect(dtw(a, a).distance).toBe(0);
  });
});
