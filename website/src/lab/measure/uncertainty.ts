// Propagation of measurement uncertainty: raw sensor uncertainty → orientation → angles → repetition features →
// session mean. A Monte Carlo propagation of distributions in the sense of GUM Supplement 1 (JCGM 101:2008): the
// stated uncertainty of each INPUT is sampled, the actual processing pipeline (not a linearisation of it) is run on
// every sample, and the spread of each OUTPUT is its standard uncertainty.
//
// Input model (type B — stated, adjustable, defaults from the MPU-6050 simulator model and its data sheet):
//   random      accelerometer and gyroscope noise, independent per sample and axis
//   systematic  residual gyroscope bias after the still calibration (constant after the calibration window) and
//               accelerometer zero offset (constant for the recording) — the same for every repetition of a recording
// The two are propagated SEPARATELY because they combine differently: random error averages out over the n
// repetitions of a session, systematic error does not:
//   u(session mean)² = u_random² / n + u_systematic²
//
// What "adding noise to a noisy recording" estimates: the sensitivity of each output to an independent realisation
// of the input noise. For a locally linear pipeline this equals the output variance caused by the noise already in
// the data; nonlinear steps (maxima, threshold crossings) are evaluated at a slightly noisier operating point. The
// method is validated against independent noise realisations of the same movement (experiment U1,
// uncertainty.node.test.ts).
//
// NOT included (not observable from the recording): calibration-posture differences and soft-tissue motion — see
// placement.ts for their bounds. The budget is therefore a LOWER bound of the total measurement uncertainty.

import { ACC_LSB_PER_G, GYRO_LSB_PER_DPS, INT16_MAX } from '../../core/imu';
import type { Placement, RawFrame } from '../../devices/types';
import { createRng, type Rng } from '../../lib/random';
import type { RecordingMeta } from '../coord/channels';
import { displayDecimals } from './registry';
import { REP_FEATURE_IDS, REP_FEATURE_UNITS, pairByTime, recordingFeatures, type RecordingFeatures, type RepFeatureId } from './repFeatures';

export interface InputUncertainty {
  /** Accelerometer noise, SD per axis and sample, g. */
  accNoiseG: number;
  /** Gyroscope noise, SD per axis and sample, °/s. */
  gyroNoiseDps: number;
  /** Residual gyroscope bias after the still calibration, SD per axis, °/s. */
  gyroBiasDps: number;
  /** Accelerometer zero-offset error, SD per axis, g (≈ 0.01 uncalibrated, ≈ 0.002 after the 6-position calibration). */
  accOffsetG: number;
}

/**
 * Defaults: noise as in the app's MPU-6050 model (simulation/imuModel.ts NORMAL_NOISE, DLPF 44 Hz); residual bias
 * 0.05 °/s (the drift diagnostic of a recording reports the actual value — use it when available); accelerometer
 * offset 0.01 g for a module without the 6-position calibration.
 */
export const MPU6050_UNCERTAINTY: InputUncertainty = { accNoiseG: 0.004, gyroNoiseDps: 0.08, gyroBiasDps: 0.05, accOffsetG: 0.01 };
export const MPU6050_CALIBRATED_UNCERTAINTY: InputUncertainty = { ...MPU6050_UNCERTAINTY, accOffsetG: 0.002 };

export interface FeatureUncertainty {
  feature: RepFeatureId;
  unit: string;
  /** Repetitions of the original recording that carry the feature. */
  repetitions: number;
  mean: number;
  /** Observed repetition-to-repetition SD in the recording (biological variability + measurement noise). */
  sdObserved: number | null;
  /** Standard uncertainty of ONE repetition's value from random sensor noise (jumps trimmed, see spread()). */
  uRandom: number;
  /** The same without trimming: much larger than uRandom when a non-smooth processing step jumps under noise. */
  uRandomUntrimmed: number;
  /** Standard uncertainty common to every repetition of the recording (bias and offset). */
  uSystematic: number;
  /** Mean shift of the feature caused by the added noise (e.g. maxima of a noisy signal read higher). */
  noiseBias: number;
  /** Share of draws that jumped by more than 5 robust SDs: a non-smooth processing step is sensitive to noise here. */
  jumpShare: number;
  /** How the noise-injection estimate of uRandom compared with independent noise realisations (experiment U1). */
  validation: PropagationValidity;
  /** Standard uncertainty of the recording mean: √(uRandom²/n + uSystematic²). */
  uSessionMean: number;
  /** Share of the observed repetition variance that random measurement noise can account for (0…1); null when unknown. */
  measurementShare: number | null;
  /** Decimals the value may be displayed with (first significant digit of uSessionMean). */
  decimals: number;
}

/**
 * How the noise-injection estimate of uRandom compares with the spread over independent noise realisations of the
 * same synthetic movement and mount (experiment U1; ratio = propagated / true). Set from ALL runs so far
 * (research/SCIENTIFIC_VALIDATION.md §M, run history): pilot (1 movement seed), run 1 (1 seed), run 2 and run 3
 * (3 seeds each).
 *   validated               ratio within [0.7, 1.4] in every run (observed 0.85–1.29)
 *   approximate             within [0.5, 2] in every run, outside [0.7, 1.4] in at least one (observed 0.60–1.21)
 *   underestimates          SPARC: 0.09–1.09 — the injected spread is too small
 *   unstable                elbow flexion: 0.03–1.10 — the hinge-branch choice jumps under noise in some movements;
 *                           neither the trimmed nor the untrimmed estimate can be trusted, both are shown
 *   quantised_conservative  10 ms-quantised onset lags whose true spread is often exactly 0 (run 3: forearm lag too)
 * The direction of every known error is stated, never hidden.
 */
export type PropagationValidity = 'validated' | 'approximate' | 'underestimates' | 'unstable' | 'quantised_conservative';
export const PROPAGATION_VALIDITY: Record<RepFeatureId, PropagationValidity> = {
  outcome: 'validated',
  exc_trunk_pitch: 'validated',
  exc_trunk_roll: 'validated',
  exc_upper_elev: 'validated',
  exc_fore_elev: 'approximate',
  exc_elbow_flex: 'unstable',
  exc_humerothoracic: 'validated',
  trunk_contribution: 'validated',
  dur_outbound: 'approximate',
  dur_return: 'validated',
  peak_rate: 'validated',
  time_to_peak_fraction: 'validated',
  sparc_outbound: 'underestimates',
  onset_lag_trunk_ms: 'quantised_conservative',
  onset_lag_fore_ms: 'quantised_conservative',
};

export interface UncertaintyBudget {
  recordingId: string;
  exercise: string;
  draws: { random: number; systematic: number };
  input: InputUncertainty;
  features: FeatureUncertainty[];
  /** Mean share of the original repetitions that were still found in the perturbed analyses. */
  repetitionsRetained: number;
  /** Extra recording-level scalars supplied by the caller: value and standard uncertainty (all inputs together). */
  extra: Record<string, { value: number; u: number }>;
  notes: string[];
}

const clip = (v: number) => Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, Math.round(v)));

/** One perturbed copy of the raw stream. `tBias`: time after which the residual gyroscope bias applies. */
export function perturbFrames(frames: readonly RawFrame[], rng: Rng, u: InputUncertainty, mode: 'random' | 'systematic' | 'both', tBias: number): RawFrame[] {
  const placements = [...new Set(frames.flatMap((f) => Object.keys(f.data) as Placement[]))];
  const bias: Partial<Record<Placement, [number, number, number]>> = {};
  const off: Partial<Record<Placement, [number, number, number]>> = {};
  const sys = mode !== 'random';
  for (const p of placements) {
    bias[p] = sys ? [rng.normal(0, u.gyroBiasDps), rng.normal(0, u.gyroBiasDps), rng.normal(0, u.gyroBiasDps)] : [0, 0, 0];
    off[p] = sys ? [rng.normal(0, u.accOffsetG), rng.normal(0, u.accOffsetG), rng.normal(0, u.accOffsetG)] : [0, 0, 0];
  }
  const rnd = mode !== 'systematic';
  const t0 = frames[0]?.t ?? 0;
  return frames.map((f) => {
    const data: RawFrame['data'] = {};
    const late = f.t - t0 > tBias;
    for (const p of placements) {
      const raw = f.data[p];
      if (!raw) continue;
      const b = bias[p] as [number, number, number];
      const o = off[p] as [number, number, number];
      const out = new Int16Array(6);
      for (let i = 0; i < 3; i++) {
        const a = (raw[i] as number) + (o[i] as number) * ACC_LSB_PER_G + (rnd ? rng.normal(0, u.accNoiseG * ACC_LSB_PER_G) : 0);
        const g = (raw[i + 3] as number) + (late ? (b[i] as number) * GYRO_LSB_PER_DPS : 0) + (rnd ? rng.normal(0, u.gyroNoiseDps * GYRO_LSB_PER_DPS) : 0);
        out[i] = clip(a);
        out[i + 3] = clip(g);
      }
      data[p] = out;
    }
    return { seq: f.seq, t: f.t, data };
  });
}

const sdOf = (xs: readonly number[]) => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const meanOf = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const medianOf = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * Spread of the draws of one repetition: the classical SD after removing "jumps" — draws further than 5 robust SDs
 * (1.4826 × median absolute deviation) from the median. Non-smooth steps of the pipeline (the elbow branch choice,
 * threshold crossings) occasionally jump under the added noise; a few jumps would dominate the SD without
 * describing the typical uncertainty (experiment U1), so their share is reported separately instead. Quantised
 * features whose draws are mostly identical (MAD = 0) are not trimmed.
 */
function spread(xs: readonly number[]): { u: number; jumps: number } {
  const med = medianOf(xs);
  const mad = 1.4826 * medianOf(xs.map((x) => Math.abs(x - med)));
  if (!(mad > 0)) return { u: sdOf(xs), jumps: 0 };
  const kept = xs.filter((x) => Math.abs(x - med) <= 5 * mad);
  return { u: kept.length >= 3 ? sdOf(kept) : mad, jumps: 1 - kept.length / xs.length };
}

export interface PropagateOptions {
  draws?: number;
  seed?: number;
  input?: InputUncertainty;
  /** Recording-level scalars to propagate as well (e.g. a session statistic used downstream). */
  extra?: (f: RecordingFeatures) => Record<string, number>;
}

export const DEFAULT_PROPAGATION = { draws: 30, seed: 20261110 } as const;

export function propagateUncertainty(frames: readonly RawFrame[], meta: RecordingMeta, exercise: string, o: PropagateOptions = {}): UncertaintyBudget {
  const draws = o.draws ?? DEFAULT_PROPAGATION.draws;
  const input = o.input ?? MPU6050_UNCERTAINTY;
  const rng = createRng(o.seed ?? DEFAULT_PROPAGATION.seed);
  const base = recordingFeatures(frames, meta, exercise);
  const notes: string[] = ['lower_bound:_calibration_posture_and_soft_tissue_motion_are_not_included'];
  const tBias = base.cs.t[Math.max(0, base.cs.calibration.end - 1)] ?? 0;
  const nRep = base.reps.length;
  if (!nRep) {
    return { recordingId: meta.id, exercise, draws: { random: 0, systematic: 0 }, input, features: [], repetitionsRetained: 0, extra: {}, notes: ['no_complete_repetitions'] };
  }
  // per repetition and feature: values across random-noise draws; per feature: recording means across systematic draws
  const rand: Partial<Record<RepFeatureId, number[]>>[] = base.reps.map(() => ({}));
  const sysMean: Partial<Record<RepFeatureId, number[]>> = {};
  const extraBase = o.extra ? o.extra(base) : {};
  const extraDraws: Record<string, number[]> = {};
  let retained = 0;
  for (const mode of ['random', 'systematic'] as const) {
    for (let d = 0; d < draws; d++) {
      const pf = recordingFeatures(perturbFrames(frames, rng, input, mode, tBias), meta, exercise);
      const { pairs } = pairByTime(base.reps, pf.reps);
      retained += pairs.length / nRep;
      if (mode === 'random') {
        for (const [a, b] of pairs)
          for (const f of REP_FEATURE_IDS) {
            const v = b.values[f];
            if (v === undefined) continue;
            ((rand[a.index] as Partial<Record<RepFeatureId, number[]>>)[f] ??= []).push(v);
          }
      } else {
        for (const f of REP_FEATURE_IDS) {
          // mean over the repetitions present in BOTH analyses, as a difference from the original (paired)
          const dv: number[] = [];
          for (const [a, b] of pairs) {
            const x = a.values[f];
            const y = b.values[f];
            if (x !== undefined && y !== undefined) dv.push(y - x);
          }
          if (dv.length) (sysMean[f] ??= []).push(meanOf(dv));
        }
      }
      if (o.extra) for (const [k, v] of Object.entries(o.extra(pf))) if (Number.isFinite(v)) (extraDraws[k] ??= []).push(v);
    }
  }
  const features: FeatureUncertainty[] = [];
  for (const f of REP_FEATURE_IDS) {
    const obs = base.reps.map((r) => r.values[f]).filter((v): v is number => v !== undefined);
    if (!obs.length) continue;
    const vars: number[] = [];
    const varsAll: number[] = [];
    const shifts: number[] = [];
    const jumps: number[] = [];
    base.reps.forEach((r, i) => {
      const xs = (rand[i] as Partial<Record<RepFeatureId, number[]>>)[f];
      const x0 = r.values[f];
      if (!xs || x0 === undefined || xs.length < Math.max(3, 0.5 * draws)) return;
      const sp = spread(xs);
      vars.push(sp.u ** 2);
      varsAll.push(sdOf(xs) ** 2);
      jumps.push(sp.jumps);
      shifts.push(medianOf(xs) - x0);
    });
    if (!vars.length) continue;
    const uRandom = Math.sqrt(meanOf(vars));
    const sm = sysMean[f];
    // around 0, not around the draw mean: the systematic draws are zero-mean offsets and a paired difference
    const uSystematic = sm && sm.length >= 3 ? Math.sqrt(meanOf(sm.map((v) => v * v))) : NaN;
    const sdObserved = obs.length >= 2 ? sdOf(obs) : null;
    const uSession = Math.sqrt(uRandom ** 2 / obs.length + (Number.isFinite(uSystematic) ? uSystematic ** 2 : 0));
    features.push({
      feature: f,
      unit: REP_FEATURE_UNITS[f],
      repetitions: obs.length,
      mean: meanOf(obs),
      sdObserved,
      uRandom,
      uRandomUntrimmed: Math.sqrt(meanOf(varsAll)),
      uSystematic,
      noiseBias: meanOf(shifts),
      jumpShare: meanOf(jumps),
      validation: PROPAGATION_VALIDITY[f],
      uSessionMean: uSession,
      measurementShare: sdObserved !== null && sdObserved > 0 ? Math.min(1, uRandom ** 2 / sdObserved ** 2) : null,
      decimals: displayDecimals(uSession),
    });
  }
  const extra: UncertaintyBudget['extra'] = {};
  for (const [k, v] of Object.entries(extraBase)) {
    const xs = extraDraws[k];
    if (Number.isFinite(v) && xs && xs.length >= 3) extra[k] = { value: v, u: Math.sqrt(meanOf(xs.map((x) => (x - v) ** 2))) };
  }
  const rr = retained / (2 * draws);
  if (rr < 0.95) notes.push('some_repetitions_are_not_detected_under_added_noise:_segmentation_is_itself_uncertain');
  return { recordingId: meta.id, exercise, draws: { random: draws, systematic: draws }, input, features, repetitionsRetained: rr, extra, notes };
}

/**
 * Standard uncertainty of a CHANGE between two session means (independent recordings, each with its own systematic
 * error): √(u₁² + u₂²). A change smaller than `coverage` × this is not distinguishable from sensor error alone —
 * before biological variability and placement are even considered.
 */
export function changeUncertainty(a: FeatureUncertainty, b: FeatureUncertainty, coverage = 1.959963984540054): { u: number; expanded: number } {
  const u = Math.sqrt(a.uSessionMean ** 2 + b.uSessionMean ** 2);
  return { u, expanded: coverage * u };
}
