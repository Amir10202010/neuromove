// Jobs of the research-frontier workspaces that take seconds: twin layers, the strategy atlas of a participant's
// raw recordings, ground-truth scenarios. Pure functions (unit-tested in node); frontier.worker.ts runs them off the
// main thread. Every result is plain JSON, so it crosses the worker boundary and can be sealed as an evidence record.

import type { McseRecordingInput } from './coord/engine';
import { trunkOutcomeTradeoff, type TradeoffRep, type TradeoffResult } from './coord/flexibility';
import { compareProfiles, equivalent, partitionProfiles, profileFromFeatures, type MotorStrategyProfile, type ProfileDifference, type VariationPartition } from './coord/profile';
import { synthSession } from './coord/strategyValidation';
import { STRATEGIES, type StrategySpec } from './coord/synthetic';
import { recordingFeatures, REP_FEATURE_UNITS, type RecordingFeatures, type RepFeatureId } from './measure/repFeatures';
import { monteCarlo, scenario, type MonteCarloResult, type ScenarioRun } from './scenario/engine';
import { conditionKey, UNRECORDED, type TaskContext } from './tasks/library';
import { buildLayers, type LayersInput, type TwinLayers } from './twin/layers';

/** Outcome difference below which two recordings count as "the same result" (TOST margin; MCSE uses the same ±5°). */
export const ATLAS_EQUIVALENCE_MARGIN_DEG = 5;
/** Features whose variation is partitioned in the atlas. */
export const ATLAS_PARTITION_FEATURES: readonly RepFeatureId[] = ['outcome', 'exc_trunk_pitch', 'trunk_contribution', 'onset_lag_trunk_ms'];

export interface AtlasComparison {
  /** Reference recording (the participant's first) and the compared one. */
  a: string;
  b: string;
  differences: ProfileDifference[];
  /** Two one-sided tests on the outcome within ±ATLAS_EQUIVALENCE_MARGIN_DEG; null = not computable. */
  outcomeEquivalent: boolean | null;
}

export interface AtlasResult {
  exercise: string;
  synthetic: boolean;
  /** What was generated, when synthetic — the hidden truth the page shows beside the engine's answer. */
  truth: string | null;
  profiles: MotorStrategyProfile[];
  comparisons: AtlasComparison[];
  partitions: { feature: RepFeatureId; unit: string; partition: VariationPartition }[];
  tradeoffs: { recordingId: string; result: TradeoffResult }[];
}

export interface AtlasOptions {
  exercise: string;
  /** Task context of each input, same order as `inputs`. */
  tasks: readonly TaskContext[];
  /** Monte Carlo draws of the sensor-uncertainty budget per recording; 0 = not propagated. */
  uncertaintyDraws: number;
  synthetic?: boolean;
  truth?: string | null;
}

/**
 * Strategy profiles of one participant's recordings of one movement, in time order. The first recording is the
 * placement reference of the others; each later recording is compared with it feature by feature.
 */
export function buildAtlas(inputs: readonly McseRecordingInput[], o: AtlasOptions): AtlasResult {
  const order = inputs.map((inp, i) => ({ inp, task: o.tasks[i] as TaskContext })).sort((x, y) => x.inp.meta.startedAt.localeCompare(y.inp.meta.startedAt));
  const perRecording = new Map<string, RecordingFeatures>();
  const profiles: MotorStrategyProfile[] = [];
  for (const { inp, task } of order) {
    const rf = recordingFeatures(inp.frames, inp.meta, o.exercise);
    perRecording.set(inp.meta.id, rf);
    const first = profiles[0];
    profiles.push(profileFromFeatures(inp, rf, { task, ...(first ? { reference: first.mount } : {}), uncertainty: o.uncertaintyDraws > 0 ? { draws: o.uncertaintyDraws } : false }));
  }
  const first = profiles[0];
  const comparisons: AtlasComparison[] = first
    ? profiles.slice(1).map((p) => {
        const differences = compareProfiles(first, p);
        const out = differences.find((d) => d.id === 'outcome');
        return { a: first.recordingId, b: p.recordingId, differences, outcomeEquivalent: out ? equivalent(out, ATLAS_EQUIVALENCE_MARGIN_DEG) : null };
      })
    : [];
  const partitions = ATLAS_PARTITION_FEATURES.map((feature) => ({ feature, unit: REP_FEATURE_UNITS[feature], partition: partitionProfiles(profiles, perRecording, feature, (p) => conditionKey(p.task)) }));
  const tradeoffs = profiles.map((p) => {
    const rf = perRecording.get(p.recordingId) as RecordingFeatures;
    const reps: TradeoffRep[] = rf.reps
      .filter((x) => x.values.outcome !== undefined && x.values.exc_trunk_pitch !== undefined)
      .map((x) => ({
        outcome: x.values.outcome as number,
        trunk: x.values.exc_trunk_pitch as number,
        ...(x.values.dur_outbound !== undefined ? { duration: x.values.dur_outbound } : {}),
        ...(x.values.peak_rate !== undefined ? { peakRate: x.values.peak_rate } : {}),
        ...(x.values.sparc_outbound !== undefined ? { sparc: x.values.sparc_outbound } : {}),
      }));
    const uTrunk = p.uncertainty?.features.find((f) => f.feature === 'exc_trunk_pitch')?.uRandom ?? null;
    const planarity = p.mount.sensors.find((s) => s.role === 'upper')?.functionalAxis?.planarity ?? null;
    return { recordingId: p.recordingId, result: trunkOutcomeTradeoff(reps, { exercise: o.exercise, uTrunk, planarity, seed: 20261110, bootstraps: 300 }) };
  });
  return { exercise: o.exercise, synthetic: o.synthetic ?? inputs.every((i) => i.meta.simulated), truth: o.truth ?? null, profiles, comparisons, partitions, tradeoffs };
}

export const SYNTHETIC_ATLAS_TRUTH =
  'Synthetic participant SYN-ATLAS, three recordings of 12 shoulder-flexion repetitions to the same planned arm inclination (120°). ' +
  'Recording 1: arm-dominant. Recording 2: the SAME movement plan after the sensors were taken off and put on again (new strap angles and offsets; the arm held 6° forward during calibration). ' +
  'Recording 3: sensors re-attached again and a DIFFERENT organisation — 18° of trunk extension replaces 18° of shoulder elevation. ' +
  'A correct analysis does not call recording 2 a change of the movement, and in recording 3 finds a change of trunk involvement but not of the outcome.';

/** Three synthetic recordings with a known answer (see SYNTHETIC_ATLAS_TRUTH). */
export function syntheticAtlas(seed: number, uncertaintyDraws = 0): AtlasResult {
  const arm = Array(12).fill(STRATEGIES.armDominant) as StrategySpec[];
  const trunk = Array(12).fill(STRATEGIES.trunkAssisted) as StrategySpec[];
  const recs = [
    synthSession('SYN-ATLAS', 0, arm, seed, { mountSeed: seed + 11, noiseSeed: seed + 12 }),
    synthSession('SYN-ATLAS', 1, arm, seed + 1, { mountSeed: seed + 21, noiseSeed: seed + 22, calibrationPosture: { flexion: 6 } }),
    synthSession('SYN-ATLAS', 2, trunk, seed + 2, { mountSeed: seed + 31, noiseSeed: seed + 32 }),
  ];
  const task: TaskContext = { exercise: 'shoulder_flexion', side: 'right', setting: 'synthetic', protocolId: null, constraints: { ...UNRECORDED, targetDeg: 'none', speed: 'self_paced' } };
  return buildAtlas(
    recs.map((r) => ({ frames: r.frames, meta: r.meta })),
    { exercise: 'shoulder_flexion', tasks: recs.map(() => task), uncertaintyDraws, synthetic: true, truth: SYNTHETIC_ATLAS_TRUTH },
  );
}

export type FrontierRequest =
  | { kind: 'layers'; input: LayersInput }
  | { kind: 'atlas'; inputs: McseRecordingInput[]; options: AtlasOptions }
  | { kind: 'atlas_synthetic'; seed: number; uncertaintyDraws: number }
  | { kind: 'scenario'; id: string; seed: number }
  | { kind: 'montecarlo'; id: string; runs: number; seed: number };

export type FrontierResult =
  | { kind: 'layers'; layers: TwinLayers }
  | { kind: 'atlas'; atlas: AtlasResult }
  | { kind: 'scenario'; run: ScenarioRun | null }
  | { kind: 'montecarlo'; result: MonteCarloResult | null };

/** Largest Monte Carlo a workspace may ask for interactively (the benchmark runner is for more). */
export const MAX_INTERACTIVE_RUNS = 400;

export function runFrontierJob(req: FrontierRequest): FrontierResult {
  switch (req.kind) {
    case 'layers':
      return { kind: 'layers', layers: buildLayers(req.input) };
    case 'atlas':
      return { kind: 'atlas', atlas: buildAtlas(req.inputs, req.options) };
    case 'atlas_synthetic':
      return { kind: 'atlas', atlas: syntheticAtlas(req.seed, req.uncertaintyDraws) };
    case 'scenario':
      return { kind: 'scenario', run: scenario(req.id)?.run(req.seed) ?? null };
    case 'montecarlo':
      return { kind: 'montecarlo', result: monteCarlo(req.id, Math.max(1, Math.min(MAX_INTERACTIVE_RUNS, Math.round(req.runs))), req.seed) };
  }
}
