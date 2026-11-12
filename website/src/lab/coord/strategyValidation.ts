// Validation of the strategy layer (profile.ts, flexibility.ts, signature.ts) on SYNTHETIC ground truth, through
// the app's IMU measurement model (participants "SYN-*"). Criteria fixed on 2026-11-10 before the reported runs; one
// development example per analysis was used while writing the code and is not part of any reported number.
//
//   S1  same outcome, different strategy   (acceptance test A)  profile differences in the right features only
//   S2  no change, sensors re-attached     (acceptance test B)  no difference reported as beyond placement
//   S3  flexibility index                  false alarms under pure scaling; power under a real change of organisation
//   S4  trunk–outcome trade-off            recovery of pass-through 0 (compensated) and 1 (independent)
//   S5  movement signature                 identification with individual signatures; chance level without them
//   S6  strategy shift                     false alarms under a stable mixture; power under a switch

import { round, wilson, type BenchmarkRecord } from '../benchmark';
import { createRng } from '../../lib/random';
import { REPLACEMENT_MARGIN_DEG, DEFAULT_DISSOCIATION } from './dissociation';
import { featureVector } from './align';
import type { ChannelId } from './channels';
import { recordingFeatures, type RecordingFeatures, type RepFeatureId } from '../measure/repFeatures';
import { FRONTIER_VERSIONS } from '../version';
import { FLEXIBILITY_CHANNELS, motorFlexibility, trunkOutcomeTradeoff, type ConditionRep, type TradeoffRep } from './flexibility';
import { buildStrategyProfile, compareProfiles, equivalent, partitionProfiles, profileFromFeatures, type MotorStrategyProfile } from './profile';
import { movementSignature, strategyShift, type SignatureSession } from './signature';
import { STRATEGIES, generateSession, type Perturbations, type StrategySpec, type SynthRecording } from './synthetic';
import type { TaskContext } from '../tasks/library';
import { UNRECORDED } from '../tasks/library';

const V = FRONTIER_VERSIONS.strategy;
const rec = (r: Omit<BenchmarkRecord, 'component' | 'version'>): BenchmarkRecord => ({ ...r, component: 'strategy', version: V });

export const STRATEGY_CRITERIA = {
  S1_detect_min: 0.9,
  S1_false_outcome_max: 0.1,
  S2_false_beyond_max: 0.1,
  S3_false_max: 0.1,
  S3_power_min: 0.8,
  S4_abs_error_max: 0.25,
  S5_identification_min: 0.6,
  S5_null_false_max: 0.1,
  S6_false_max: 0.1,
  S6_power_min: 0.8,
} as const;

export const CURVE_CHANNELS: readonly ChannelId[] = ['trunk_pitch', 'trunk_roll', 'upper_elev', 'fore_elev', 'elbow_flex'];
const BASE = { duration: { mean: 1.2, cv: 0.1 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.03 };
const TASK: TaskContext = { exercise: 'shoulder_flexion', side: 'right', setting: 'synthetic', protocolId: null, constraints: { ...UNRECORDED, targetDeg: 'none', direction: 'forward', speed: 'self_paced', startPosition: 'arms_hanging', feedback: 'none' } };

export function synthSession(pid: string, idx: number, seq: StrategySpec[], seed: number, perturb?: Perturbations, base: Partial<typeof BASE> = {}): SynthRecording {
  return generateSession({ participantId: pid, sessionIndex: idx, exercise: 'shoulder_flexion', side: 'right', sequence: seq, seed, ...BASE, ...base, ...(perturb ? { perturb } : {}) });
}

/** Ground-truth strategy id of each analysed repetition (the truth repetition whose endpoint lies inside it). */
export function truthOf(r: SynthRecording, rf: RecordingFeatures): (string | null)[] {
  return rf.reps.map((x) => r.truth.find((q) => q.endpoint >= x.tOnset - 0.2 && q.endpoint <= x.tOffset)?.strategy ?? null);
}

function shuffled<T>(xs: T[], rng: ReturnType<typeof createRng>): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

const profile = (r: SynthRecording, reference?: MotorStrategyProfile | null) => buildStrategyProfile({ frames: r.frames, meta: r.meta }, { task: TASK, ...(reference !== undefined ? { reference: reference?.mount ?? null } : {}) });

// ── S1 / S2 ───────────────────────────────────────────────────────────────────────────────────────────────

export function s1SameOutcomeDifferentStrategy(replicates: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  let detect = 0;
  let outcomeEq = 0;
  let outcomeFalse = 0;
  let unrelatedFalse = 0;
  let nullFalse = 0;
  for (let r = 0; r < replicates; r++) {
    const seed = 41_000 + 17 * r;
    // the SAME sensors stay on (one mount) — two blocks of 12 repetitions, different strategies, equal world outcome
    const a = profile(synthSession('SYN-S1', 0, Array(12).fill(STRATEGIES.armDominant) as StrategySpec[], seed, { mountSeed: seed, noiseSeed: seed + 1 }));
    const b = profile(synthSession('SYN-S1', 0, Array(12).fill(STRATEGIES.trunkAssisted) as StrategySpec[], seed + 2, { mountSeed: seed, noiseSeed: seed + 3 }), a);
    const d = compareProfiles(a, b);
    const get = (id: RepFeatureId) => d.find((x) => x.id === id);
    if (get('exc_trunk_pitch')?.verdict === 'beyond_noise' && get('trunk_contribution')?.verdict === 'beyond_noise') detect++;
    const o = get('outcome');
    if (o && equivalent(o, DEFAULT_DISSOCIATION.marginDeg)) outcomeEq++;
    if (o?.verdict === 'beyond_noise') outcomeFalse++;
    if (get('exc_trunk_roll')?.verdict === 'beyond_noise') unrelatedFalse++;
    // null: two blocks of the same strategy
    const c = profile(synthSession('SYN-S1', 0, Array(12).fill(STRATEGIES.armDominant) as StrategySpec[], seed + 4, { mountSeed: seed, noiseSeed: seed + 5 }), a);
    if (compareProfiles(a, c).some((x) => (x.id === 'exc_trunk_pitch' || x.id === 'trunk_contribution') && x.verdict === 'beyond_noise')) nullFalse++;
  }
  const [lo, hi] = wilson(detect, replicates);
  return [
    rec({
      id: 'S1a', name: 'Same outcome, different strategy: detection', purpose: 'When two blocks reach the same arm inclination with different trunk involvement, do the profiles differ in the trunk features?',
      assumptions: 'Arm-dominant vs trunk-assisted repetitions (both ≈ 120° world arm inclination), 12 per block, same sensors on, MPU-6050 noise', groundTruth: 'Strategies differ by 18° of trunk pitch; the task outcome is equal by construction',
      metric: 'share of replicates where trunk pitch excursion AND trunk contribution are "beyond_noise"', criterion: `≥ ${STRATEGY_CRITERIA.S1_detect_min}`,
      cases: replicates, value: round(detect / replicates), detail: { ci95: `[${round(lo)}, ${round(hi)}]`, outcome_equivalent_within_5deg: round(outcomeEq / replicates), trunk_roll_called_different: round(unrelatedFalse / replicates) }, pass: detect / replicates >= STRATEGY_CRITERIA.S1_detect_min,
      knownFailureModes: ['a strategy difference in a channel the sensors do not observe (scapula, wrist) is invisible', 'outcome equivalence needs ≥ ≈ 12 repetitions per block at 6° outcome SD'], mode,
    }),
    rec({
      id: 'S1b', name: 'Same outcome, different strategy: the outcome is not called different', purpose: 'Is the task outcome falsely reported as changed when only the strategy differs, and are trunk features falsely different when nothing differs?',
      assumptions: 'As S1a; plus a null comparison of two blocks of the same strategy', groundTruth: 'Equal outcome; identical strategy in the null comparison',
      metric: 'largest of: share with outcome "beyond_noise"; share of null comparisons with a trunk feature "beyond_noise"', criterion: `≤ ${STRATEGY_CRITERIA.S1_false_outcome_max}`,
      cases: 2 * replicates, value: round(Math.max(outcomeFalse, nullFalse) / replicates), detail: { outcome_called_different: round(outcomeFalse / replicates), null_trunk_called_different: round(nullFalse / replicates) }, pass: Math.max(outcomeFalse, nullFalse) / replicates <= STRATEGY_CRITERIA.S1_false_outcome_max,
      knownFailureModes: ['per-feature tests at 5 % each: with 15 features about one spurious "beyond_noise" per two comparisons is expected somewhere — only pre-named features should be read'], mode,
    }),
  ];
}

export function s2Reattachment(replicates: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  let falseBeyond = 0;
  let flagged = 0;
  let partitionFalse = 0;
  const deltas: number[] = [];
  for (let r = 0; r < replicates; r++) {
    // run 1 (seeds 42000+) FAILED (0.125): the placement bound ignored that strap tilt and posture can cancel.
    // The attribution bound now includes STRAP_TILT_ALLOWANCE_DEG; run 2 uses seeds 142000+.
    const seed = 142_000 + 19 * r;
    const rng = createRng(seed);
    const seq = Array(12).fill(STRATEGIES.armDominant) as StrategySpec[];
    // the SAME movement (same movement seed); sensors re-attached (new mount) and the calibration posture off by 3–8°
    const a = profile(synthSession('SYN-S2', 0, seq, seed, { mountSeed: seed + 1, noiseSeed: seed + 2 }));
    const posture = 3 + 5 * rng.next();
    const b = profile(synthSession('SYN-S2', 1, seq, seed, { mountSeed: seed + 3, noiseSeed: seed + 4, calibrationPosture: { flexion: posture } }), a);
    const d = compareProfiles(a, b);
    const o = d.find((x) => x.id === 'outcome');
    if (o) deltas.push(o.delta);
    if (o?.verdict === 'beyond_noise') falseBeyond++;
    if (b.placement && b.placement.level !== 'high') flagged++;
    // four re-attached sessions of the same movement: the partition must not claim a change of the movement
    const feats = new Map<string, RecordingFeatures>();
    const profiles: MotorStrategyProfile[] = [];
    for (let k = 0; k < 4; k++) {
      const s = synthSession('SYN-S2', k, seq, seed, { mountSeed: seed + 10 + k, noiseSeed: seed + 20 + k, calibrationPosture: { flexion: k === 0 ? 0 : 6 * rng.next() } });
      const rf = recordingFeatures(s.frames, s.meta, 'shoulder_flexion');
      feats.set(s.meta.id, rf);
      profiles.push(profileFromFeatures({ frames: s.frames, meta: s.meta }, rf, { task: TASK, reference: k === 0 ? null : (profiles[0] as MotorStrategyProfile).mount }));
    }
    if (partitionProfiles(profiles, feats, 'outcome', () => 'same').verdicts.includes('exceeds_measurement_explanations')) partitionFalse++;
  }
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  return [
    rec({
      id: 'S2', name: 'No change, sensors re-attached', purpose: 'When the movement is unchanged but the sensors are re-attached and the calibration posture is off by 3–8°, is a change of the movement reported?',
      assumptions: 'Identical movement plan in both sessions; new strap misalignment, offsets and biases; arm held 3–8° forward in the second calibration', groundTruth: 'No change of the movement; the measured outcome shifts by about the posture error',
      metric: 'largest of: share where the outcome difference is "beyond_noise" (not attributed to placement); share where 4 re-attached sessions are said to exceed measurement explanations', criterion: `≤ ${STRATEGY_CRITERIA.S2_false_beyond_max}`,
      cases: 2 * replicates, value: round(Math.max(falseBeyond, partitionFalse) / replicates), detail: { outcome_beyond_noise: round(falseBeyond / replicates), placement_flagged_not_high: round(flagged / replicates), partition_exceeds: round(partitionFalse / replicates), mean_outcome_shift_deg: round(meanDelta, 2), replacement_margin_deg: REPLACEMENT_MARGIN_DEG }, pass: Math.max(falseBeyond, partitionFalse) / replicates <= STRATEGY_CRITERIA.S2_false_beyond_max,
      knownFailureModes: ['run 1 failed (12.5 %): strap tilt and posture cancelled in the calibration direction; a 5° strap allowance was added to the attribution bound (provisional)', 'the guard works by REFUSING to attribute: a real change smaller than ≈ 7° + 1.4 × the tilt difference between two sessions is also reported as "within_placement"', 'a posture error that leaves the calibration tilt unchanged (e.g. compensated by strap tilt) is not flagged'], mode,
    }),
  ];
}

// ── S3 flexibility ────────────────────────────────────────────────────────────────────────────────────────

function conditionReps(r: SynthRecording): ConditionRep[] {
  const rf = recordingFeatures(r.frames, r.meta, 'shoulder_flexion');
  const t = truthOf(r, rf);
  const out: ConditionRep[] = [];
  rf.reps.forEach((x, i) => {
    const v = featureVector(x.aligned, FLEXIBILITY_CHANNELS);
    const c = t[i];
    if (v && c && x.values.outcome !== undefined) out.push({ condition: c, sessionId: r.meta.id, outcome: x.values.outcome, x: v });
  });
  return out;
}

export function s3Flexibility(replicates: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  // low and high target; "scaled" = the same organisation at 75 % amplitude; "changed" = arm-only for the low
  // target, trunk-assisted for the high one
  const hi: StrategySpec = { ...STRATEGIES.trunkAssisted, id: 'target_high' };
  const loScaled: StrategySpec = { ...STRATEGIES.trunkAssisted, id: 'target_low', shoulder: 76.5, trunkPitch: -13.5, elbow: 3.75 };
  const loChanged: StrategySpec = { ...STRATEGIES.armDominant, id: 'target_low', shoulder: 90, elbow: 3.75 };
  const run = (low: StrategySpec, seed: number, perCond: number, separateSessions = false) => {
    const rng = createRng(seed);
    if (separateSessions) {
      const a = conditionReps(synthSession('SYN-S3', 0, Array(perCond).fill(low) as StrategySpec[], seed));
      const b = conditionReps(synthSession('SYN-S3', 1, Array(perCond).fill(hi) as StrategySpec[], seed + 1));
      return motorFlexibility([...a, ...b], { channels: FLEXIBILITY_CHANNELS, seed, permutations: 499, bootstraps: 300, targets: { target_low: 90, target_high: 120 } });
    }
    const seq = shuffled([...(Array(perCond).fill(low) as StrategySpec[]), ...(Array(perCond).fill(hi) as StrategySpec[])], rng);
    return motorFlexibility(conditionReps(synthSession('SYN-S3', 0, seq, seed)), { channels: FLEXIBILITY_CHANNELS, seed, permutations: 499, bootstraps: 300, targets: { target_low: 90, target_high: 120 } });
  };
  let fa = 0;
  let pw = 0;
  let conf = 0;
  const mfiNull: number[] = [];
  const mfiAlt: number[] = [];
  for (let r = 0; r < replicates; r++) {
    // development (channel choice) used seeds 43000+ and 43500+; the reported run uses 143000+
    const a = run(loScaled, 143_000 + 11 * r, 12);
    if (a.verdict === 'condition_dependent_organisation') fa++;
    if (a.mfi !== null) mfiNull.push(a.mfi);
    const b = run(loChanged, 143_500 + 11 * r, 12);
    if (b.verdict === 'condition_dependent_organisation') pw++;
    if (b.mfi !== null) mfiAlt.push(b.mfi);
    if (run(loChanged, 144_000 + 11 * r, 12, true).verdict === 'confounded_by_session') conf++;
  }
  const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? NaN;
  return [
    rec({
      id: 'S3a', name: 'Flexibility index: no false adaptation under pure scaling', purpose: 'If the child reaches a higher target with the SAME organisation scaled up, is "condition-dependent organisation" reported?',
      assumptions: 'Two target heights interleaved in one session, 12 repetitions each; the low-target movement is the high-target movement at 75 % amplitude; share curves', groundTruth: 'Organisation identical (shares equal)',
      metric: 'share of replicates with verdict condition_dependent_organisation', criterion: `≤ ${STRATEGY_CRITERIA.S3_false_max}`,
      cases: replicates, value: round(fa / replicates), detail: { median_index_under_scaling: round(med(mfiNull), 2), ci95: `[${wilson(fa, replicates).map((x) => round(x)).join(', ')}]` }, pass: fa / replicates <= STRATEGY_CRITERIA.S3_false_max,
      knownFailureModes: ['forearm inclination and elbow flexion are excluded: their dynamic error grows with speed² and faked adaptation in 3 of 8 development sessions', 'a fixed (non-scaling) movement component, e.g. a constant trunk sway, makes shares differ between amplitudes and is read as adaptation', 'timing differences between conditions survive landmark registration only partly'], mode,
    }),
    rec({
      id: 'S3b', name: 'Flexibility index: power for a real change of organisation', purpose: 'If the low target is reached with the arm alone and the high target with trunk assistance, is it detected?',
      assumptions: 'As S3a; low target arm-only (0° trunk), high target trunk-assisted (18° trunk)', groundTruth: 'Organisation differs between conditions',
      metric: 'share of replicates with verdict condition_dependent_organisation', criterion: `≥ ${STRATEGY_CRITERIA.S3_power_min}`,
      cases: replicates, value: round(pw / replicates), detail: { median_index: round(med(mfiAlt), 2), conditions_in_separate_sessions_called_confounded: round(conf / replicates) }, pass: pw / replicates >= STRATEGY_CRITERIA.S3_power_min,
      knownFailureModes: ['conditions recorded in different sessions are refused (confounded with re-attachment) however large the difference'], mode,
    }),
  ];
}

// ── S4 trade-off ──────────────────────────────────────────────────────────────────────────────────────────

export function s4Tradeoff(replicates: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  const est: Record<'compensated' | 'independent', number[]> = { compensated: [], independent: [] };
  const verdicts: Record<string, number> = {};
  let covered = 0;
  let total = 0;
  for (let r = 0; r < replicates; r++)
    for (const kind of ['compensated', 'independent'] as const) {
      const seed = 45_000 + 13 * r + (kind === 'compensated' ? 0 : 7);
      const rng = createRng(seed);
      const seq: StrategySpec[] = Array.from({ length: 24 }, (_, i) => {
        const pitch = -14 + 5 * rng.normal();
        // compensated: the shoulder makes up exactly for the trunk (world outcome ≈ 120°); independent: it does not
        const shoulder = kind === 'compensated' ? 120 + pitch + 1.5 * rng.normal() : 106 + 4 * rng.normal();
        return { ...STRATEGIES.trunkAssisted, id: `r${i}`, shoulder, trunkPitch: pitch };
      });
      const s = synthSession('SYN-S4', 0, seq, seed, undefined, { amplitudeCv: 0, jitterDeg: 0 });
      const rf = recordingFeatures(s.frames, s.meta, 'shoulder_flexion');
      const reps: TradeoffRep[] = rf.reps.filter((x) => x.values.outcome !== undefined && x.values.exc_trunk_pitch !== undefined).map((x) => ({ outcome: x.values.outcome as number, trunk: x.values.exc_trunk_pitch as number, ...(x.values.dur_outbound !== undefined ? { duration: x.values.dur_outbound } : {}), ...(x.values.peak_rate !== undefined ? { peakRate: x.values.peak_rate } : {}) }));
      const t = trunkOutcomeTradeoff(reps, { exercise: 'shoulder_flexion', uTrunk: 0.04, seed, bootstraps: 400 });
      verdicts[`${kind}:${t.verdict}`] = (verdicts[`${kind}:${t.verdict}`] ?? 0) + 1;
      if (t.passThrough !== null && t.ci95) {
        est[kind].push(t.passThrough);
        const truth = kind === 'compensated' ? 0 : 1;
        total++;
        if (t.ci95[0] <= truth && t.ci95[1] >= truth) covered++;
      }
    }
  const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const errC = Math.abs(m(est.compensated) - 0);
  const errI = Math.abs(m(est.independent) - 1);
  return [
    rec({
      id: 'S4', name: 'Trunk–outcome trade-off: recovery of the pass-through', purpose: 'Is the share of trunk variation that passes into the task outcome recovered when the arm fully compensates (0) and when it does not (1)?',
      assumptions: 'Sagittal arm raising, 24 repetitions, trunk pitch SD 5°; planar chain outcome = arm relative to trunk − trunk pitch; trunk noise 0.04°', groundTruth: 'pass-through 0 (shoulder = 120° + pitch) and 1 (shoulder independent of pitch)',
      metric: 'largest |mean estimated pass-through − truth| over the two designs', criterion: `≤ ${STRATEGY_CRITERIA.S4_abs_error_max}`,
      cases: 2 * replicates, value: round(Math.max(errC, errI)), detail: { mean_compensated: round(m(est.compensated)), mean_independent: round(m(est.independent)), ci95_coverage: round(covered / Math.max(1, total)), ...verdicts }, pass: Math.max(errC, errI) <= STRATEGY_CRITERIA.S4_abs_error_max,
      knownFailureModes: ['out-of-plane arm movement breaks the planar model (refused below planarity 0.9)', 'if the trunk barely varies the slope is undefined (refused below 1° SD)', 'a common drive (both trunk and arm larger on "effortful" repetitions) is read as pass-through > 1, not as compensation'], mode,
    }),
  ];
}

// ── S5 signature ──────────────────────────────────────────────────────────────────────────────────────────

const SIG_FEATURES: readonly RepFeatureId[] = ['outcome', 'exc_trunk_pitch', 'exc_elbow_flex', 'trunk_contribution', 'dur_outbound', 'peak_rate', 'onset_lag_trunk_ms', 'time_to_peak_fraction'];

function signatureSessions(participants: number, seed: number, individual: boolean): SignatureSession[] {
  const rng = createRng(seed);
  const out: SignatureSession[] = [];
  for (let p = 0; p < participants; p++) {
    const spec: StrategySpec = individual
      ? { ...STRATEGIES.armDominant, id: `p${p}`, shoulder: 105 + 10 * rng.normal(), trunkPitch: -8 + 7 * rng.normal(), elbow: 8 + 12 * Math.abs(rng.normal()), trunkDelay: 0.12 * rng.normal() }
      : { ...STRATEGIES.armDominant, id: 'same', shoulder: 105, trunkPitch: -8, elbow: 12 };
    const dur = individual ? 1.0 + 0.5 * rng.next() : 1.2;
    for (let k = 0; k < 2; k++) {
      // each session: sensors re-attached (new mount by default), new repetitions
      const s = synthSession(`SYN-S5-${p}`, k, Array(8).fill(spec) as StrategySpec[], seed + 1000 * p + 31 * k, undefined, { duration: { mean: dur, cv: 0.1 } });
      const rf = recordingFeatures(s.frames, s.meta, 'shoulder_flexion');
      const features: Record<string, number> = {};
      for (const f of SIG_FEATURES) {
        const v = rf.reps.map((x) => x.values[f]).filter((x): x is number => x !== undefined);
        if (v.length) features[`shoulder_flexion:${f}`] = v.reduce((a, b) => a + b, 0) / v.length;
      }
      out.push({ participantId: `SYN-S5-${p}`, recordingId: s.meta.id, sessionIndex: k, features });
    }
  }
  return out;
}

export function s5Signature(replicates: number, participants: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  const ids: number[] = [];
  let sig = 0;
  let nullSig = 0;
  const top: Record<string, number> = {};
  for (let r = 0; r < replicates; r++) {
    const a = movementSignature(signatureSessions(participants, 46_000 + 97 * r, true), { seed: r, permutations: 499 });
    if (a.identification !== null) ids.push(a.identification);
    if (a.verdict === 'reproducible_signature') sig++;
    const best = a.features[0]?.feature;
    if (best) top[best] = (top[best] ?? 0) + 1;
    if (movementSignature(signatureSessions(participants, 47_000 + 97 * r, false), { seed: r, permutations: 499 }).verdict === 'reproducible_signature') nullSig++;
  }
  const mean = ids.reduce((a, b) => a + b, 0) / Math.max(1, ids.length);
  return [
    rec({
      id: 'S5a', name: 'Movement signature: identification across re-attached sessions', purpose: 'Is a participant\'s second session matched to their own first session when participants differ in their movement organisation?',
      assumptions: `${participants} synthetic participants with individual shoulder/trunk/elbow amplitudes, trunk timing and speed; 2 sessions × 8 repetitions; sensors re-attached between sessions`, groundTruth: 'Each participant has their own generating parameters',
      metric: 'mean identification rate (chance = 1 / participants)', criterion: `≥ ${STRATEGY_CRITERIA.S5_identification_min}`,
      cases: replicates, value: round(mean), detail: { chance: round(1 / participants), significant_share: round(sig / replicates), most_person_specific_feature: Object.entries(top).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'n/a' }, pass: mean >= STRATEGY_CRITERIA.S5_identification_min,
      knownFailureModes: ['synthetic participants differ far more cleanly than real children; real identification is unknown', 'features sensitive to placement (elbow, trunk roll) would masquerade as signature if a participant always wore the sensors the same wrong way'], mode,
    }),
    rec({
      id: 'S5b', name: 'Movement signature: no signature when participants do not differ', purpose: 'Is a signature reported when every participant moves by the same generating parameters?',
      assumptions: `${participants} participants with identical parameters; only repetition variability and re-attachment differ`, groundTruth: 'No person-specific information',
      metric: 'share of replicates with verdict reproducible_signature', criterion: `≤ ${STRATEGY_CRITERIA.S5_null_false_max}`,
      cases: replicates, value: round(nullSig / replicates), detail: {}, pass: nullSig / replicates <= STRATEGY_CRITERIA.S5_null_false_max,
      knownFailureModes: [], mode,
    }),
  ];
}

// ── S6 strategy shift ─────────────────────────────────────────────────────────────────────────────────────

export function s6Shift(replicates: number, mode: 'quick' | 'full'): BenchmarkRecord[] {
  const rng = createRng(48_000);
  const sim = (shares: number[], perSession: number) => shares.map((p, k) => {
    let a = 0;
    for (let i = 0; i < perSession; i++) if (rng.next() < p) a++;
    return { sessionId: `s${k}`, a, b: perSession - a };
  });
  let fa = 0;
  let pw = 0;
  let pwGradual = 0;
  for (let r = 0; r < replicates; r++) {
    if (strategyShift(sim([0.5, 0.5, 0.5, 0.5, 0.5], 10), { seed: r, permutations: 499 }).verdict === 'shift_detected') fa++;
    if (strategyShift(sim([0.2, 0.2, 0.8, 0.8, 0.8], 10), { seed: r, permutations: 499 }).verdict === 'shift_detected') pw++;
    if (strategyShift(sim([0.2, 0.35, 0.5, 0.65, 0.8], 10), { seed: r, permutations: 499 }).verdict === 'shift_detected') pwGradual++;
  }
  return [
    rec({
      id: 'S6a', name: 'Strategy shift: false alarms under a stable mixture', purpose: 'With one stable 50/50 mixture of two strategies over 5 sessions, how often is a shift reported?',
      assumptions: '5 sessions × 10 confidently assigned repetitions, independent assignments', groundTruth: 'Constant share 0.5', metric: 'share of replicates with verdict shift_detected', criterion: `≤ ${STRATEGY_CRITERIA.S6_false_max}`,
      cases: replicates, value: round(fa / replicates), detail: { ci95: `[${wilson(fa, replicates).map((x) => round(x)).join(', ')}]` }, pass: fa / replicates <= STRATEGY_CRITERIA.S6_false_max,
      knownFailureModes: ['assignments within a session are not independent if strategies persist in runs: the permutation is then anti-conservative'], mode,
    }),
    rec({
      id: 'S6b', name: 'Strategy shift: power for a switch', purpose: 'Is a change of the share from 0.2 to 0.8 between sessions 2 and 3 detected?',
      assumptions: 'As S6a', groundTruth: 'Share 0.2, 0.2, 0.8, 0.8, 0.8', metric: 'share of replicates with verdict shift_detected', criterion: `≥ ${STRATEGY_CRITERIA.S6_power_min}`,
      cases: replicates, value: round(pw / replicates), detail: { power_for_a_gradual_change_0_2_to_0_8: round(pwGradual / replicates) }, pass: pw / replicates >= STRATEGY_CRITERIA.S6_power_min,
      knownFailureModes: ['a single split describes a gradual change poorly: power is lower and the split position is not meaningful'], mode,
    }),
  ];
}

export function strategyValidation(full: boolean): BenchmarkRecord[] {
  const mode = full ? 'full' : 'quick';
  return [
    ...s1SameOutcomeDifferentStrategy(full ? 40 : 2, mode),
    ...s2Reattachment(full ? 40 : 2, mode),
    ...s3Flexibility(full ? 40 : 1, mode),
    ...s4Tradeoff(full ? 40 : 2, mode),
    ...s5Signature(full ? 20 : 1, 8, mode),
    ...s6Shift(full ? 400 : 10, mode),
  ];
}
