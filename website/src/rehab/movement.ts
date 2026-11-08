// Movement intelligence for rehabilitation — built ON the existing IMU pipeline output (core/metrics.ts),
// never beside it. Input is the stored Session (steps → per-repetition metrics + 20 Hz angle trace).
//
// Every metric has a documented definition, unit, input, processing, limitations and validation status
// (METRICS). Nothing here is clinically validated: the device has not been through a clinical
// validation study in children. Values are shown as "IMU-derived measurements", never as function.

import { EXERCISES, type ExerciseId } from '../core/exercises';
import type { StepFlag } from '../core/metrics';
import { isSimulatedSession, type Session } from '../data/models';
import type { Side } from '../devices/types';
import { cvPercent, median, sd, slope } from '../lib/stats';

export type MetricId =
  | 'rom'
  | 'min_angle'
  | 'excursion'
  | 'peak_velocity'
  | 'rep_duration'
  | 'time_to_peak'
  | 'sparc'
  | 'rom_cv'
  | 'rom_sd'
  | 'rep_interval_cv'
  | 'trunk'
  | 'rep_count';

export type ValidationStatus = 'software_verified' | 'experimental' | 'not_computed';

export interface MetricDef {
  id: MetricId;
  group: 'range' | 'dynamics' | 'quality' | 'compensation' | 'volume';
  unit: string;
  /** Plain-text formula. */
  definition: string;
  input: string;
  processing: string;
  limitations: string;
  /**
   * software_verified = reproduced on simulated ground truth in automated tests (src/verification);
   * experimental = computed, but resolution or method limits it. NONE is clinically validated.
   */
  validation: ValidationStatus;
  /** Direction has no clinical meaning by itself; this only orders the axis. */
  higherIs: 'larger' | 'smoother' | 'more_variable' | 'more_compensation' | 'longer' | 'faster' | 'more';
}

const ANGLE_INPUT = 'Joint angle from the existing pipeline (core/pipeline.ts): upper-arm elevation, elbow flexion or forearm rotation, from 3 × MPU-6050 at 100 Hz.';

export const METRICS: Record<MetricId, MetricDef> = {
  rom: {
    id: 'rom',
    group: 'range',
    unit: '°',
    definition: 'ROMᵣ = max θ(t) over repetition r (forearm rotation: supination + pronation arc); reported value = median over repetitions.',
    input: ANGLE_INPUT,
    processing: 'Repetitions segmented by the existing hysteresis detector (core/reps.ts); max per repetition at 100 Hz.',
    limitations: 'Angle relative to the calibration pose. Shoulder elevation does not separate flexion from abduction plane. No magnetometer: no heading.',
    validation: 'software_verified',
    higherIs: 'larger',
  },
  min_angle: {
    id: 'min_angle',
    group: 'range',
    unit: '°',
    definition: 'min θ(t) within each repetition window; median over repetitions.',
    input: 'Stored 20 Hz angle trace of the step.',
    processing: 'Trace samples with tStart ≤ t ≤ tEnd of each repetition.',
    limitations: '20 Hz decimated trace: short extremes may be missed (≤ 50 ms). Repetition windows start at a threshold crossing, so the true minimum before the movement may lie outside the window.',
    validation: 'experimental',
    higherIs: 'larger',
  },
  excursion: {
    id: 'excursion',
    group: 'range',
    unit: '°',
    definition: 'max θ − min θ within each repetition window; median over repetitions.',
    input: 'Stored 20 Hz angle trace of the step.',
    processing: 'As min_angle.',
    limitations: 'As min_angle; excursion is bounded below by the detector threshold.',
    validation: 'experimental',
    higherIs: 'larger',
  },
  peak_velocity: {
    id: 'peak_velocity',
    group: 'dynamics',
    unit: '°/s',
    definition: 'max |ω(t)| within each repetition; median over repetitions.',
    input: 'Gyroscope angular speed of the moving segment from the existing pipeline.',
    processing: 'Computed by core/metrics.ts at 100 Hz; DLPF 44 Hz in the sensor.',
    limitations: 'Segment angular speed, not joint angular velocity for elbow flexion when the upper arm moves too. ±1000 °/s range.',
    validation: 'software_verified',
    higherIs: 'faster',
  },
  rep_duration: {
    id: 'rep_duration',
    group: 'dynamics',
    unit: 's',
    definition: 'tEnd − tStart of each repetition window; median.',
    input: 'Repetition windows from the detector.',
    processing: 'Threshold crossings (hysteresis); see core/reps.ts.',
    limitations: 'Depends on detector thresholds, which depend on the expected range; not a movement onset/offset by velocity.',
    validation: 'software_verified',
    higherIs: 'longer',
  },
  time_to_peak: {
    id: 'time_to_peak',
    group: 'dynamics',
    unit: 's',
    definition: 't(argmax θ) − tStart within each repetition; median.',
    input: 'Stored 20 Hz angle trace and repetition windows.',
    processing: 'Trace samples inside each window.',
    limitations: '±50 ms resolution (20 Hz trace). Window starts at a threshold crossing, not at movement onset.',
    validation: 'experimental',
    higherIs: 'longer',
  },
  sparc: {
    id: 'sparc',
    group: 'quality',
    unit: '',
    definition: 'Spectral arc length of the normalised speed profile of the rising phase (Balasubramanian et al. 2015); median over repetitions. Values closer to 0 = smoother.',
    input: 'Angular speed profile, rise phase of each repetition.',
    processing: 'core/sparc.ts (fc 10 Hz, amplitude threshold 0.05).',
    limitations: 'Validated in adult reaching with other sensors; not validated for children with motor impairment on this device. Sensitive to segmentation.',
    validation: 'experimental',
    higherIs: 'smoother',
  },
  rom_cv: {
    id: 'rom_cv',
    group: 'quality',
    unit: '%',
    definition: 'CV = SD(ROMᵣ) / mean(ROMᵣ) × 100 across repetitions of one step (consistency).',
    input: 'Per-repetition ROM.',
    processing: 'Sample SD (n − 1). Needs ≥ 2 repetitions.',
    limitations: 'Mixes biological variability, effort, attention and measurement noise. Few repetitions → unstable.',
    validation: 'software_verified',
    higherIs: 'more_variable',
  },
  rom_sd: {
    id: 'rom_sd',
    group: 'quality',
    unit: '°',
    definition: 'SD(ROMᵣ) across repetitions of one step (variability).',
    input: 'Per-repetition ROM.',
    processing: 'Sample SD (n − 1).',
    limitations: 'As rom_cv.',
    validation: 'software_verified',
    higherIs: 'more_variable',
  },
  rep_interval_cv: {
    id: 'rep_interval_cv',
    group: 'quality',
    unit: '%',
    definition: 'CV of the intervals between consecutive repetition starts (timing regularity).',
    input: 'Repetition windows.',
    processing: 'Needs ≥ 3 repetitions.',
    limitations: 'Includes pauses the child or professional chose; not a motor-control measure on its own.',
    validation: 'experimental',
    higherIs: 'more_variable',
  },
  trunk: {
    id: 'trunk',
    group: 'compensation',
    unit: '°',
    definition: 'Max trunk tilt from the calibration pose within each repetition; median.',
    input: 'Trunk sensor (one of the three modules).',
    processing: 'core/metrics.ts.',
    limitations: 'Tilt only (no rotation without magnetometer). Only for exercises where the trunk sensor is worn.',
    validation: 'software_verified',
    higherIs: 'more_compensation',
  },
  rep_count: {
    id: 'rep_count',
    group: 'volume',
    unit: '',
    definition: 'Number of repetitions detected in the step.',
    input: 'Repetition windows.',
    processing: 'Detector count.',
    limitations: 'A count of detected movements, not of "correct" ones. Never used as a target to increase.',
    validation: 'software_verified',
    higherIs: 'more',
  },
};

export const METRIC_ORDER: MetricId[] = ['rom', 'min_angle', 'excursion', 'peak_velocity', 'rep_duration', 'time_to_peak', 'sparc', 'rom_cv', 'rom_sd', 'rep_interval_cv', 'trunk', 'rep_count'];

/** Angular acceleration is NOT computed: the stored trace is 20 Hz and differentiating twice amplifies noise. */
export const NOT_COMPUTED = [{ id: 'angular_acceleration', reason: 'Stored trace is 20 Hz; a second derivative would be dominated by noise. Raw 100 Hz data are kept for offline analysis.' }];

/** Quality problems that make a step unreliable for comparison. */
const BLOCKING_FLAGS: readonly StepFlag[] = ['saturation', 'data_gap', 'sensor_lost', 'mount_flipped', 'calibration_moved'];
export const MIN_REPS = 3;
export const MIN_SIGNAL_PERCENT = 90;

export type QualityIssue = 'simulated' | 'low_signal' | 'few_reps' | 'skipped' | StepFlag;

export interface StepMeasure {
  sessionId: string;
  date: string;
  exercise: ExerciseId;
  side: Side;
  values: Partial<Record<MetricId, number>>;
  /** Per-repetition values (for noise estimates and the repetition table). */
  reps: Partial<Record<MetricId, number[]>>;
  issues: QualityIssue[];
  /** Usable for comparisons across sessions. */
  eligible: boolean;
  simulated: boolean;
  signalPercent: number;
}

const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x));
const med = (xs: number[]) => {
  const f = finite(xs);
  return f.length ? median(f) : NaN;
};

/** Extract every documented metric for every step of a stored sensor session. */
export function measureSession(s: Session): StepMeasure[] {
  const simulated = isSimulatedSession(s);
  const out: StepMeasure[] = [];
  for (const st of s.steps) {
    const sum = st.summary;
    const reps = sum.reps;
    const tr = st.trace;
    const minA: number[] = [];
    const exc: number[] = [];
    const ttp: number[] = [];
    for (const r of reps) {
      let lo = Infinity;
      let hi = -Infinity;
      let tPeak = r.tStart;
      for (let k = 0; k < tr.t.length; k++) {
        const t = tr.t[k] as number;
        if (t < r.tStart || t > r.tEnd) continue;
        const a = tr.angle[k] as number;
        if (a < lo) lo = a;
        if (a > hi) {
          hi = a;
          tPeak = t;
        }
      }
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        minA.push(lo);
        exc.push(hi - lo);
        ttp.push(tPeak - r.tStart);
      }
    }
    const starts = reps.map((r) => r.tStart);
    const intervals = starts.slice(1).map((t, i) => t - (starts[i] as number));
    const romReps = reps.map((r) => r.rom);
    const values: Partial<Record<MetricId, number>> = {
      rom: sum.rom,
      min_angle: med(minA),
      excursion: med(exc),
      peak_velocity: sum.peakVelocity,
      rep_duration: sum.repDuration,
      time_to_peak: med(ttp),
      sparc: sum.sparc,
      rom_cv: sum.cv,
      rom_sd: sd(romReps),
      rep_interval_cv: intervals.length >= 2 ? cvPercent(intervals) : NaN,
      trunk: sum.trunk ?? NaN,
      rep_count: reps.length,
    };
    for (const k of Object.keys(values) as MetricId[]) if (!Number.isFinite(values[k] as number)) delete values[k];
    if (!EXERCISES[sum.exercise].trunk) delete values.trunk;
    const issues: QualityIssue[] = [];
    if (simulated) issues.push('simulated');
    if (st.status === 'skipped') issues.push('skipped');
    if (!(s.quality.percent >= MIN_SIGNAL_PERCENT)) issues.push('low_signal');
    if (reps.length < MIN_REPS) issues.push('few_reps');
    for (const f of sum.flags) if (BLOCKING_FLAGS.includes(f)) issues.push(f);
    out.push({
      sessionId: s.id,
      date: s.startedAt,
      exercise: sum.exercise,
      side: sum.side,
      values,
      reps: {
        rom: romReps,
        min_angle: minA,
        excursion: exc,
        peak_velocity: reps.map((r) => r.peakVelocity),
        rep_duration: reps.map((r) => r.duration),
        time_to_peak: ttp,
        sparc: finite(reps.map((r) => r.sparc)),
        trunk: finite(reps.map((r) => r.trunk ?? NaN)),
      },
      issues: [...new Set(issues)],
      // Simulated data is never eligible for real comparisons (the demo workspace uses usable(…, demo))
      eligible: issues.length === 0,
      simulated,
      signalPercent: s.quality.percent,
    });
  }
  return out;
}

export interface Series {
  exercise: ExerciseId;
  side: Side;
  points: StepMeasure[];
}

/** One series per (exercise, side), sessions in time order. Steps repeated in one session: the last one counts. */
export function movementSeries(sessions: readonly Session[], opts: { includeSimulated: boolean }): Series[] {
  const by = new Map<string, Series>();
  for (const s of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (!opts.includeSimulated && isSimulatedSession(s)) continue;
    const perSession = new Map<string, StepMeasure>();
    for (const m of measureSession(s)) perSession.set(`${m.exercise}:${m.side}`, m);
    for (const [k, m] of perSession) {
      const cur = by.get(k) ?? { exercise: m.exercise, side: m.side, points: [] };
      cur.points.push(m);
      by.set(k, cur);
    }
  }
  return [...by.values()];
}

/** Treat demo-workspace simulated points as usable for display/analysis, but keep them labelled. */
export function usable(m: StepMeasure, demo: boolean): boolean {
  if (m.eligible) return true;
  return demo && m.issues.length === 1 && m.issues[0] === 'simulated';
}

export interface BaselineComparison {
  metric: MetricId;
  baseline: { sessionIds: string[]; value: number; n: number; designated: boolean };
  latest: { sessionId: string; value: number; n: number };
  delta: number;
  /**
   * Heuristic noise check: 2 × SE of the difference of repetition means, from within-session spread.
   * NOT a minimal detectable change (no MDC exists for this device in children).
   */
  noise: number | null;
  exceedsNoise: boolean | null;
}

/**
 * Compare the latest usable point with the individual baseline. Baseline = sessions the professional
 * designated; when none, the first usable session is used and marked `designated: false` (provisional).
 */
export function compareToBaseline(series: Series, metric: MetricId, designated: readonly string[], demo: boolean): BaselineComparison | null {
  const pts = series.points.filter((p) => usable(p, demo) && p.values[metric] !== undefined);
  if (pts.length < 2) return null;
  const designatedPts = pts.filter((p) => designated.includes(p.sessionId));
  const basePts = designatedPts.length ? designatedPts : [pts[0] as StepMeasure];
  const latest = pts[pts.length - 1] as StepMeasure;
  if (basePts.some((b) => b.sessionId === latest.sessionId)) return null;
  const baseValue = median(basePts.map((p) => p.values[metric] as number));
  const baseReps = basePts.flatMap((p) => p.reps[metric] ?? []);
  const lastReps = latest.reps[metric] ?? [];
  let noise: number | null = null;
  if (baseReps.length >= 2 && lastReps.length >= 2) noise = 2 * Math.sqrt(sd(baseReps) ** 2 / baseReps.length + sd(lastReps) ** 2 / lastReps.length);
  const delta = (latest.values[metric] as number) - baseValue;
  return {
    metric,
    baseline: { sessionIds: basePts.map((p) => p.sessionId), value: baseValue, n: baseReps.length, designated: designatedPts.length > 0 },
    latest: { sessionId: latest.sessionId, value: latest.values[metric] as number, n: lastReps.length },
    delta,
    noise,
    exceedsNoise: noise === null ? null : Math.abs(delta) > noise,
  };
}

/** Linear trend per week over the last `n` usable points (descriptive; needs ≥ 3 points). */
export function trendPerWeek(series: Series, metric: MetricId, demo: boolean, n = 6): { slope: number; points: number } | null {
  const pts = series.points.filter((p) => usable(p, demo) && p.values[metric] !== undefined).slice(-n);
  if (pts.length < 3) return null;
  const t0 = Date.parse(pts[0]!.date);
  const b = slope(
    pts.map((p) => (Date.parse(p.date) - t0) / (7 * 86400_000)),
    pts.map((p) => p.values[metric] as number),
  );
  return Number.isFinite(b) ? { slope: b, points: pts.length } : null;
}

/** Repetitions far from the session's own median (median ± 3 × scaled MAD). Indices into the step's reps. */
export function unusualRepetitions(values: readonly number[]): number[] {
  if (values.length < 4) return [];
  const m = median([...values]);
  const mad = 1.4826 * median(values.map((v) => Math.abs(v - m)));
  if (!(mad > 0)) return [];
  return values.map((v, i) => (Math.abs(v - m) > 3 * mad ? i : -1)).filter((i) => i >= 0);
}

