// Motor Strategy Profile — an inspectable, structured description of HOW one person organised one task in one
// recording. Not a score: every component is a named quantity with its unit, its uncertainty, the registry entry
// that defines it, and the quality and placement conditions it was measured under.
//
// Also here: the partition of a feature's variation into its different KINDS (repetition-to-repetition, a trend
// within the session, between sessions — against what sensor error and re-attachment could produce), because
// "the movement varied" is not one finding: within-person variability, sensor placement, task conditions, fatigue
// or practice within a session, and a change of coordination are different explanations and are kept apart.

import type { RawFrame } from '../../devices/types';
import { tCdf, tQuantile } from '../../research/stats';
import { hashOf } from '../hash';
import { comparePlacement, mountDiagnostics, type MountDiagnostics, type PlacementConfidence } from '../measure/placement';
import { provenanceOf, registryEntry, type MeasurementStatus, type ProvenanceLabel } from '../measure/registry';
import { REP_FEATURE_IDS, REP_FEATURE_REGISTRY, REP_FEATURE_UNITS, featuresOfChannels, type RecordingFeatures, type RepFeatureId } from '../measure/repFeatures';
import { chi2Cdf } from '../measure/stats';
import { propagateUncertainty, type FeatureUncertainty, type PropagateOptions, type UncertaintyBudget } from '../measure/uncertainty';
import type { TaskContext } from '../tasks/library';
import { COORD_VERSION, FRONTIER_VERSIONS } from '../version';
import { buildChannels, type RecordingMeta } from './channels';
import type { McseResult } from './engine';
import { verifyManifest, type ManifestCheck, type RawManifest } from './provenance';
import type { StrategyVerdict } from './strategy';

export interface ProfileFeature {
  id: RepFeatureId;
  unit: string;
  /** Registry entry that defines the quantity (measure/registry.ts). */
  registry: string;
  status: MeasurementStatus;
  n: number;
  mean: number;
  /** Repetition-to-repetition SD in this recording. */
  sd: number | null;
  /** 95 % CI of the recording mean from the repetitions (Student-t) — sampling of repetitions only. */
  ci95: [number, number] | null;
  /** Measurement uncertainty of the mean (sensor noise + offsets), when propagated. */
  uMeasurement: number | null;
  /** Share of the repetition variance that sensor noise can account for, when propagated. */
  measurementShare: number | null;
  /** Change per repetition across the recording (OLS on repetition order) with a two-sided p-value. */
  trend: { slope: number; p: number } | null;
}

export interface MotorStrategyProfile {
  participantId: string;
  recordingId: string;
  startedAt: string;
  task: TaskContext;
  repetitions: number;
  excludedRepetitions: { index: number; reason: string }[];
  /** The strategy feature vector, with within-recording variability and uncertainty per component. */
  features: ProfileFeature[];
  /** Intersegment coordination descriptors (subset of `features`, named for reading). */
  coordination: { trunkContribution: ProfileFeature | null; onsetLagTrunkMs: ProfileFeature | null; onsetLagForeMs: ProfileFeature | null; timeToPeakFraction: ProfileFeature | null };
  /** Trunk-related descriptors. An OBSERVED contribution: whether it helps or limits is a contextual judgement. */
  trunk: { pitchExcursion: ProfileFeature | null; rollExcursion: ProfileFeature | null; contribution: ProfileFeature | null };
  quality: {
    signal: string;
    calibration: string;
    manifest: ManifestCheck;
    relativeHeadingDriftDps: number | null;
    filterRestarts: number;
    elbowUnobservableShare: number;
    unavailableChannels: string[];
    flags: string[];
  };
  mount: MountDiagnostics;
  /** Placement relative to a reference recording of the same participant; null when none was given. */
  placement: PlacementConfidence | null;
  uncertainty: UncertaintyBudget | null;
  /** Strategy assignment summary from an MCSE analysis that included this recording, when available. */
  strategy: { verdict: StrategyVerdict; labels: Record<string, number>; uncertain: number } | null;
  provenance: { label: ProvenanceLabel; source: RecordingMeta['source']; simulated: boolean; versions: { coord: string; strategy: string; measure: string }; featureHash: string };
}

export interface ProfileInput {
  frames: readonly RawFrame[];
  meta: RecordingMeta;
  manifest?: RawManifest | null;
}

export interface ProfileOptions {
  task: TaskContext;
  /** Mount diagnostics of the reference (baseline) recording, for placement confidence. */
  reference?: MountDiagnostics | null;
  /** Propagate sensor uncertainty (≈ 60 pipeline runs); omit for a fast profile. */
  uncertainty?: PropagateOptions | false;
  mcse?: McseResult | null;
}

const meanOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function trendOf(y: readonly number[]): { slope: number; p: number } | null {
  const n = y.length;
  if (n < 4) return null;
  const mx = (n - 1) / 2;
  const my = meanOf(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * ((y[i] as number) - my);
  }
  const b = sxy / sxx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += ((y[i] as number) - my - b * (i - mx)) ** 2;
  const se = Math.sqrt(rss / (n - 2) / sxx);
  return { slope: b, p: se > 0 ? 2 * (1 - tCdf(Math.abs(b / se), n - 2)) : b === 0 ? 1 : 0 };
}

function featureOf(id: RepFeatureId, values: readonly number[], u: FeatureUncertainty | undefined): ProfileFeature {
  const n = values.length;
  const m = meanOf(values);
  const sd = n >= 2 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : null;
  const half = sd !== null ? (tQuantile(0.975, n - 1) * sd) / Math.sqrt(n) : null;
  const reg = REP_FEATURE_REGISTRY[id];
  return {
    id,
    unit: REP_FEATURE_UNITS[id],
    registry: reg,
    status: registryEntry(reg)?.status ?? 'derived',
    n,
    mean: m,
    sd,
    ci95: half !== null ? [m - half, m + half] : null,
    uMeasurement: u ? u.uSessionMean : null,
    measurementShare: u ? u.measurementShare : null,
    trend: trendOf(values),
  };
}

/** Profile of one recording from its features (use buildStrategyProfile unless the features are already computed). */
export function profileFromFeatures(input: ProfileInput, rf: RecordingFeatures, o: ProfileOptions): MotorStrategyProfile {
  const { meta, frames } = input;
  const exercise = o.task.exercise;
  const budget = o.uncertainty === false || o.uncertainty === undefined ? null : propagateUncertainty(frames, meta, exercise, o.uncertainty);
  const features: ProfileFeature[] = [];
  for (const id of REP_FEATURE_IDS) {
    const v = rf.reps.map((r) => r.values[id]).filter((x): x is number => x !== undefined);
    if (v.length) features.push(featureOf(id, v, budget?.features.find((f) => f.feature === id)));
  }
  const get = (id: RepFeatureId) => features.find((f) => f.id === id) ?? null;
  const cs = rf.cs;
  const mount = mountDiagnostics(frames, cs, rf.reps, exercise);
  const manifest = input.manifest === undefined && meta.source === 'synthetic' ? 'no_manifest' : verifyManifest(frames, input.manifest ?? null);
  const flags: string[] = [];
  if (cs.qc.confidence !== 'high') flags.push(`signal_quality_${cs.qc.confidence}`);
  if (cs.calibration.source !== 'session_calibration') flags.push(`calibration_${cs.calibration.source}`);
  if (manifest !== 'verified') flags.push(`raw_stream_${manifest}`);
  if (rf.reps.length < 3) flags.push('fewer_than_3_repetitions');
  if (cs.drift.restarts > 0) flags.push('orientation_filter_restarted');
  let strategy: MotorStrategyProfile['strategy'] = null;
  if (o.mcse?.strategies) {
    const mine = o.mcse.reps.filter((r) => r.recordingId === meta.id);
    const labels: Record<string, number> = {};
    for (const r of mine) if (r.strategy.label) labels[r.strategy.label] = (labels[r.strategy.label] ?? 0) + 1;
    strategy = { verdict: o.mcse.strategies.verdict, labels, uncertain: mine.filter((r) => !r.strategy.label).length };
  }
  const total = cs.t.length || 1;
  return {
    participantId: meta.participantId,
    recordingId: meta.id,
    startedAt: meta.startedAt,
    task: o.task,
    repetitions: rf.reps.length,
    excludedRepetitions: rf.excluded,
    features,
    coordination: { trunkContribution: get('trunk_contribution'), onsetLagTrunkMs: get('onset_lag_trunk_ms'), onsetLagForeMs: get('onset_lag_fore_ms'), timeToPeakFraction: get('time_to_peak_fraction') },
    trunk: { pitchExcursion: get('exc_trunk_pitch'), rollExcursion: get('exc_trunk_roll'), contribution: get('trunk_contribution') },
    quality: {
      signal: cs.qc.confidence,
      calibration: cs.calibration.source,
      manifest,
      relativeHeadingDriftDps: cs.drift.relativeHeadingDriftDps,
      filterRestarts: cs.drift.restarts,
      elbowUnobservableShare: cs.elbowUnobservableSamples / total,
      unavailableChannels: Object.keys(cs.unavailable),
      flags,
    },
    mount,
    placement: o.reference === undefined ? null : comparePlacement(o.reference, mount),
    uncertainty: budget,
    strategy,
    provenance: {
      label: provenanceOf('derived', { simulated: meta.simulated }),
      source: meta.source,
      simulated: meta.simulated,
      versions: { coord: COORD_VERSION, strategy: FRONTIER_VERSIONS.strategy, measure: FRONTIER_VERSIONS.measure },
      featureHash: hashOf(rf.reps.map((r) => r.values)),
    },
  };
}

export function buildStrategyProfile(input: ProfileInput, o: ProfileOptions): MotorStrategyProfile {
  return profileFromFeatures(input, featuresOfChannels(buildChannels(input.frames, input.meta), o.task.exercise), o);
}

// ── comparing two profiles ────────────────────────────────────────────────────────────────────────────────

export interface ProfileDifference {
  id: RepFeatureId;
  unit: string;
  delta: number;
  /** SE of the difference from repetition variability (Welch). */
  se: number | null;
  /** 90 % CI of the difference (repetition variability and, when propagated, sensor uncertainty): for equivalence tests. */
  ci90: [number, number] | null;
  /** Measurement uncertainty of the difference (both recordings' sensor budgets), when propagated. */
  uMeasurement: number | null;
  /** Worst-case placement bias for this quantity from the placement comparison, when it applies. */
  placementBound: number | null;
  /**
   * beyond_noise       |Δ| exceeds 1.96 × √(SE² + u²) AND the placement bound
   * within_placement   exceeds repetition and sensor noise, but a placement/posture difference could produce it
   * within_noise       not distinguishable from repetition variability and sensor error
   * not_assessable     fewer than 2 repetitions on a side
   */
  verdict: 'beyond_noise' | 'within_placement' | 'within_noise' | 'not_assessable';
}

/**
 * Assumed largest rotation of the trunk sensor about the vertical (it cannot be observed): a strap placed by eye on
 * the sternum. An ASSUMPTION, used only to refuse to interpret small trunk roll/pitch differences.
 */
export const TRUNK_HEADING_TOLERANCE_DEG = 20;

/** Which placement bound applies to which feature (angles of the arm sensors; elbow has its own). */
function placementBoundFor(id: RepFeatureId, pc: PlacementConfidence | null): number | null {
  if (!pc || pc.level === 'unknown') return null;
  const find = (q: string) => pc.expectedBias.filter((b) => b.quantity.startsWith(q)).reduce((a, b) => Math.max(a, b.attributionBound), 0);
  if (id === 'outcome' || id === 'exc_upper_elev' || id === 'exc_humerothoracic') return find('upper-arm');
  if (id === 'exc_fore_elev') return find('forearm');
  if (id === 'exc_trunk_pitch' || id === 'exc_trunk_roll') return find('trunk');
  if (id === 'exc_elbow_flex') return Math.max(find('elbow'), find('upper-arm'), find('forearm'));
  return null;
}

/**
 * Feature-by-feature difference b − a of two profiles of the same task. `placement` should be the placement
 * comparison of b against a (b.placement when a was its reference); without it, cross-recording differences in
 * angles are reported as 'within_placement' at best, because placement cannot be excluded. With it, an angle
 * difference must exceed the ATTRIBUTION bound (observed tilt difference + strap allowance, placement.ts) — two
 * recordings made without re-attaching the sensors (same recording id) have no such bound.
 */
export function compareProfiles(a: MotorStrategyProfile, b: MotorStrategyProfile, placement: PlacementConfidence | null = b.placement): ProfileDifference[] {
  const out: ProfileDifference[] = [];
  const sameRecording = a.recordingId === b.recordingId;
  for (const fb of b.features) {
    const fa = a.features.find((f) => f.id === fb.id);
    if (!fa) continue;
    const delta = fb.mean - fa.mean;
    const se = fa.sd !== null && fb.sd !== null ? Math.sqrt(fa.sd ** 2 / fa.n + fb.sd ** 2 / fb.n) : null;
    const u = fa.uMeasurement !== null && fb.uMeasurement !== null ? Math.sqrt(fa.uMeasurement ** 2 + fb.uMeasurement ** 2) : null;
    const bound = sameRecording ? 0 : placementBoundFor(fb.id, placement);
    let verdict: ProfileDifference['verdict'];
    if (se === null) verdict = 'not_assessable';
    else {
      const noise = 1.959963984540054 * Math.sqrt(se ** 2 + (u ?? 0) ** 2);
      const isAngle = fb.unit === '°';
      if (Math.abs(delta) <= noise) verdict = 'within_noise';
      // an angle compared across recordings without a placement comparison cannot be cleared of placement
      else if (isAngle && !sameRecording && (bound === null || Math.abs(delta) <= bound)) verdict = 'within_placement';
      else verdict = 'beyond_noise';
    }
    let ci90: [number, number] | null = null;
    if (se !== null && fa.sd !== null && fb.sd !== null) {
      // Welch–Satterthwaite degrees of freedom of the repetition part; sensor uncertainty added in quadrature
      const va = fa.sd ** 2 / fa.n;
      const vb = fb.sd ** 2 / fb.n;
      const df = va + vb > 0 ? (va + vb) ** 2 / (va ** 2 / Math.max(1, fa.n - 1) + vb ** 2 / Math.max(1, fb.n - 1)) : fa.n + fb.n - 2;
      const half = tQuantile(0.95, Math.max(1, df)) * Math.sqrt(se ** 2 + (u ?? 0) ** 2);
      ci90 = [delta - half, delta + half];
    }
    out.push({ id: fb.id, unit: fb.unit, delta, se, ci90, uMeasurement: u, placementBound: bound, verdict });
  }
  // Trunk pitch/roll cross-talk: a rotation ψ of the trunk sensor about the vertical leaks sin ψ of one into the
  // other and is NOT observable from a recording (measure/placement.ts, benchmark M2c). A difference in one that is
  // no larger than sin(tolerance) × the other's excursion is therefore not cleared of placement — even within one
  // recording.
  const leak = Math.sin((TRUNK_HEADING_TOLERANCE_DEG * Math.PI) / 180);
  for (const [self, other] of [['exc_trunk_roll', 'exc_trunk_pitch'], ['exc_trunk_pitch', 'exc_trunk_roll']] as const) {
    const d = out.find((x) => x.id === self);
    const fa = a.features.find((f) => f.id === other);
    const fb = b.features.find((f) => f.id === other);
    if (!d || d.verdict !== 'beyond_noise' || !fa || !fb) continue;
    const bound = leak * Math.max(Math.abs(fa.mean), Math.abs(fb.mean));
    if (Math.abs(d.delta) <= bound) {
      d.verdict = 'within_placement';
      d.placementBound = Math.max(d.placementBound ?? 0, bound);
    }
  }
  return out;
}

/**
 * Equivalence of one feature between two profiles by two one-sided tests (Schuirmann 1987; Lakens 2017): equivalent
 * only if the whole 90 % CI of the difference lies within ±margin. "Not significantly different" is NOT equivalence;
 * null = the interval could not be computed.
 */
export function equivalent(d: ProfileDifference, margin: number): boolean | null {
  return d.ci90 ? d.ci90[0] >= -margin && d.ci90[1] <= margin : null;
}

// ── kinds of variation of one feature across recordings ───────────────────────────────────────────────────

export interface VariationSession {
  recordingId: string;
  /** Repetition values in recording order. */
  values: number[];
  /** Systematic measurement uncertainty of the recording mean (sensor offsets), when known. */
  uSystematic?: number | null;
  /** Random measurement uncertainty of one repetition, when known. */
  uRandom?: number | null;
  /** Worst-case placement bias of this recording against the reference, when known. */
  placementBound?: number | null;
  /** Task-condition key (tasks/library.ts conditionKey); sessions with different keys are different conditions. */
  condition?: string;
}

export interface VariationPartition {
  sessions: number;
  repetitions: number;
  /** SDs, in the feature's units. */
  withinResidual: number | null;
  /** SD attributable to a linear trend across the repetitions of a session (practice- or fatigue-like), pooled. */
  withinTrend: number | null;
  /** Pooled within-session slope per repetition and the p-value of "no trend" (one-sample t on session slopes). */
  trend: { slope: number; p: number | null; sessions: number } | null;
  /** Share of the residual repetition variance sensor noise can account for. */
  measurementShareWithin: number | null;
  /** Between-session SD component: √max(0, var(session means) − within/n). */
  betweenSession: number | null;
  /** SD of session means expected from repetition noise and sensor systematic error ALONE. */
  betweenExpected: number | null;
  /** χ² test of "session means differ no more than repetition noise + sensor error predict" (null below 3 sessions). */
  betweenExcess: { chi2: number; df: number; p: number } | null;
  /** Largest |session mean − overall mean| and the largest placement bound among the sessions. */
  largestDeviation: number | null;
  placementBound: number | null;
  conditions: number;
  /**
   * What the between-session variation can and cannot be attributed to. More than one can hold.
   *   insufficient_sessions               fewer than 3 recordings
   *   within_repetition_and_sensor_error  session differences are no larger than repetition noise + sensor error
   *   placement_not_excluded              they are larger, but within what re-attachment / calibration posture could do
   *                                       (or placement is unknown)
   *   task_conditions_differ              the recordings were made under different task conditions
   *   exceeds_measurement_explanations    larger than repetition noise, sensor error and the placement bound, same
   *                                       condition — a candidate change of the movement itself (cause not identified)
   */
  verdicts: ('insufficient_sessions' | 'within_repetition_and_sensor_error' | 'placement_not_excluded' | 'task_conditions_differ' | 'exceeds_measurement_explanations')[];
}

export function partitionVariation(sessions: readonly VariationSession[]): VariationPartition {
  const use = sessions.filter((s) => s.values.length > 0);
  const K = use.length;
  const N = use.reduce((a, s) => a + s.values.length, 0);
  const conditions = new Set(use.map((s) => s.condition ?? '')).size;
  let ssRes = 0;
  let dfRes = 0;
  let ssTrend = 0;
  let nTrend = 0;
  const slopes: number[] = [];
  for (const s of use) {
    const n = s.values.length;
    const m = meanOf(s.values);
    const tr = n >= 4 ? trendOf(s.values) : null;
    const mx = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const fit = m + (tr ? tr.slope * (i - mx) : 0);
      ssRes += ((s.values[i] as number) - fit) ** 2;
      if (tr) ssTrend += (tr.slope * (i - mx)) ** 2;
    }
    dfRes += Math.max(0, n - (tr ? 2 : 1));
    if (tr) {
      slopes.push(tr.slope);
      nTrend += n;
    }
  }
  const vRes = dfRes > 0 ? ssRes / dfRes : NaN;
  let trend: VariationPartition['trend'] = null;
  if (slopes.length) {
    const ms = meanOf(slopes);
    let p: number | null = null;
    if (slopes.length >= 3) {
      const sd = Math.sqrt(slopes.reduce((a, v) => a + (v - ms) ** 2, 0) / (slopes.length - 1));
      p = sd > 0 ? 2 * (1 - tCdf(Math.abs(ms / (sd / Math.sqrt(slopes.length))), slopes.length - 1)) : null;
    } else if (slopes.length === 1) {
      const only = use.find((s) => s.values.length >= 4);
      p = only ? (trendOf(only.values)?.p ?? null) : null;
    }
    trend = { slope: ms, p, sessions: slopes.length };
  }
  const uR = use.map((s) => s.uRandom).filter((x): x is number => typeof x === 'number');
  const uS = use.map((s) => s.uSystematic).filter((x): x is number => typeof x === 'number');
  const means = use.map((s) => meanOf(s.values));
  const grand = K ? meanOf(means) : NaN;
  const S2 = K >= 2 ? means.reduce((a, m) => a + (m - grand) ** 2, 0) / (K - 1) : NaN;
  const h = K ? use.reduce((a, s) => a + 1 / s.values.length, 0) / K : NaN;
  // total within-session variance per repetition (residual + trend) is what averages into a session mean
  const vWithin = Number.isFinite(vRes) ? vRes + (nTrend ? ssTrend / nTrend : 0) : NaN;
  const uSys2 = uS.length ? meanOf(uS.map((x) => x * x)) : 0;
  const expected2 = Number.isFinite(vWithin) ? vWithin * h + uSys2 : NaN;
  let excess: VariationPartition['betweenExcess'] = null;
  if (K >= 3 && expected2 > 0) {
    const chi2 = ((K - 1) * S2) / expected2;
    excess = { chi2, df: K - 1, p: 1 - chi2Cdf(chi2, K - 1) };
  }
  const bounds = use.map((s) => s.placementBound).filter((x): x is number => typeof x === 'number');
  const placementBound = bounds.length === K && K > 0 ? Math.max(...bounds) : null;
  const largest = K ? Math.max(...means.map((m) => Math.abs(m - grand))) : null;
  const verdicts: VariationPartition['verdicts'] = [];
  if (K < 3) verdicts.push('insufficient_sessions');
  else if (!excess || excess.p >= 0.05) verdicts.push('within_repetition_and_sensor_error');
  else {
    if (conditions > 1) verdicts.push('task_conditions_differ');
    if (placementBound === null || (largest !== null && largest <= placementBound)) verdicts.push('placement_not_excluded');
    if (conditions === 1 && placementBound !== null && largest !== null && largest > placementBound) verdicts.push('exceeds_measurement_explanations');
  }
  return {
    sessions: K,
    repetitions: N,
    withinResidual: Number.isFinite(vRes) ? Math.sqrt(vRes) : null,
    withinTrend: nTrend ? Math.sqrt(ssTrend / nTrend) : null,
    trend,
    measurementShareWithin: uR.length && vRes > 0 ? Math.min(1, meanOf(uR.map((x) => x * x)) / vRes) : null,
    betweenSession: Number.isFinite(S2) && Number.isFinite(vWithin) ? Math.sqrt(Math.max(0, S2 - vWithin * h)) : null,
    betweenExpected: Number.isFinite(expected2) ? Math.sqrt(expected2) : null,
    betweenExcess: excess,
    largestDeviation: largest,
    placementBound,
    conditions,
    verdicts,
  };
}

/** The variation partition of one feature across a participant's profiles of the same movement. */
export function partitionProfiles(profiles: readonly MotorStrategyProfile[], perRecording: ReadonlyMap<string, RecordingFeatures>, feature: RepFeatureId, conditionOf: (p: MotorStrategyProfile) => string): VariationPartition {
  return partitionVariation(
    profiles.map((p) => {
      const rf = perRecording.get(p.recordingId);
      const u = p.uncertainty?.features.find((f) => f.feature === feature);
      const bound = p.placement ? placementBoundFor(feature, p.placement) : null;
      return {
        recordingId: p.recordingId,
        values: rf ? rf.reps.map((r) => r.values[feature]).filter((v): v is number => v !== undefined) : [],
        uSystematic: u ? u.uSystematic : null,
        uRandom: u ? u.uRandom : null,
        // the reference recording itself has no placement difference
        placementBound: p.placement && p.placement.reference === null ? null : bound,
        condition: conditionOf(p),
      };
    }),
  );
}
