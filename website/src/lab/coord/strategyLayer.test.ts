// Strategy layer: profiles, kinds of variation, flexibility, trunk–outcome trade-off, signature, strategy shift,
// task comparability. Synthetic data only (participants "SYN-*").
import { describe, expect, it } from 'vitest';
import { createRng } from '../../lib/random';
import { registryEntry } from '../measure/registry';
import { comparability, conditionKey, contextOfPractice, contextOfSession, TASK_LIBRARY, UNRECORDED, type TaskContext } from '../tasks/library';
import { DEFAULT_DISSOCIATION } from './dissociation';
import { FLEXIBILITY_CHANNELS, motorFlexibility, tradeoffFeasibility, trunkOutcomeTradeoff, type ConditionRep, type TradeoffRep } from './flexibility';
import { buildStrategyProfile, compareProfiles, equivalent, partitionVariation } from './profile';
import { movementSignature, strategyShift, type SignatureSession } from './signature';
import { synthSession } from './strategyValidation';
import { STRATEGIES, type StrategySpec } from './synthetic';

const TASK: TaskContext = { exercise: 'shoulder_flexion', side: 'right', setting: 'synthetic', protocolId: null, constraints: { ...UNRECORDED, targetDeg: 'none', speed: 'self_paced' } };
const block = (spec: StrategySpec, seed: number, mount: number, extra = {}) => synthSession('SYN-L', 0, Array(12).fill(spec) as StrategySpec[], seed, { mountSeed: mount, noiseSeed: seed + 1, ...extra });

describe('motor strategy profile', () => {
  const ra = block(STRATEGIES.armDominant, 501, 9);
  const a = buildStrategyProfile({ frames: ra.frames, meta: ra.meta }, { task: TASK });

  it('is a structured, inspectable description — every component names its unit, registry entry and status', () => {
    expect(a.repetitions).toBe(12);
    expect(a.participantId).toBe('SYN-L');
    for (const f of a.features) {
      expect(registryEntry(f.registry), f.id).not.toBeNull();
      expect(f.n).toBeGreaterThan(0);
      expect(Number.isFinite(f.mean)).toBe(true);
    }
    const o = a.features.find((f) => f.id === 'outcome')!;
    expect(o.unit).toBe('°');
    expect(o.status).toBe('derived');
    expect(o.ci95![0]).toBeLessThan(o.mean);
    expect(a.features.find((f) => f.id === 'exc_humerothoracic')!.status).toBe('model_estimated');
    expect(a.provenance.label).toBe('synthetic_simulation');
    expect(a.provenance.featureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.quality.manifest).toBe('no_manifest');
    expect(a.quality.flags).toContain('raw_stream_no_manifest');
    expect(a.placement).toBeNull();
    expect(a.uncertainty).toBeNull();
    expect(a.trunk.contribution).not.toBeNull();
  });

  it('carries the propagated measurement uncertainty when asked', () => {
    const p = buildStrategyProfile({ frames: ra.frames, meta: ra.meta }, { task: TASK, uncertainty: { draws: 4 } });
    const o = p.features.find((f) => f.id === 'outcome')!;
    expect(o.uMeasurement!).toBeGreaterThan(0);
    expect(o.measurementShare!).toBeLessThan(0.05);
  });

  it('acceptance test A — same outcome, different strategy: trunk features differ, the outcome does not, uncertainty is reported', () => {
    const rb = block(STRATEGIES.trunkAssisted, 503, 9);
    const b = buildStrategyProfile({ frames: rb.frames, meta: rb.meta }, { task: TASK, reference: a.mount });
    expect(b.placement!.level).toBe('high');
    const d = compareProfiles(a, b);
    const get = (id: string) => d.find((x) => x.id === id)!;
    expect(get('exc_trunk_pitch').verdict).toBe('beyond_noise');
    expect(get('exc_trunk_pitch').delta).toBeLessThan(-12);
    expect(get('trunk_contribution').verdict).toBe('beyond_noise');
    expect(get('outcome').verdict).not.toBe('beyond_noise');
    expect(get('outcome').se!).toBeGreaterThan(0);
    expect(get('outcome').ci90).not.toBeNull();
    // "not significantly different" is not equivalence: equivalence is its own test and may fail at n = 12
    expect(typeof equivalent(get('outcome'), DEFAULT_DISSOCIATION.marginDeg)).toBe('boolean');
    expect(equivalent(get('outcome'), 50)).toBe(true);
  });

  it('acceptance test B — no change, sensors re-attached with a different calibration posture: the shift is attributed to placement, not to the movement', () => {
    const same = synthSession('SYN-L', 1, Array(12).fill(STRATEGIES.armDominant) as StrategySpec[], 501, { mountSeed: 77, noiseSeed: 78, calibrationPosture: { flexion: 7 } });
    const b = buildStrategyProfile({ frames: same.frames, meta: same.meta }, { task: TASK, reference: a.mount });
    expect(b.placement!.level).not.toBe('high');
    const o = compareProfiles(a, b).find((x) => x.id === 'outcome')!;
    expect(o.delta).toBeLessThan(-4);
    expect(o.verdict).toBe('within_placement');
    expect(o.placementBound!).toBeGreaterThanOrEqual(Math.abs(o.delta));
  });

  it('without a placement comparison an angle difference between recordings is never "beyond noise"', () => {
    // a different recording (session index 1), sensors re-attached, no placement comparison available
    const rb = synthSession('SYN-L', 1, Array(12).fill(STRATEGIES.trunkAssisted) as StrategySpec[], 503, { mountSeed: 10, noiseSeed: 504 });
    const b = buildStrategyProfile({ frames: rb.frames, meta: rb.meta }, { task: TASK });
    const d = compareProfiles(a, b, null);
    for (const x of d.filter((y) => y.unit === '°')) expect(x.verdict, x.id).not.toBe('beyond_noise');
  });
});

describe('kinds of variation', () => {
  const rng = createRng(4);
  const sess = (mu: number, n = 8, sd = 3, slope = 0) => Array.from({ length: n }, (_, i) => mu + slope * i + rng.normal(0, sd));
  it('needs three recordings', () => {
    expect(partitionVariation([{ recordingId: 'a', values: sess(100) }, { recordingId: 'b', values: sess(101) }]).verdicts).toEqual(['insufficient_sessions']);
  });
  it('stable sessions: differences within repetition and sensor error', () => {
    const p = partitionVariation([0, 1, 2, 3, 4].map((k) => ({ recordingId: `s${k}`, values: sess(100), uSystematic: 0.7, uRandom: 0.05, placementBound: k ? 2 : 0, condition: 'c' })));
    expect(p.verdicts).toEqual(['within_repetition_and_sensor_error']);
    expect(p.withinResidual!).toBeGreaterThan(2);
    expect(p.measurementShareWithin!).toBeLessThan(0.01);
  });
  it('a shift within the placement bound is not cleared of placement; beyond it, it is a candidate change', () => {
    const mk = (bound: number | null) => partitionVariation([100, 100, 100, 112, 112].map((mu, k) => ({ recordingId: `s${k}`, values: sess(mu), uSystematic: 0.7, placementBound: k === 0 ? 0 : bound, condition: 'c' })));
    expect(mk(10).verdicts).toEqual(['placement_not_excluded']);
    expect(mk(null).verdicts).toEqual(['placement_not_excluded']);
    expect(mk(2).verdicts).toEqual(['exceeds_measurement_explanations']);
  });
  it('different task conditions are named as an explanation', () => {
    const p = partitionVariation([100, 100, 115, 115].map((mu, k) => ({ recordingId: `s${k}`, values: sess(mu), placementBound: k ? 1 : 0, condition: k < 2 ? 'target=90' : 'target=120' })));
    expect(p.verdicts).toContain('task_conditions_differ');
    expect(p.verdicts).not.toContain('exceeds_measurement_explanations');
  });
  it('separates a within-session trend from repetition scatter', () => {
    const p = partitionVariation([0, 1, 2, 3].map((k) => ({ recordingId: `s${k}`, values: sess(100, 12, 1, -1.2) })));
    expect(p.trend!.slope).toBeLessThan(-0.8);
    expect(p.trend!.p!).toBeLessThan(0.05);
    expect(p.withinTrend!).toBeGreaterThan(p.withinResidual!);
  });
});

describe('motor flexibility index', () => {
  const curve = (trunkShare: number, noise: number, rng: ReturnType<typeof createRng>, outcome: number): number[] => {
    const out: number[] = [];
    for (const amp of [-trunkShare, 0, 1]) for (let k = 0; k < 101; k++) out.push(outcome * (amp * Math.sin((Math.PI * k) / 100) + rng.normal(0, noise)));
    return out;
  };
  const reps = (specs: { condition: string; sessionId: string; trunkShare: number; outcome: number; n: number }[], seed = 1): ConditionRep[] => {
    const rng = createRng(seed);
    return specs.flatMap((s) => Array.from({ length: s.n }, () => ({ condition: s.condition, sessionId: s.sessionId, outcome: s.outcome * (1 + rng.normal(0, 0.03)), x: [] as number[] })).map((r) => ({ ...r, x: curve(s.trunkShare, 0.02, rng, r.outcome) })));
  };
  const opt = { channels: FLEXIBILITY_CHANNELS, permutations: 199, bootstraps: 150, seed: 3 };
  it('refuses with one condition or too few repetitions', () => {
    expect(motorFlexibility(reps([{ condition: 'a', sessionId: 's', trunkShare: 0.1, outcome: 90, n: 12 }]), opt).verdict).toBe('insufficient_data');
    expect(motorFlexibility(reps([{ condition: 'a', sessionId: 's', trunkShare: 0.1, outcome: 90, n: 12 }, { condition: 'b', sessionId: 's', trunkShare: 0.3, outcome: 120, n: 5 }]), opt).verdict).toBe('insufficient_data');
  });
  it('pure scaling of the same organisation is not flexibility (share curves)', () => {
    const r = motorFlexibility(reps([{ condition: 'low', sessionId: 's', trunkShare: 0.15, outcome: 90, n: 14 }, { condition: 'high', sessionId: 's', trunkShare: 0.15, outcome: 120, n: 14 }]), opt);
    expect(r.verdict).toBe('no_adaptation_detected');
    expect(r.mfi!).toBeLessThan(0.5);
    // …whereas on ABSOLUTE curves the amplitude difference itself looks like a difference
    expect(motorFlexibility(reps([{ condition: 'low', sessionId: 's', trunkShare: 0.15, outcome: 90, n: 14 }, { condition: 'high', sessionId: 's', trunkShare: 0.15, outcome: 120, n: 14 }]), { ...opt, representation: 'absolute' }).mfi!).toBeGreaterThan(1);
  });
  it('a different trunk share between conditions in one session is condition-dependent organisation, carried by the trunk channel', () => {
    const r = motorFlexibility(reps([{ condition: 'low', sessionId: 's', trunkShare: 0.02, outcome: 90, n: 14 }, { condition: 'high', sessionId: 's', trunkShare: 0.2, outcome: 120, n: 14 }]), { ...opt, targets: { low: 90, high: 120 } });
    expect(r.verdict).toBe('condition_dependent_organisation');
    expect(r.ci95![0]).toBeGreaterThan(0);
    expect(r.byChannel[0]!.channel).toBe('trunk_pitch');
    expect(r.byChannel[0]!.share).toBeGreaterThan(0.9);
    expect(r.splitHalf!).toBeGreaterThan(0.9);
    expect(r.conditions.find((c) => c.condition === 'high')!.attainment!).toBeGreaterThan(0.9);
  });
  it('conditions that never share a session are confounded with re-attachment', () => {
    const r = motorFlexibility(reps([{ condition: 'low', sessionId: 's1', trunkShare: 0.02, outcome: 90, n: 14 }, { condition: 'high', sessionId: 's2', trunkShare: 0.2, outcome: 120, n: 14 }]), opt);
    expect(r.verdict).toBe('confounded_by_session');
    expect(r.p).toBeNull();
    expect(r.mfi!).toBeGreaterThan(1);
  });
});

describe('trunk–outcome trade-off', () => {
  const gen = (passThrough: number, n = 30, trunkSd = 5, seed = 2): TradeoffRep[] => {
    const rng = createRng(seed);
    return Array.from({ length: n }, () => {
      const trunk = -14 + trunkSd * rng.normal();
      return { outcome: 120 - passThrough * (trunk + 14) + rng.normal(0, 1.5), trunk, duration: 1.2 + 0.02 * -trunk + rng.normal(0, 0.05) };
    });
  };
  it('is feasible for sagittal arm raising with a trunk sensor only', () => {
    expect(tradeoffFeasibility('shoulder_flexion', true, 0.97).feasible).toBe(true);
    expect(tradeoffFeasibility('shoulder_abduction', true, 0.97).feasible).toBe(false);
    expect(tradeoffFeasibility('shoulder_flexion', false, null).feasible).toBe(false);
    expect(tradeoffFeasibility('shoulder_flexion', true, 0.7).feasible).toBe(false);
    expect(trunkOutcomeTradeoff(gen(1), { exercise: 'elbow_flexion' }).verdict).toBe('not_feasible');
  });
  it('recovers a preserved outcome (pass-through ≈ 0) and a passed-on one (≈ 1)', () => {
    const c = trunkOutcomeTradeoff(gen(0), { exercise: 'shoulder_flexion', uTrunk: 0.05, bootstraps: 300 });
    expect(c.verdict).toBe('outcome_preserved_against_trunk_variation');
    expect(Math.abs(c.passThrough!)).toBeLessThan(0.2);
    expect(c.varianceRatio!).toBeLessThan(0.3);
    const i = trunkOutcomeTradeoff(gen(1), { exercise: 'shoulder_flexion', uTrunk: 0.05, bootstraps: 300 });
    expect(i.verdict).toBe('trunk_variation_passes_into_outcome');
    expect(i.passThrough!).toBeGreaterThan(0.8);
    expect(i.passThrough!).toBeLessThan(1.2);
    expect(i.varianceRatio!).toBeGreaterThan(0.7);
    // more trunk share goes with longer movements in this generator: reported as an association with an adjusted p
    expect(c.costs.find((x) => x.descriptor === 'duration')!.pHolm!).toBeLessThan(0.05);
  });
  it('refuses when the trunk barely varies, when its variation is mostly noise, and with few repetitions', () => {
    expect(trunkOutcomeTradeoff(gen(1, 30, 0.3), { exercise: 'shoulder_flexion' }).verdict).toBe('trunk_barely_varies');
    expect(trunkOutcomeTradeoff(gen(1, 30, 1.5), { exercise: 'shoulder_flexion', uTrunk: 1.2 }).verdict).toBe('trunk_barely_varies');
    expect(trunkOutcomeTradeoff(gen(1, 8), { exercise: 'shoulder_flexion' }).verdict).toBe('insufficient_data');
  });
  it('never calls trunk contribution harmful', () => {
    const r = trunkOutcomeTradeoff(gen(0), { exercise: 'shoulder_flexion' });
    expect(r.verdict).not.toMatch(/harm|patholog|bad|worse|compensat/);
    expect(r.notes.join(' ')).toMatch(/not_labelled_helpful_or_harmful/);
  });
});

describe('movement signature and strategy shift', () => {
  const sessions = (P: number, individual: boolean, seed = 5): SignatureSession[] => {
    const rng = createRng(seed);
    return Array.from({ length: P }, (_, p) => {
      const base = individual ? [rng.normal(0, 10), rng.normal(0, 5), rng.normal(0, 0.2)] : [0, 0, 0];
      return [0, 1].map((k) => ({ participantId: `SYN-P${p}`, recordingId: `r${p}-${k}`, sessionIndex: k, features: { 'f:outcome': 100 + base[0]! + rng.normal(0, 2), 'f:trunk': -8 + base[1]! + rng.normal(0, 1), 'f:dur': 1.2 + base[2]! + rng.normal(0, 0.04) } }));
    }).flat();
  };
  it('needs five participants with two sessions', () => {
    expect(movementSignature(sessions(4, true)).verdict).toBe('insufficient_data');
  });
  it('finds a reproducible signature when participants differ and none when they do not', () => {
    const r = movementSignature(sessions(10, true), { permutations: 499 });
    expect(r.verdict).toBe('reproducible_signature');
    expect(r.identification!).toBeGreaterThan(0.7);
    expect(r.chance).toBeCloseTo(0.1, 10);
    expect(r.iDiff!).toBeGreaterThan(0);
    expect(r.features[0]!.icc).toBeGreaterThan(0.8);
    const n = movementSignature(sessions(10, false), { permutations: 499 });
    expect(n.verdict).toBe('no_reproducible_signature');
    expect(n.notes.join(' ')).toMatch(/not_an_identifier/);
  });
  it('strategy shift: insufficient, one strategy only, stable mixture, and a switch', () => {
    expect(strategyShift([{ sessionId: 'a', a: 3, b: 2 }]).verdict).toBe('insufficient_data');
    expect(strategyShift([{ sessionId: 'a', a: 10, b: 0 }, { sessionId: 'b', a: 10, b: 0 }]).verdict).toBe('no_shift_detected');
    expect(strategyShift([5, 6, 4, 5, 5].map((a, k) => ({ sessionId: `s${k}`, a, b: 10 - a })), { permutations: 499 }).verdict).toBe('no_shift_detected');
    const sw = strategyShift([1, 2, 9, 8, 9].map((a, k) => ({ sessionId: `s${k}`, a, b: 10 - a })), { permutations: 499 });
    expect(sw.verdict).toBe('shift_detected');
    expect(sw.split).toBe(2);
    expect(sw.shareBefore!).toBeCloseTo(0.15, 10);
    expect(sw.shareAfter!).toBeCloseTo(26 / 30, 10);
  });
});

describe('task framework', () => {
  it('an assessment step and a practice sitting with a target are not the same task condition', () => {
    const a = contextOfSession({ protocolId: 'upper_standard' }, 'shoulder_flexion', 'right');
    const p = contextOfPractice({ exercise: 'shoulder_flexion', side: 'right', targetDeg: 100, feedback: 'live_angle_with_target' });
    const c = comparability(a, p);
    expect(c.comparable).toBe(false);
    expect(c.reasons).toEqual(expect.arrayContaining(['different_setting_(assessment_vs_practice)', 'constraint_differs:_targetDeg', 'constraint_differs:_feedback']));
    expect(conditionKey(a)).not.toBe(conditionKey(p));
  });
  it('two practice sittings with different targets are comparable only when the target is the declared manipulation', () => {
    const p1 = contextOfPractice({ exercise: 'shoulder_flexion', side: 'right', targetDeg: 90, feedback: 'live_angle_with_target' });
    const p2 = contextOfPractice({ exercise: 'shoulder_flexion', side: 'right', targetDeg: 120, feedback: 'live_angle_with_target' });
    expect(comparability(p1, p2).comparable).toBe(false);
    const v = comparability(p1, p2, ['targetDeg']);
    expect(v.comparable).toBe(true);
    // dimensions nobody recorded are named, never assumed equal
    expect(v.unknown).toEqual(expect.arrayContaining(['support', 'object']));
    expect(comparability(p1, { ...p1, side: 'left' }).reasons).toContain('different_arm');
  });
  it('the task library says which research tasks the sensors cannot record', () => {
    const reach = TASK_LIBRARY.find((t) => t.id === 'reach_forward')!;
    expect(reach.status).toBe('not_recordable');
    expect(reach.notObservable).toMatch(/hand path/);
    expect(TASK_LIBRARY.filter((t) => t.status === 'recordable').map((t) => t.exercise)).toEqual(['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'forearm_rotation']);
  });
});
