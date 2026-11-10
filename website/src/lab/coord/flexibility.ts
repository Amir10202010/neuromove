// Two EXPLORATORY analyses of how movement organisation relates to the task. Neither is a validated biomarker; both
// state when the data cannot support them.
//
// 1. Motor Flexibility Index (MFI) — does the ORGANISATION of the movement change when the task condition changes,
//    relative to how consistently it is organised within a condition?
//      s²   pooled within-condition variance per curve sample            (within-task consistency)
//      D²   mean squared difference between two condition mean curves
//      δ²   = max(0, D² − s²(1/n_a + 1/n_b))                             (between-task adaptation, sampling noise removed)
//      MFI  = δ / s                                                      (dimensionless; 0 = no adaptation detectable)
//    Computed by default on SHARE curves (each repetition's curves divided by its own task outcome): reaching
//    further with the same organisation gives identical share curves, so pure scaling is not "flexibility".
//    Inference: permutation of condition labels WITHIN sessions (p), bootstrap CI of the MFI, split-half
//    reproducibility of the difference pattern. Conditions that never share a session cannot be told apart from
//    sensor re-attachment — the verdict is then 'confounded_by_session'.
//    This is not "less variability is better": high within-condition variability lowers the index, and so does an
//    organisation that does not respond to the task; which of these is desirable is not for this number to say.
//    Channels: trunk pitch, trunk roll and upper-arm inclination ONLY (FLEXIBILITY_CHANNELS). Development finding
//    (8 synthetic sessions, seeds 43000+, before any reported run): with forearm inclination or elbow flexion in
//    the curves, the same organisation at two amplitudes was called "condition-dependent" in 3 of 8 sessions — 94 %
//    of the spurious difference sat in the forearm channel. Cause: the forearm sensor is ≈ 0.37 m from the shoulder,
//    its centripetal acceleration (∝ ω²r, 0.2–0.4 g here) pulls the gravity tracker during the movement, and that
//    error grows with the SQUARE of the speed, so it does not scale with the movement. Conditions that differ in
//    amplitude or speed therefore differ in distal-channel ERROR. With the three proximal channels: 0 of 8.
//
// 2. Trunk–outcome trade-off — when the trunk contributes more on one repetition than on another, what happens to
//    the task outcome? Regression of the outcome on the signed trunk excursion in the task plane across repetitions
//    of ONE condition:
//      pass-through = −slope   ≈ 0  trunk variation is absorbed by the arm (the outcome is preserved)
//                              ≈ 1  trunk variation passes into the outcome (arm relative to trunk unaffected)
//    In the planar chain model outcome = (arm relative to trunk) − trunk pitch, pass-through 1 is what independent
//    trunk and arm variation gives, so pass-through < 1 is the covariation that stabilises the outcome ("motor
//    abundance" in the smallest valid case: two measured elements, one task variable; Scholz & Schöner 1999).
//    Valid for sagittal-plane arm raising only (feasibility checked); errors-in-variables attenuation from trunk
//    measurement noise is corrected when the noise is known and refused when it dominates.
//    The analysis describes a relationship. It never labels trunk motion as harmful: the same contribution can make
//    a task possible or mask limited arm capacity, depending on the task.

import { tQuantile } from '../../research/stats';
import { kendallTau } from '../measure/stats';
import type { ChannelId } from './channels';
import { GRID } from './align';
import { bootstrapIndices, createRng, mean, quantileOf, shuffle } from './stats';

// ── Motor Flexibility Index ───────────────────────────────────────────────────────────────────────────────

export interface ConditionRep {
  /** Task-condition key (tasks/library.ts conditionKey). */
  condition: string;
  sessionId: string;
  outcome: number;
  /** Channel-major concatenation of GRID samples per channel (as RepRecord.x). */
  x: number[];
}

export interface FlexibilityOptions {
  channels: readonly ChannelId[];
  representation?: 'share' | 'absolute';
  /** Target outcome of each condition (degrees), when the protocol sets one. */
  targets?: Readonly<Record<string, number>>;
  /** A repetition "attains" its target when outcome ≥ (1 − tolerance) × target. */
  attainTolerance?: number;
  permutations?: number;
  bootstraps?: number;
  seed?: number;
}

/** Channels the index is computed on (see the development finding above). */
export const FLEXIBILITY_CHANNELS: readonly ChannelId[] = ['trunk_pitch', 'trunk_roll', 'upper_elev'];

export const FLEXIBILITY_RULE = { minPerCondition: 8, minOutcomeDeg: 20, alpha: 0.05, coOccurrence: 3 } as const;

export type FlexibilityVerdict = 'insufficient_data' | 'confounded_by_session' | 'no_adaptation_detected' | 'condition_dependent_organisation';

export interface FlexibilityResult {
  verdict: FlexibilityVerdict;
  reasons: string[];
  representation: 'share' | 'absolute';
  conditions: { condition: string; n: number; outcomeMean: number; outcomeSd: number; target: number | null; attainment: number | null }[];
  /** Within-condition SD per curve sample (share units or degrees). */
  within: number | null;
  /** Between-condition RMS difference with sampling noise removed (same units). */
  between: number | null;
  mfi: number | null;
  ci95: [number, number] | null;
  p: number | null;
  /** Share of the between-condition difference carried by each channel. */
  byChannel: { channel: ChannelId; share: number }[];
  /** Congruence of the condition-difference pattern between odd and even repetitions (−1…1). */
  splitHalf: number | null;
  /** Outcome equivalence is NOT required here: conditions differ in what they ask for. */
  notes: string[];
}

function toRep(r: ConditionRep, representation: 'share' | 'absolute'): number[] | null {
  if (representation === 'absolute') return r.x;
  if (!(Math.abs(r.outcome) >= FLEXIBILITY_RULE.minOutcomeDeg)) return null;
  return r.x.map((v) => v / r.outcome);
}

function meanVec(rows: readonly number[][]): number[] {
  const d = rows[0]?.length ?? 0;
  const m = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) m[j] = (m[j] as number) + (r[j] as number) / rows.length;
  return m;
}

/** s² (pooled within variance per sample), mean pairwise D², bias-corrected δ² and the pairwise mean-difference vector. */
function flexStats(groups: readonly number[][][]): { s2: number; d2: number; delta2: number; diff: number[] } {
  const d = groups[0]?.[0]?.length ?? 0;
  const means = groups.map(meanVec);
  let ss = 0;
  let df = 0;
  groups.forEach((g, k) => {
    for (const r of g) for (let j = 0; j < d; j++) ss += ((r[j] as number) - ((means[k] as number[])[j] as number)) ** 2;
    df += g.length - 1;
  });
  const s2 = df > 0 && d > 0 ? ss / (df * d) : NaN;
  let d2 = 0;
  let delta2 = 0;
  let pairs = 0;
  const diff = new Array<number>(d).fill(0);
  for (let a = 0; a < groups.length; a++)
    for (let b = a + 1; b < groups.length; b++) {
      let q = 0;
      for (let j = 0; j < d; j++) {
        const e = ((means[b] as number[])[j] as number) - ((means[a] as number[])[j] as number);
        q += e * e;
        diff[j] = (diff[j] as number) + e;
      }
      q /= d;
      d2 += q;
      delta2 += Math.max(0, q - s2 * (1 / (groups[a] as number[][]).length + 1 / (groups[b] as number[][]).length));
      pairs++;
    }
  return { s2, d2: pairs ? d2 / pairs : NaN, delta2: pairs ? delta2 / pairs : NaN, diff: diff.map((v) => v / Math.max(1, pairs)) };
}

export function motorFlexibility(reps: readonly ConditionRep[], o: FlexibilityOptions): FlexibilityResult {
  const representation = o.representation ?? 'share';
  const rng = createRng(o.seed ?? 20261110);
  const reasons: string[] = [];
  const notes = ['exploratory:_not_a_validated_measure_of_motor_flexibility', 'describes_organisation_relative_to_the_achieved_outcome,_not_whether_the_task_was_done_well'];
  const usable = reps.map((r) => ({ r, v: toRep(r, representation) })).filter((x): x is { r: ConditionRep; v: number[] } => x.v !== null);
  if (usable.length < reps.length) notes.push(`${reps.length - usable.length}_repetitions_with_outcome_below_${FLEXIBILITY_RULE.minOutcomeDeg}°_excluded_(share_undefined)`);
  const keys = [...new Set(usable.map((x) => x.r.condition))].sort();
  const tol = o.attainTolerance ?? 0.1;
  const conditions = keys.map((k) => {
    const g = usable.filter((x) => x.r.condition === k).map((x) => x.r.outcome);
    const m = mean(g);
    const target = o.targets?.[k] ?? null;
    return { condition: k, n: g.length, outcomeMean: m, outcomeSd: g.length > 1 ? Math.sqrt(g.reduce((a, v) => a + (v - m) ** 2, 0) / (g.length - 1)) : NaN, target, attainment: target !== null && g.length ? g.filter((v) => v >= (1 - tol) * target).length / g.length : null };
  });
  const empty = (verdict: FlexibilityVerdict): FlexibilityResult => ({ verdict, reasons, representation, conditions, within: null, between: null, mfi: null, ci95: null, p: null, byChannel: [], splitHalf: null, notes });
  if (keys.length < 2) {
    reasons.push('fewer_than_two_task_conditions');
    return empty('insufficient_data');
  }
  if (conditions.some((c) => c.n < FLEXIBILITY_RULE.minPerCondition)) {
    reasons.push(`a_condition_has_fewer_than_${FLEXIBILITY_RULE.minPerCondition}_repetitions`);
    return empty('insufficient_data');
  }
  const groups = keys.map((k) => usable.filter((x) => x.r.condition === k).map((x) => x.v));
  const st = flexStats(groups);
  const s = Math.sqrt(st.s2);
  const mfi = s > 0 ? Math.sqrt(st.delta2) / s : NaN;
  // sessions in which two conditions co-occur (≥ coOccurrence repetitions of each)
  const sessions = [...new Set(usable.map((x) => x.r.sessionId))];
  const mixed = sessions.filter((sid) => keys.filter((k) => usable.filter((x) => x.r.sessionId === sid && x.r.condition === k).length >= FLEXIBILITY_RULE.coOccurrence).length >= 2);
  // bootstrap CI (resampling repetitions within condition)
  const B = o.bootstraps ?? 500;
  const boots: number[] = [];
  for (let b = 0; b < B; b++) {
    const g = groups.map((rows) => bootstrapIndices(rows.length, rng).map((i) => rows[i] as number[]));
    const t = flexStats(g);
    if (t.s2 > 0) boots.push(Math.sqrt(t.delta2) / Math.sqrt(t.s2));
  }
  const ci95: [number, number] = [quantileOf(boots, 0.025), quantileOf(boots, 0.975)];
  // channel attribution of the (uncorrected) mean-difference pattern
  const tot = st.diff.reduce((a, v) => a + v * v, 0) || 1;
  const byChannel = o.channels.map((channel, ci) => ({ channel, share: st.diff.slice(ci * GRID, (ci + 1) * GRID).reduce((a, v) => a + v * v, 0) / tot }));
  // split-half reproducibility of the difference pattern
  const half = (parity: number) => flexStats(groups.map((rows) => rows.filter((_, i) => i % 2 === parity))).diff;
  const h0 = half(0);
  const h1 = half(1);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let j = 0; j < h0.length; j++) {
    ab += (h0[j] as number) * (h1[j] as number);
    aa += (h0[j] as number) ** 2;
    bb += (h1[j] as number) ** 2;
  }
  const splitHalf = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
  const base = { reasons, representation, conditions, within: s, between: Math.sqrt(st.delta2), mfi, ci95, byChannel, splitHalf, notes };
  if (!mixed.length) {
    reasons.push('conditions_never_share_a_session:_a_difference_cannot_be_told_from_sensor_re-attachment');
    return { ...base, verdict: 'confounded_by_session', p: null };
  }
  // permutation of condition labels within sessions (only sessions with ≥ 2 conditions carry information)
  const P = o.permutations ?? 999;
  const idxBySession = new Map<string, number[]>();
  usable.forEach((x, i) => {
    const a = idxBySession.get(x.r.sessionId) ?? [];
    a.push(i);
    idxBySession.set(x.r.sessionId, a);
  });
  const labels = usable.map((x) => keys.indexOf(x.r.condition));
  let ge = 0;
  for (let q = 0; q < P; q++) {
    const perm = [...labels];
    for (const idx of idxBySession.values()) {
      const sh = shuffle(idx.map((i) => labels[i] as number), rng);
      idx.forEach((i, k) => (perm[i] = sh[k] as number));
    }
    const g = keys.map((_, k) => usable.filter((_, i) => perm[i] === k).map((x) => x.v));
    if (g.some((rows) => rows.length < 2)) continue;
    if (flexStats(g).d2 >= st.d2) ge++;
  }
  const p = (1 + ge) / (P + 1);
  if (mixed.length < sessions.length) notes.push('some_sessions_contain_one_condition_only:_they_inform_the_within-condition_variance_but_not_the_test');
  const verdict: FlexibilityVerdict = p < FLEXIBILITY_RULE.alpha && ci95[0] > 0 ? 'condition_dependent_organisation' : 'no_adaptation_detected';
  if (verdict === 'no_adaptation_detected') reasons.push(`p_${p.toFixed(3)};_not_evidence_that_the_organisation_is_the_same_(upper_bound_of_the_index_${ci95[1].toFixed(2)})`);
  return { ...base, verdict, p };
}

// ── trunk–outcome trade-off ───────────────────────────────────────────────────────────────────────────────

export interface TradeoffRep {
  outcome: number;
  /** Signed trunk excursion in the task plane, degrees (sagittal flexion: + = forward lean). */
  trunk: number;
  /** Optional cost descriptors of the repetition. */
  duration?: number;
  peakRate?: number;
  sparc?: number;
}

export interface TradeoffOptions {
  exercise: string;
  /** Standard uncertainty of ONE repetition's trunk excursion from sensor noise (measure/uncertainty.ts), when known. */
  uTrunk?: number | null;
  /** Share of angular-rate energy about the functional axis (placement.ts) — planarity of the arm movement. */
  planarity?: number | null;
  seed?: number;
  bootstraps?: number;
}

export const TRADEOFF_RULE = { minReps: 12, minTrunkSdDeg: 1, minReliability: 0.8, minPlanarity: 0.9 } as const;

export type TradeoffVerdict = 'not_feasible' | 'insufficient_data' | 'trunk_barely_varies' | 'outcome_preserved_against_trunk_variation' | 'trunk_variation_passes_into_outcome' | 'between' | 'reinforcing';

export interface TradeoffResult {
  verdict: TradeoffVerdict;
  reasons: string[];
  n: number;
  /** −slope of outcome on trunk excursion, corrected for trunk measurement noise when known. */
  passThrough: number | null;
  ci95: [number, number] | null;
  /** Reliability ratio 1 − u²/Var(trunk) used for the correction (null when the noise is unknown). */
  reliability: number | null;
  /** Mean signed trunk share of the outcome: −trunk / outcome (positive = the trunk adds to the outcome). */
  trunkShare: { mean: number; sd: number } | null;
  /** Variance of the outcome relative to what independent trunk and arm variation would give (planar model): < 1 = stabilised. */
  varianceRatio: number | null;
  /** Kendall τ between the trunk share and each cost descriptor across repetitions, Holm-adjusted p. */
  costs: { descriptor: 'duration' | 'peakRate' | 'sparc'; tau: number; p: number | null; pHolm: number | null; n: number }[];
  notes: string[];
}

/** Is the two-element analysis valid for this movement and these data? Reasons listed when not. */
export function tradeoffFeasibility(exercise: string, hasTrunk: boolean, planarity: number | null | undefined): { feasible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (exercise !== 'shoulder_flexion') reasons.push('validated_for_sagittal-plane_arm_raising_only_(shoulder_flexion)');
  if (!hasTrunk) reasons.push('needs_the_trunk_sensor');
  if (planarity !== null && planarity !== undefined && planarity < TRADEOFF_RULE.minPlanarity) reasons.push(`arm_movement_is_not_about_one_axis_(planarity_${planarity.toFixed(2)}):_the_planar_model_does_not_hold`);
  return { feasible: reasons.length === 0, reasons };
}

function olsSlope(x: readonly number[], y: readonly number[]): { b: number; se: number; n: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += ((x[i] as number) - mx) ** 2;
    sxy += ((x[i] as number) - mx) * ((y[i] as number) - my);
  }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += ((y[i] as number) - my - b * ((x[i] as number) - mx)) ** 2;
  return { b, se: Math.sqrt(rss / (n - 2) / sxx), n };
}

export function trunkOutcomeTradeoff(reps: readonly TradeoffRep[], o: TradeoffOptions): TradeoffResult {
  const notes = ['exploratory', 'a_relationship_across_repetitions,_not_a_judgement:_trunk_contribution_is_not_labelled_helpful_or_harmful'];
  const reasons: string[] = [];
  const use = reps.filter((r) => Number.isFinite(r.outcome) && Number.isFinite(r.trunk));
  const n = use.length;
  const empty = (verdict: TradeoffVerdict): TradeoffResult => ({ verdict, reasons, n, passThrough: null, ci95: null, reliability: null, trunkShare: null, varianceRatio: null, costs: [], notes });
  const feas = tradeoffFeasibility(o.exercise, true, o.planarity);
  if (!feas.feasible) {
    reasons.push(...feas.reasons);
    return empty('not_feasible');
  }
  if (n < TRADEOFF_RULE.minReps) {
    reasons.push(`only_${n}_repetitions_(minimum_${TRADEOFF_RULE.minReps})`);
    return empty('insufficient_data');
  }
  const p = use.map((r) => r.trunk);
  const out = use.map((r) => r.outcome);
  const mp = mean(p);
  const vp = p.reduce((a, v) => a + (v - mp) ** 2, 0) / (n - 1);
  const shares = use.filter((r) => Math.abs(r.outcome) >= FLEXIBILITY_RULE.minOutcomeDeg).map((r) => -r.trunk / r.outcome);
  const ms = mean(shares);
  const trunkShare = shares.length > 1 ? { mean: ms, sd: Math.sqrt(shares.reduce((a, v) => a + (v - ms) ** 2, 0) / (shares.length - 1)) } : null;
  if (!(Math.sqrt(vp) >= TRADEOFF_RULE.minTrunkSdDeg)) {
    reasons.push(`trunk_excursion_SD_${Math.sqrt(vp).toFixed(2)}°_below_${TRADEOFF_RULE.minTrunkSdDeg}°:_there_is_no_trunk_variation_to_relate_the_outcome_to`);
    return { ...empty('trunk_barely_varies'), trunkShare };
  }
  let reliability: number | null = null;
  if (o.uTrunk !== null && o.uTrunk !== undefined) {
    reliability = 1 - o.uTrunk ** 2 / vp;
    if (reliability < TRADEOFF_RULE.minReliability) {
      reasons.push(`trunk_variation_is_mostly_measurement_noise_(reliability_${reliability.toFixed(2)})`);
      return { ...empty('trunk_barely_varies'), reliability, trunkShare };
    }
  } else notes.push('trunk_measurement_noise_unknown:_slope_not_corrected_for_attenuation');
  const fit = olsSlope(p, out);
  if (!fit) return empty('insufficient_data');
  const lam = reliability ?? 1;
  const passThrough = -fit.b / lam;
  // bootstrap CI (pairs), same correction
  const rng = createRng(o.seed ?? 20261110);
  const bs: number[] = [];
  for (let b = 0; b < (o.bootstraps ?? 1000); b++) {
    const idx = bootstrapIndices(n, rng);
    const f = olsSlope(idx.map((i) => p[i] as number), idx.map((i) => out[i] as number));
    if (f) bs.push(-f.b / lam);
  }
  const ci95: [number, number] = bs.length >= 100 ? [quantileOf(bs, 0.025), quantileOf(bs, 0.975)] : [passThrough - tQuantile(0.975, n - 2) * (fit.se / lam), passThrough + tQuantile(0.975, n - 2) * (fit.se / lam)];
  // planar model: arm relative to trunk r = outcome + trunk; independent r and trunk ⇒ Var(outcome) = Var(r) + Var(trunk)
  const r = use.map((x) => x.outcome + x.trunk);
  const mr = mean(r);
  const vr = r.reduce((a, v) => a + (v - mr) ** 2, 0) / (n - 1);
  const mo = mean(out);
  const vo = out.reduce((a, v) => a + (v - mo) ** 2, 0) / (n - 1);
  const noise = o.uTrunk ? 2 * o.uTrunk ** 2 : 0;
  const varianceRatio = vr + vp - noise > 0 ? vo / (vr + vp - noise) : null;
  // costs against the trunk share
  const raw: TradeoffResult['costs'] = [];
  for (const d of ['duration', 'peakRate', 'sparc'] as const) {
    const pairs = use.filter((x) => Math.abs(x.outcome) >= FLEXIBILITY_RULE.minOutcomeDeg && typeof x[d] === 'number' && Number.isFinite(x[d] as number));
    if (pairs.length < 8) continue;
    const k = kendallTau(pairs.map((x) => -x.trunk / x.outcome), pairs.map((x) => x[d] as number));
    raw.push({ descriptor: d, tau: k.tau, p: k.p, pHolm: null, n: pairs.length });
  }
  const order = raw.filter((c) => c.p !== null).sort((a, b) => (a.p as number) - (b.p as number));
  let run = 0;
  order.forEach((c, i) => {
    run = Math.max(run, Math.min(1, (order.length - i) * (c.p as number)));
    c.pHolm = run;
  });
  let verdict: TradeoffVerdict;
  if (ci95[1] < 0.5 && ci95[0] <= 0.25) verdict = 'outcome_preserved_against_trunk_variation';
  else if (ci95[0] > 1) verdict = 'reinforcing';
  else if (ci95[0] > 0.5) verdict = 'trunk_variation_passes_into_outcome';
  else verdict = 'between';
  if (verdict === 'between') reasons.push(`pass-through_interval_[${ci95[0].toFixed(2)},_${ci95[1].toFixed(2)}]_does_not_separate_"absorbed"_from_"passed_on"`);
  return { verdict, reasons, n, passThrough, ci95, reliability, trunkShare, varianceRatio, costs: raw, notes };
}
