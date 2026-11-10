// Sensor re-attachment study on SYNTHETIC ground truth (participants "SYN-*"): how much does each repetition
// feature change when the same movement is recorded with a sensor strapped on differently?
//
//   M2  rotation      the SAME raw stream, one sensor virtually re-mounted rotated by 2 / 5 / 10 / 20° about its bone
//                     axis (X), and about its two transverse axes (Y, Z)                          — exact
//   M3  posture       the same movement and sensor noise, but the calibration posture is not reproduced: the arm is
//                     held 2 / 5 / 10° forward or sideways, or the trunk pitched, during calibration   — regenerated
//   M4  translation   the same movement, the sensor strapped 2 / 4 cm further along the bone           — regenerated
// Several movement seeds can be pooled: the elbow error in particular depends on the individual repetitions.
//
// Every comparison is PAIRED repetition by repetition against the unperturbed recording of the same seed, so the
// differences are the effect of the placement alone. Results: research/data/measurement-validation.json.

import type { Placement, RawFrame } from '../../devices/types';
import { DEG, rotAxis, type Vec3 } from '../../lib/vec3';
import type { RecordingMeta } from '../coord/channels';
import { STRATEGIES, generateSession, type Perturbations, type StrategySpec } from '../coord/synthetic';
import { virtualRemount } from './placement';
import type { SensorRole } from './registry';
import { REP_FEATURE_IDS, REP_FEATURE_UNITS, pairByTime, recordingFeatures, type RepFeatureId, type RepFeatureRecord } from './repFeatures';

export interface RemountRow {
  experiment: 'M2_rotation' | 'M3_calibration_posture' | 'M4_translation';
  exercise: string;
  sensor: SensorRole;
  /** What was changed: 'about_bone_axis' | 'about_Y' | 'about_Z' | 'arm_forward' | 'arm_sideways' | 'trunk_pitched' | 'along_bone'. */
  kind: string;
  offset: number;
  offsetUnit: '°' | 'cm';
  feature: RepFeatureId;
  unit: string;
  /** Mean, 95th percentile and largest |perturbed − original| over paired repetitions (all seeds pooled), and the mean signed difference. */
  meanAbs: number;
  p95Abs: number;
  maxAbs: number;
  meanSigned: number;
  pairs: number;
  /** Repetitions of the original recording that were not found, or lost the feature, in the perturbed one. */
  lost: number;
}

export interface ReattachmentStudy {
  seeds: number[];
  baseline: { exercise: string; repetitions: number }[];
  rows: RemountRow[];
}

const SEQ: StrategySpec[] = [STRATEGIES.armDominant, STRATEGIES.trunkAssisted, STRATEGIES.elbowFlexed, STRATEGIES.trunkLeading];

function session(exercise: 'shoulder_flexion' | 'shoulder_abduction', seed: number, perturb?: Perturbations): { frames: RawFrame[]; meta: RecordingMeta } {
  const sequence = Array.from({ length: 12 }, (_, i) => SEQ[i % SEQ.length] as StrategySpec);
  const rec = generateSession({ participantId: 'SYN-M', sessionIndex: 0, exercise, side: 'right', sequence, duration: { mean: 1.2, cv: 0.1 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.03, seed, ...(perturb ? { perturb } : {}) });
  return { frames: rec.frames, meta: rec.meta };
}

type Acc = Map<string, { d: number[]; have: number }>;

/** Paired differences of every feature between a base and a perturbed analysis, accumulated under `key`. */
function accumulate(acc: Acc, key: string, base: readonly RepFeatureRecord[], other: readonly RepFeatureRecord[]): void {
  const { pairs } = pairByTime(base, other);
  for (const f of REP_FEATURE_IDS) {
    let have = 0;
    for (const b of base) if (b.values[f] !== undefined) have++;
    if (!have) continue;
    const k = `${key}|${f}`;
    const slot = acc.get(k) ?? { d: [], have: 0 };
    slot.have += have;
    for (const [a, b] of pairs) {
      const x = a.values[f];
      const y = b.values[f];
      if (x !== undefined && y !== undefined) slot.d.push(y - x);
    }
    acc.set(k, slot);
  }
}

const ROLE_PLACEMENT: Record<SensorRole, Placement> = { trunk: 'trunk', upper: 'upper_r', fore: 'fore_r' };

export function reattachmentStudy(o: { seeds?: number[]; seed?: number; exercises?: ('shoulder_flexion' | 'shoulder_abduction')[]; rotations?: number[]; postures?: number[]; shiftsCm?: number[] } = {}): ReattachmentStudy {
  const seeds = o.seeds ?? [o.seed ?? 20261110];
  const acc: Acc = new Map();
  const baseline: ReattachmentStudy['baseline'] = [];
  const exercises = o.exercises ?? ['shoulder_flexion', 'shoulder_abduction'];
  for (const exercise of exercises) {
    let nBase = 0;
    for (const seed of seeds) {
      const base = session(exercise, seed);
      const b = recordingFeatures(base.frames, base.meta, exercise).reps;
      nBase += b.length;
      const add = (experiment: RemountRow['experiment'], sensor: SensorRole, kind: string, offset: number, offsetUnit: '°' | 'cm', other: readonly RepFeatureRecord[]) =>
        accumulate(acc, [experiment, exercise, sensor, kind, offset, offsetUnit].join('|'), b, other);
      // M2 — rotation of one sensor, same raw stream
      const axes: [string, Vec3][] = [['about_bone_axis', [1, 0, 0]], ['about_Y', [0, 1, 0]], ['about_Z', [0, 0, 1]]];
      for (const sensor of ['trunk', 'upper', 'fore'] as const)
        for (const [kind, ax] of axes)
          for (const deg of o.rotations ?? [2, 5, 10, 20]) {
            const fr = virtualRemount(base.frames, ROLE_PLACEMENT[sensor], rotAxis(ax, deg * DEG));
            add('M2_rotation', sensor, kind, deg, '°', recordingFeatures(fr, base.meta, exercise).reps);
          }
      // M3 — calibration posture not reproduced (same seed: same movement, same sensor noise)
      for (const deg of o.postures ?? [2, 5, 10]) {
        const cases: [SensorRole, string, NonNullable<Perturbations['calibrationPosture']>][] = [
          ['upper', 'arm_forward', { flexion: deg }],
          ['upper', 'arm_sideways', { abduction: deg }],
          ['trunk', 'trunk_pitched', { trunkPitch: deg }],
        ];
        for (const [sensor, kind, cp] of cases) {
          const s = session(exercise, seed, { calibrationPosture: cp });
          add('M3_calibration_posture', sensor, kind, deg, '°', recordingFeatures(s.frames, s.meta, exercise).reps);
        }
      }
      // M4 — sensor strapped further along the bone
      for (const cm of o.shiftsCm ?? [2, 4])
        for (const sensor of ['upper', 'fore', 'trunk'] as const) {
          const s = session(exercise, seed, { sensorShiftM: { [ROLE_PLACEMENT[sensor]]: [cm / 100, 0, 0] } });
          add('M4_translation', sensor, 'along_bone', cm, 'cm', recordingFeatures(s.frames, s.meta, exercise).reps);
        }
    }
    baseline.push({ exercise, repetitions: nBase });
  }
  const rows: RemountRow[] = [];
  for (const [k, v] of acc) {
    const [experiment, exercise, sensor, kind, offset, offsetUnit, feature] = k.split('|') as [RemountRow['experiment'], string, SensorRole, string, string, '°' | 'cm', RepFeatureId];
    const abs = v.d.map(Math.abs).sort((a, b) => a - b);
    const n = abs.length;
    rows.push({
      experiment, exercise, sensor, kind, offset: Number(offset), offsetUnit, feature, unit: REP_FEATURE_UNITS[feature],
      meanAbs: n ? abs.reduce((a, c) => a + c, 0) / n : NaN,
      p95Abs: n ? (abs[Math.min(n - 1, Math.ceil(0.95 * n) - 1)] as number) : NaN,
      maxAbs: n ? (abs[n - 1] as number) : NaN,
      meanSigned: n ? v.d.reduce((a, c) => a + c, 0) / n : NaN,
      pairs: n,
      lost: v.have - n,
    });
  }
  return { seeds, baseline, rows };
}

/** Least-squares slope through the origin of mean |Δ| against the offset: the feature's sensitivity per unit offset. */
export function sensitivity(rows: readonly RemountRow[], q: { experiment: RemountRow['experiment']; exercise: string; sensor: SensorRole; kind: string; feature: RepFeatureId; maxOffset?: number }): number | null {
  const r = rows.filter((x) => x.experiment === q.experiment && x.exercise === q.exercise && x.sensor === q.sensor && x.kind === q.kind && x.feature === q.feature && Number.isFinite(x.meanAbs) && (q.maxOffset === undefined || x.offset <= q.maxOffset));
  if (!r.length) return null;
  const sxx = r.reduce((a, x) => a + x.offset * x.offset, 0);
  return sxx > 0 ? r.reduce((a, x) => a + x.offset * x.meanAbs, 0) / sxx : null;
}

/**
 * Per feature: the largest sensitivity to a ROTATION of each sensor (per degree), over the three rotation axes.
 * A feature whose every value is below `tol` per degree is rotation-invariant in practice.
 */
export function rotationSummary(study: ReattachmentStudy, exercise: string, tol = 0.02): { feature: RepFeatureId; unit: string; worst: { sensor: SensorRole; kind: string; perDeg: number } | null; invariant: boolean }[] {
  return REP_FEATURE_IDS.filter((f) => study.rows.some((r) => r.feature === f && r.exercise === exercise)).map((feature) => {
    let worst: { sensor: SensorRole; kind: string; perDeg: number } | null = null;
    for (const sensor of ['trunk', 'upper', 'fore'] as const)
      for (const kind of ['about_bone_axis', 'about_Y', 'about_Z']) {
        const s = sensitivity(study.rows, { experiment: 'M2_rotation', exercise, sensor, kind, feature, maxOffset: 10 });
        if (s !== null && (!worst || s > worst.perDeg)) worst = { sensor, kind, perDeg: s };
      }
    return { feature, unit: REP_FEATURE_UNITS[feature], worst, invariant: !worst || worst.perDeg < tol };
  });
}
