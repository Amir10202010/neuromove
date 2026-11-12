// Ground-truth scenario engine — twenty controllable generative processes with KNOWN hidden parameters, each run
// through the real analysis engine and judged against what a correct analysis must do: detect what is there, not
// invent what is not, and refuse when the data cannot say.
//
// SYNTHETIC ONLY. Every participant id starts with "SYN-", every recording is `simulated: true`. A scenario shows
// how the software behaves under the stated assumptions; it is never evidence about a real participant, and the
// generators are deliberately simpler than pathological movement (stated per scenario).
//
// Levels of generation (not one Gaussian generator for everything):
//   raw             joint-angle trajectories → body kinematics → MPU-6050 model → int16 frames (coord/synthetic.ts)
//   series          latent level per session + day-to-day + repetition noise (the lab's measurement model)
//   within_session  repetition-by-repetition features of one sitting
//   population      participants with their own baselines and slopes
//   labels          strategy assignments per session
//
// A run returns what was OBSERVED by the engine and a verdict: 'as_expected', 'not_as_expected', or 'descriptive'
// (scenarios that characterise behaviour under a violated assumption have no right answer to hit). The Monte Carlo
// rate of 'as_expected' over many seeds — not a single run — is the result (scenario/benchmarks.ts).

import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG } from '../analysis';
import { compareProfiles, partitionVariation, type MotorStrategyProfile } from '../coord/profile';
import { strategyShift } from '../coord/signature';
import { synthSession } from '../coord/strategyValidation';
import { STRATEGIES, type Perturbations, type StrategySpec } from '../coord/synthetic';
import { buildStrategyProfile } from '../coord/profile';
import { createRng, type Rng } from '../../lib/random';
import { lrStep } from '../models';
import { detectChange } from '../observatory/changeDetection';
import { sittingDynamics } from '../observatory/withinSession';
import { comparability, contextOfPractice, UNRECORDED, type TaskContext } from '../tasks/library';
import { fitPopulation, validatePopulation } from '../twin/population';
import { populationSample, syntheticSeries } from '../twin/validation';

export type ScenarioLevel = 'raw' | 'series' | 'within_session' | 'population' | 'labels';

export interface ScenarioRun {
  scenario: string;
  seed: number;
  observed: Record<string, number | string | boolean | null>;
  verdict: 'as_expected' | 'not_as_expected' | 'descriptive';
  /** Optional series for display: the generated observations and the hidden truth. */
  series?: { y: number[]; truth: number[]; label: string };
}

export interface ScenarioDef {
  id: string;
  number: number;
  name: string;
  level: ScenarioLevel;
  /** The generative process and its hidden parameters. */
  process: string;
  truth: Record<string, number | string>;
  /** What a correct analysis does with it. */
  expected: string;
  /** Benchmarks elsewhere in the suite that examine the same situation in depth. */
  related: string[];
  /** Relative cost of one run (raw-level scenarios simulate IMU frames). */
  cost: 'fast' | 'slow';
  /** How this differs from real data — the scenario's own limitation. */
  simplification: string;
  run(seed: number): ScenarioRun;
}

const weekly = (n: number) => Array.from({ length: n }, (_, k) => 7 * k);
const TASK: TaskContext = { exercise: 'shoulder_flexion', side: 'right', setting: 'synthetic', protocolId: null, constraints: { ...UNRECORDED, targetDeg: 'none', speed: 'self_paced' } };
const CFG = { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 };
const block = (spec: StrategySpec, n: number, seed: number, perturb: Perturbations, idx = 0) => synthSession('SYN-G', idx, Array(n).fill(spec) as StrategySpec[], seed, perturb);
const profile = (r: ReturnType<typeof synthSession>, reference?: MotorStrategyProfile | null) => buildStrategyProfile({ frames: r.frames, meta: r.meta }, { task: TASK, ...(reference !== undefined ? { reference: reference?.mount ?? null } : {}) });
const feat = (p: MotorStrategyProfile, id: string) => p.features.find((f) => f.id === id);
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Session-level series with optional custom day-to-day generator. */
function levels(n: number, rng: Rng, z: (k: number) => number, sd: (k: number) => number = () => 1): number[] {
  return Array.from({ length: n }, (_, k) => 100 + 5 * (z(k) + sd(k) * rng.normal()));
}

/** Truth outcome (world arm inclination at the endpoint) of each repetition vs the engine's outcome. */
function outcomeError(r: ReturnType<typeof synthSession>, p: MotorStrategyProfile): number | null {
  const o = feat(p, 'outcome');
  if (!o) return null;
  return o.mean - meanOf(r.truth.map((t) => t.outcome));
}

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'no_change', number: 1, name: 'No actual motor change', level: 'series', cost: 'fast',
    process: 'Constant latent level; day-to-day SD 2.5, repetition SD 4, 12 weekly sessions × 3 repetitions', truth: { change: 0 },
    expected: 'No change signalled; "no change" selected', related: ['E1', 'O1'], simplification: 'independent normal day-to-day variation',
    run(seed) {
      const s = syntheticSeries('SYN-G1', weekly(12), weekly(12).map(() => 120), createRng(seed));
      const a = analyzeSeries(s, CFG);
      const d = detectChange(s.sessions.map((x) => x.mean));
      return { scenario: 'no_change', seed, observed: { selected: a.selected, detection: d.status }, verdict: d.status === 'no_change_signalled' && (a.selected === 'stationary' || a.selected === null) ? 'as_expected' : 'not_as_expected', series: { y: s.sessions.map((x) => x.mean), truth: weekly(12).map(() => 120), label: 'session mean' } };
    },
  },
  {
    id: 'true_improvement', number: 2, name: 'True movement improvement', level: 'series', cost: 'fast',
    process: 'Linear increase of 2 units per week over 12 weekly sessions', truth: { slope_per_week: 2 },
    expected: 'A model of change selected, or a change signalled', related: ['E2', 'O2', 'O8'], simplification: 'a perfectly linear trend',
    run(seed) {
      const t = weekly(12);
      const z = t.map((d) => 100 + (2 * d) / 7);
      const s = syntheticSeries('SYN-G2', t, z, createRng(seed));
      const a = analyzeSeries(s, CFG);
      const d = detectChange(s.sessions.map((x) => x.mean));
      return { scenario: 'true_improvement', seed, observed: { selected: a.selected, detection: d.status }, verdict: (a.selected !== null && a.selected !== 'stationary') || d.status === 'change_signalled' ? 'as_expected' : 'not_as_expected', series: { y: s.sessions.map((x) => x.mean), truth: z, label: 'session mean' } };
    },
  },
  {
    id: 'coordination_change', number: 3, name: 'True coordination change at equal outcome', level: 'raw', cost: 'slow',
    process: 'Two blocks of 12 repetitions, same sensors on: trunk starts 100 ms after the arm, then 350 ms BEFORE it (and moves 20 % faster); planned joint amplitudes identical', truth: { planned_trunk_onset_shift_ms: -450, planned_amplitude_difference: 0 },
    expected: 'The trunk onset lag differs beyond noise; the outcome does not', related: ['S1a', 'V7'],
    simplification: 'two discrete timing patterns, minimum-jerk profiles. Two properties of the MEASUREMENT, found when the scenario was built (80 seeds): the measured lag shift is about −190 ms, not the planned −450 ms, because the arm sensor is carried by the trunk and so "starts" with it; and the measured peak is about 0.7° lower in the second pattern, because the trunk has begun to return when the arm peaks — smaller than the repetition noise of a 12-repetition block',
    run(seed) {
      const a = profile(block(STRATEGIES.trunkAssisted, 12, seed, { mountSeed: seed, noiseSeed: seed + 1 }));
      const b = profile(block(STRATEGIES.trunkLeading, 12, seed + 2, { mountSeed: seed, noiseSeed: seed + 3 }), a);
      const d = compareProfiles(a, b);
      const lag = d.find((x) => x.id === 'onset_lag_trunk_ms');
      const out = d.find((x) => x.id === 'outcome');
      return { scenario: 'coordination_change', seed, observed: { lag_delta_ms: lag?.delta ?? null, lag_verdict: lag?.verdict ?? null, outcome_verdict: out?.verdict ?? null }, verdict: lag?.verdict === 'beyond_noise' && out?.verdict !== 'beyond_noise' ? 'as_expected' : 'not_as_expected' };
    },
  },
  {
    id: 'strategy_transition', number: 4, name: 'Strategy transition across sessions', level: 'labels', cost: 'fast',
    process: 'Share of strategy A among confident assignments 0.2, 0.2, 0.8, 0.8, 0.8 over five sessions of 10 repetitions', truth: { change_after_session: 2 },
    expected: 'A shift is detected', related: ['S6a', 'S6b', 'V8'], simplification: 'independent assignments within a session',
    run(seed) {
      const rng = createRng(seed);
      const sess = [0.2, 0.2, 0.8, 0.8, 0.8].map((p, k) => {
        let a = 0;
        for (let i = 0; i < 10; i++) if (rng.next() < p) a++;
        return { sessionId: `s${k}`, a, b: 10 - a };
      });
      const r = strategyShift(sess, { seed, permutations: 499 });
      return { scenario: 'strategy_transition', seed, observed: { verdict: r.verdict, split: r.split, p: r.p }, verdict: r.verdict === 'shift_detected' ? 'as_expected' : 'not_as_expected' };
    },
  },
  ...(['increase', 'decrease'] as const).map((dir, i): ScenarioDef => ({
    id: `compensation_${dir}`, number: 5 + i, name: `Trunk contribution ${dir === 'increase' ? 'increases' : 'decreases'} while the outcome stays`, level: 'series', cost: 'fast',
    process: `Session mean of the trunk excursion ${dir === 'increase' ? 'rises' : 'falls'} by 1.5° per week over 12 sessions; the task outcome is constant`, truth: { trunk_slope_per_week: dir === 'increase' ? 1.5 : -1.5, outcome_slope: 0 },
    expected: 'Change in the trunk series, none in the outcome series — reported as a change of contribution, never as better or worse', related: ['S1a', 'S4'], simplification: 'session-level series of two features generated independently',
    run(seed) {
      const t = weekly(12);
      const sign = dir === 'increase' ? 1 : -1;
      const zt = t.map((d) => 15 + (sign * 1.5 * d) / 7);
      const trunk = syntheticSeries('SYN-G5', t, zt, createRng(seed), { sigmaE: 2, sigmaS: 1.5 });
      const outcome = syntheticSeries('SYN-G5', t, t.map(() => 120), createRng(seed + 1));
      const dt = detectChange(trunk.sessions.map((x) => x.mean), { family: 2 });
      const dout = detectChange(outcome.sessions.map((x) => x.mean), { family: 2 });
      return { scenario: `compensation_${dir}`, seed, observed: { trunk_detection: dt.status, trunk_direction: dt.cusum.direction, outcome_detection: dout.status }, verdict: dt.status === 'change_signalled' && dt.cusum.direction === (sign > 0 ? 'up' : 'down') && dout.status === 'no_change_signalled' ? 'as_expected' : 'not_as_expected', series: { y: trunk.sessions.map((x) => x.mean), truth: zt, label: 'trunk excursion, °' } };
    },
  })),
  {
    id: 'sensor_reattachment', number: 7, name: 'Sensor re-attachment, no change', level: 'raw', cost: 'slow',
    process: 'The same movement plan recorded twice; new strap misalignment, offsets and biases; arm held 3–8° forward in the second calibration', truth: { movement_change: 0 },
    expected: 'The outcome shift is NOT reported as a change of the movement', related: ['S2', 'M3'], simplification: 'posture error in one direction only; rigid straps',
    run(seed) {
      const rng = createRng(seed);
      const seq = Array(12).fill(STRATEGIES.armDominant) as StrategySpec[];
      const a = profile(synthSession('SYN-G7', 0, seq, seed, { mountSeed: seed + 1, noiseSeed: seed + 2 }));
      const b = profile(synthSession('SYN-G7', 1, seq, seed, { mountSeed: seed + 3, noiseSeed: seed + 4, calibrationPosture: { flexion: 3 + 5 * rng.next() } }), a);
      const o = compareProfiles(a, b).find((x) => x.id === 'outcome');
      return { scenario: 'sensor_reattachment', seed, observed: { outcome_delta: o?.delta ?? null, outcome_verdict: o?.verdict ?? null, placement: b.placement?.level ?? null }, verdict: o && o.verdict !== 'beyond_noise' ? 'as_expected' : 'not_as_expected' };
    },
  },
  ...([
    ['gyro_drift', 8, 'Gyroscope drift', 'Gyroscope bias random walk of 0.05 °/s per √s after calibration', { biasWalkDpsPerSqrtS: 0.05 }, 'bias random walk only'],
    ['accelerometer_noise', 9, 'Accelerometer and gyroscope noise ×6', 'Sensor noise six times the nominal MPU-6050 level', { noiseFactor: 6 }, 'white noise only'],
  ] as const).map(([id, number, name, process, perturb, simplification]): ScenarioDef => ({
    id, number, name, level: 'raw', cost: 'slow', process, truth: { outcome_error_tolerance_deg: 3 },
    expected: 'The task outcome stays within 3° of the kinematic truth, and no repetition is lost silently', related: ['V2', 'V4', 'U1'], simplification,
    run(seed) {
      const r = block(STRATEGIES.armDominant, 10, seed, perturb);
      const p = profile(r);
      const err = outcomeError(r, p);
      return { scenario: id, seed, observed: { outcome_error_deg: err, repetitions: p.repetitions, excluded: p.excludedRepetitions.length, signal: p.quality.signal }, verdict: err !== null && Math.abs(err) <= 3 && p.repetitions + p.excludedRepetitions.length >= 9 ? 'as_expected' : 'not_as_expected' };
    },
  })),
  {
    id: 'missing_packets', number: 10, name: 'Missing packets', level: 'raw', cost: 'slow',
    process: '5 % of frames dropped independently after calibration', truth: { drop_probability: 0.05 },
    expected: 'Signal quality is downgraded; repetitions with missing samples are excluded with a reason, never interpolated', related: ['V4'], simplification: 'independent drops, no bursts',
    run(seed) {
      const r = block(STRATEGIES.armDominant, 10, seed, { dropProbability: 0.05 });
      const p = profile(r);
      const err = outcomeError(r, p);
      const accounted = p.repetitions + p.excludedRepetitions.length;
      return { scenario: 'missing_packets', seed, observed: { signal: p.quality.signal, repetitions: p.repetitions, excluded: p.excludedRepetitions.length, outcome_error_deg: err }, verdict: p.quality.signal !== 'high' && accounted >= 9 && (err === null || Math.abs(err) <= 3) ? 'as_expected' : 'not_as_expected' };
    },
  },
  {
    id: 'sensor_dropout', number: 11, name: 'Sensor dropout (trunk sensor absent)', level: 'raw', cost: 'slow',
    process: 'Trunk-assisted repetitions recorded WITHOUT the trunk sensor', truth: { trunk_pitch_deg: -18 },
    expected: 'Trunk channels are reported unavailable; no trunk value is produced', related: ['V4'], simplification: 'sensor absent for the whole recording',
    run(seed) {
      const p = profile(block(STRATEGIES.trunkAssisted, 10, seed, { removeSensor: 'trunk' }));
      const fabricated = p.trunk.pitchExcursion !== null || p.trunk.contribution !== null;
      return { scenario: 'sensor_dropout', seed, observed: { trunk_channel_unavailable: p.quality.unavailableChannels.includes('trunk_pitch'), trunk_value_produced: fabricated, repetitions: p.repetitions }, verdict: !fabricated && p.quality.unavailableChannels.includes('trunk_pitch') ? 'as_expected' : 'not_as_expected' };
    },
  },
  {
    id: 'task_condition_change', number: 12, name: 'Task-condition change between sessions', level: 'series', cost: 'fast',
    process: 'Sessions 1–3 to a 90° target, sessions 4–6 to a 120° target; the child does exactly what each target asks', truth: { level_low: 90, level_high: 120, movement_change: 0 },
    expected: 'The sessions are declared not comparable and the difference is attributed to the task condition', related: ['S3a'], simplification: 'no other difference between the conditions',
    run(seed) {
      const rng = createRng(seed);
      const a = contextOfPractice({ exercise: 'shoulder_flexion', side: 'right', targetDeg: 90, feedback: 'live_angle_with_target' });
      const b = contextOfPractice({ exercise: 'shoulder_flexion', side: 'right', targetDeg: 120, feedback: 'live_angle_with_target' });
      const cmp = comparability(a, b);
      const part = partitionVariation([90, 90, 90, 120, 120, 120].map((mu, k) => ({ recordingId: `s${k}`, values: Array.from({ length: 8 }, () => mu + 3 * rng.normal()), placementBound: k ? 2 : 0, condition: k < 3 ? 'target=90' : 'target=120' })));
      return { scenario: 'task_condition_change', seed, observed: { comparable: cmp.comparable, reasons: cmp.reasons.join(','), partition: part.verdicts.join(',') }, verdict: !cmp.comparable && part.verdicts.includes('task_conditions_differ') && !part.verdicts.includes('exceeds_measurement_explanations') ? 'as_expected' : 'not_as_expected' };
    },
  },
  ...([
    ['fatigue_like', 13, 'Fatigue-like within-session deterioration', -1, 'decline_like'],
    ['practice_like', 14, 'Practice-related within-session improvement', 1, 'practice_like'],
  ] as const).map(([id, number, name, sign, pattern]): ScenarioDef => ({
    id, number, name, level: 'within_session', cost: 'fast',
    process: `24 repetitions; amplitude, peak rate, duration and smoothness move 2 repetition-SDs in the ${sign > 0 ? '"up"' : '"down"'} direction, linearly`, truth: { total_change_sd: 2 * sign },
    expected: `Pattern "${pattern}" — a kinematic pattern, not a diagnosis of ${sign > 0 ? 'learning' : 'fatigue'}`, related: sign > 0 ? ['W2'] : ['W4'], simplification: 'all features move together and linearly',
    run(seed) {
      const rng = createRng(seed);
      const s = (up: 1 | -1, base: number, sd: number) => Array.from({ length: 24 }, (_, i) => base + sd * (up * sign * ((2 * i) / 23) + rng.normal()));
      const amplitude = s(1, 100, 5);
      const r = sittingDynamics({ amplitude, peak_rate: s(1, 200, 15), duration: s(-1, 1.2, 0.08), smoothness: s(1, -1.6, 0.05) }, seed);
      return { scenario: id, seed, observed: { pattern: r.pattern }, verdict: r.pattern === pattern ? 'as_expected' : 'not_as_expected', series: { y: amplitude, truth: amplitude.map((_, i) => 100 + 5 * sign * ((2 * i) / 23)), label: 'amplitude per repetition' } };
    },
  })),
  ...([
    ['retention', 15, 'Between-session retention', 'The designated session after the 6-week break is recognised as a retention test without recorded practice'],
    ['forgetting', 16, 'Forgetting', 'Forgetting is preferred over saturation (ΔAICc > 2) — the schedule has breaks and varying dose'],
  ] as const).map(([id, number, name, expected]): ScenarioDef => ({
    id, number, name, level: 'series', cost: 'fast',
    process: 'Single-rate learning with forgetting: baseline 80, half-life 21 d, gain 0.3 per minute; 10 sessions × 5 repetitions, breaks of 4 and 6 weeks, practice log', truth: { half_life_days: 21, gain_per_minute: 0.3 },
    expected, related: ['E5', 'T5'], simplification: 'one exponential forgetting rate; practice reported exactly',
    run(seed) {
      const t = [0, 7, 14, 21, 28, 56, 63, 70, 77, 119];
      const dose = [0, 40, 60, 20, 40, 0, 50, 30, 60, 0];
      const z: number[] = [80];
      for (let k = 1; k < t.length; k++) z.push(lrStep(z[k - 1] as number, 80, 21, 0.3, dose[k] as number, (t[k] as number) - (t[k - 1] as number)));
      const s = syntheticSeries('SYN-G15', t, z, createRng(seed), { dose, reps: 5 });
      const a = analyzeSeries(s, { ...CFG, learning: { ...CFG.learning, retentionSessionIds: ['SYN-G15-s9'] } });
      const ret = a.decomposition.retention.find((x) => x.toSessionId === 'SYN-G15-s9');
      const ok = id === 'retention' ? ret?.kind === 'retention_test' && ret.practiceInDelay === 'none_recorded' : a.retention.status === 'supported' || a.retention.status === 'relative_only';
      return { scenario: id, seed, observed: { retention_kind: ret?.kind ?? null, retention_delta: ret?.delta ?? null, forgetting_status: a.retention.status, delta_aicc: a.retention.deltaAicc }, verdict: ok ? 'as_expected' : 'not_as_expected', series: { y: s.sessions.map((x) => x.mean), truth: z, label: 'session mean' } };
    },
  })),
  {
    id: 'measurement_variance', number: 17, name: 'Measurement variance changes, level does not', level: 'series', cost: 'fast',
    process: 'Day-to-day SD doubles from session 9 of 16 (e.g. a less careful placement procedure); the level is constant', truth: { level_change: 0, variance_ratio: 4 },
    expected: 'Descriptive: how often a change of LEVEL is signalled when only the spread changed', related: ['O5'], simplification: 'an abrupt change of spread',
    run(seed) {
      const y = levels(16, createRng(seed), () => 0, (k) => (k >= 8 ? 2 : 1));
      const d = detectChange(y);
      return { scenario: 'measurement_variance', seed, observed: { detection: d.status, direction: d.cusum.direction }, verdict: 'descriptive', series: { y, truth: y.map(() => 100), label: 'session mean' } };
    },
  },
  {
    id: 'different_baselines', number: 18, name: 'Different participant baselines', level: 'population', cost: 'fast',
    process: '30 participants whose starting levels differ (SD 10) around 100', truth: { baseline_sd: 10 },
    expected: 'The spread of individual baselines is recovered within 35 % — and individual envelopes, not a pooled range, are what a session is judged against', related: ['T1'], simplification: 'normal distribution of baselines',
    run(seed) {
      const m = fitPopulation(populationSample(30, 8, createRng(seed)));
      const sd0 = m.status === 'fitted' ? Math.sqrt(m.D[0][0]) : NaN;
      return { scenario: 'different_baselines', seed, observed: { status: m.status, baseline_sd: sd0, mean_level: m.beta[0] }, verdict: m.status === 'fitted' && Math.abs(sd0 - 10) / 10 <= 0.35 ? 'as_expected' : 'not_as_expected' };
    },
  },
  {
    id: 'heterogeneous_learning', number: 19, name: 'Heterogeneous learning trajectories', level: 'population', cost: 'slow',
    process: '24 participants with their own slopes (SD 0.8 per week around 1.5); a held-out participant is predicted from their first three sessions', truth: { slope_mean: 1.5, slope_sd: 0.8 },
    expected: 'Held-out future sessions fall inside their 95 % intervals in 88–99 % of cases', related: ['T2'], simplification: 'linear individual trajectories; exchangeable participants',
    run(seed) {
      const v = validatePopulation(populationSample(24, 9, createRng(seed)), 3);
      return { scenario: 'heterogeneous_learning', seed, observed: { coverage: v.coverage95, mae: v.mae, mae_individual_only: v.baselines.individualOnlyMae, predictions: v.predictions }, verdict: v.coverage95 !== null && v.coverage95 >= 0.88 && v.coverage95 <= 0.99 ? 'as_expected' : 'not_as_expected' };
    },
  },
  {
    id: 'model_misspecification', number: 20, name: 'Model misspecification (wandering level)', level: 'series', cost: 'fast',
    process: 'Day-to-day deviations are autocorrelated (AR(1), ρ = 0.6) around a constant level — no model in the candidate set describes this', truth: { rho: 0.6, level_change: 0 },
    expected: 'Descriptive: how the analysis behaves when its independence assumption is wrong', related: ['O4', 'T2b'], simplification: 'one specific violation',
    run(seed) {
      const rng = createRng(seed);
      let prev = rng.normal();
      const dev = Array.from({ length: 14 }, (_, k) => {
        if (k > 0) prev = 0.6 * prev + Math.sqrt(1 - 0.36) * rng.normal();
        return prev;
      });
      const t = weekly(14);
      // repetition noise on top of the wandering session level
      const s = syntheticSeries('SYN-G20', t, dev.map((v) => 100 + 5 * v), rng, { sigmaS: 0.001 });
      const a = analyzeSeries(s, CFG);
      const d = detectChange(s.sessions.map((x) => x.mean));
      return { scenario: 'model_misspecification', seed, observed: { selected: a.selected, detection: d.status }, verdict: 'descriptive', series: { y: s.sessions.map((x) => x.mean), truth: dev.map((v) => 100 + 5 * v), label: 'session mean' } };
    },
  },
];

export function scenario(id: string): ScenarioDef | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

export interface MonteCarloResult {
  scenario: string;
  runs: number;
  asExpected: number;
  notAsExpected: number;
  descriptive: number;
  /** Counts of each distinct value of every observed string/boolean field (for descriptive scenarios and diagnosis). */
  tallies: Record<string, Record<string, number>>;
}

/** Run a scenario over `runs` consecutive seeds starting at `seed0`. Reports the number of runs actually executed. */
export function monteCarlo(id: string, runs: number, seed0: number): MonteCarloResult | null {
  const sc = scenario(id);
  if (!sc) return null;
  const out: MonteCarloResult = { scenario: id, runs: 0, asExpected: 0, notAsExpected: 0, descriptive: 0, tallies: {} };
  for (let r = 0; r < runs; r++) {
    const x = sc.run(seed0 + r);
    out.runs++;
    if (x.verdict === 'as_expected') out.asExpected++;
    else if (x.verdict === 'not_as_expected') out.notAsExpected++;
    else out.descriptive++;
    for (const [k, v] of Object.entries(x.observed)) {
      if (typeof v === 'number') continue;
      const t = (out.tallies[k] ??= {});
      const key = String(v);
      t[key] = (t[key] ?? 0) + 1;
    }
  }
  return out;
}
