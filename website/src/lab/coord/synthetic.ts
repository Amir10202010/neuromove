// Ground-truth synthetic multi-segment movement generator for MCSE validation.
//
// SYNTHETIC DATA ONLY — every recording it produces is marked `simulated: true`, `source: 'synthetic'`, and its
// participant ids start with "SYN-". Never presented as NeuroMove participant data.
//
// Chain: strategy specification (known joint-angle trajectories, delays, amplitudes)
//        → body kinematics (simulation/kinematics.ts: real rotation matrices, segment lengths)
//        → MPU-6050 model (simulation/imuModel.ts: specific force incl. linear acceleration, gyroscope from
//          rotation increments, noise, bias, 2–5° mount misalignment, int16 quantisation, saturation)
//        → OPTIONAL perturbations applied here: gyroscope bias random walk (drift), extra mount misalignment
//          (calibration error), dropped frames (missing samples), whole-sensor loss.
// So the engine is validated through the same measurement model as the live app, not on clean channel arrays.

import { ACC_LSB_PER_G, GYRO_LSB_PER_DPS, INT16_MAX } from '../../core/imu';
import type { ExerciseId } from '../../core/exercises';
import type { Placement, RawFrame, Side } from '../../devices/types';
import { createRng, type Rng } from '../../lib/random';
import { DEG, apply, rotAxis, type Mat3, type Vec3 } from '../../lib/vec3';
import { bodyKinematics, restingPose, type Pose } from '../../simulation/kinematics';
import { ImuSimulator } from '../../simulation/imuModel';
import type { RecordingMeta } from './channels';

/** A movement strategy: endpoint contributions of each degree of freedom and their relative timing. */
export interface StrategySpec {
  id: string;
  /** Shoulder elevation relative to the trunk at the endpoint, degrees (in the plane of the task). */
  shoulder: number;
  /** Trunk sagittal tilt at the endpoint, degrees (+ forward, − backward/extension). */
  trunkPitch: number;
  /** Trunk lean towards the instrumented arm at the endpoint, degrees. */
  trunkRoll: number;
  /** Elbow flexion at the endpoint, degrees. */
  elbow: number;
  /** Onset delay of the trunk relative to the shoulder, seconds (negative = trunk leads). */
  trunkDelay: number;
  /** Onset delay of the elbow relative to the shoulder, seconds. */
  elbowDelay: number;
  /** Duration of the trunk / elbow components relative to the shoulder's outbound duration. */
  trunkDurScale: number;
  elbowDurScale: number;
}

export interface RepTruth {
  strategy: string;
  /** Seconds from the first frame. */
  onset: number;
  /** Shoulder component reaches its endpoint. */
  endpoint: number;
  /** Return begins. */
  departure: number;
  offset: number;
  /** True scalar outcome: world inclination of the upper arm at the endpoint, degrees. */
  outcome: number;
  amplitudeScale: number;
}

export interface Perturbations {
  /** Multiplies the MPU-6050 noise of every sensor (1 = nominal). */
  noiseFactor?: number;
  /** Gyroscope bias random walk, °/s per √s, applied after the calibration window. */
  biasWalkDpsPerSqrtS?: number;
  /** Additional mount misalignment of every sensor, degrees (random axis). */
  extraMisalignDeg?: number;
  /** Probability that a frame is dropped (independent). */
  dropProbability?: number;
  /** Sensor removed from the whole recording. */
  removeSensor?: Placement | null;
  /**
   * Sensor strapped at a different place on its segment: displacement in metres along the sensor's own axes
   * (X = along the bone). Used by the re-attachment study (lab/measure/placement.ts).
   */
  sensorShiftM?: Partial<Record<Placement, Vec3>>;
  /**
   * The participant does NOT reproduce the calibration posture: during the calibration window the instrumented arm
   * is held this many degrees away from hanging (flexion = forward, abduction = sideways) and the trunk is pitched
   * this much; the posture relaxes to the true resting pose between calibration end (4.0 s) and the first movement.
   */
  calibrationPosture?: { flexion?: number; abduction?: number; trunkPitch?: number };
  /**
   * Fixed seed of the sensor set (mount misalignment, gyroscope and accelerometer bias). By default every session
   * draws a new mount (sensors re-attached); the same value in several sessions keeps the SAME mount, so that a
   * within-mount comparison is possible.
   */
  mountSeed?: number;
  /** Independent per-sample sensor noise for the same mount (requires nothing else); default: one generator for both. */
  noiseSeed?: number;
}

export interface SynthSessionSpec {
  participantId: string;
  sessionIndex: number;
  exercise: Extract<ExerciseId, 'shoulder_flexion' | 'shoulder_abduction'>;
  side: Side;
  /** Strategy of each repetition, in order. */
  sequence: StrategySpec[];
  /** Outbound duration of the shoulder component, seconds (mean, CV). */
  duration: { mean: number; cv: number };
  /** Repetition-to-repetition amplitude variability (CV of a common scale factor). */
  amplitudeCv: number;
  /** Independent per-DOF jitter of the endpoint, degrees SD. */
  jitterDeg: number;
  /** Independent per-DOF onset-delay jitter, seconds SD. */
  delayJitterSec: number;
  seed: number;
  perturb?: Perturbations;
  rateHz?: number;
  startedAt?: string;
}

export interface SynthRecording {
  frames: RawFrame[];
  meta: RecordingMeta;
  truth: RepTruth[];
  /** Ground-truth pose at every frame (index-aligned with `frames` before drops: use poseAt). */
  poseAt: (t: number) => Pose;
}

/** Minimum-jerk position profile (Flash & Hogan 1985), 0 → 1 on τ ∈ [0, 1]. */
export function minJerk(tau: number): number {
  if (tau <= 0) return 0;
  if (tau >= 1) return 1;
  return tau * tau * tau * (10 - 15 * tau + 6 * tau * tau);
}

interface RepPlan {
  spec: StrategySpec;
  onset: number;
  dur: number;
  hold: number;
  retDur: number;
  scale: number;
  dShoulder: number;
  dTrunkP: number;
  dTrunkR: number;
  dElbow: number;
  trunkDelay: number;
  elbowDelay: number;
}

/** Value of one DOF at time t for a rep (outbound from its onset over dur, hold, return mirrored). */
function dof(t: number, start: number, dur: number, endOut: number, retStart: number, retDur: number, peak: number): number {
  if (t < start) return 0;
  if (t < retStart) return peak * minJerk((t - start) / dur);
  // return phase: from the value reached at retStart back to 0
  const atRet = peak * minJerk((retStart - start) / dur);
  return atRet * (1 - minJerk((t - retStart) / retDur));
  void endOut;
}

export function generateSession(spec: SynthSessionSpec): SynthRecording {
  const rate = spec.rateHz ?? 100;
  const rng = createRng(spec.seed);
  const plans: RepPlan[] = [];
  let t = 4.5; // 4.5 s still calibration pose at the start (session calibration uses 3 s)
  for (const s of spec.sequence) {
    const dur = Math.max(0.5, spec.duration.mean * (1 + spec.duration.cv * rng.normal()));
    const scale = 1 + spec.amplitudeCv * rng.normal();
    const plan: RepPlan = {
      spec: s,
      onset: t,
      dur,
      hold: 0.25 + 0.2 * rng.next(),
      retDur: dur * (0.9 + 0.2 * rng.next()),
      scale,
      dShoulder: spec.jitterDeg * rng.normal(),
      dTrunkP: spec.jitterDeg * 0.5 * rng.normal(),
      dTrunkR: spec.jitterDeg * 0.5 * rng.normal(),
      dElbow: spec.jitterDeg * rng.normal(),
      trunkDelay: s.trunkDelay + spec.delayJitterSec * rng.normal(),
      elbowDelay: s.elbowDelay + spec.delayJitterSec * rng.normal(),
    };
    plans.push(plan);
    const trunkEnd = plan.trunkDelay + plan.dur * s.trunkDurScale;
    const elbowEnd = plan.elbowDelay + plan.dur * s.elbowDurScale;
    const outEnd = Math.max(plan.dur, trunkEnd, elbowEnd);
    t += outEnd + plan.hold + plan.retDur * Math.max(1, s.trunkDurScale, s.elbowDurScale) + 1.6 + 0.8 * rng.next();
  }
  const total = t + 1.5;
  const flex = spec.exercise === 'shoulder_flexion';

  const cp = spec.perturb?.calibrationPosture;
  const poseAt = (time: number): Pose => {
    const pose = restingPose();
    if (cp && time < 4.45) {
      // held during calibration (which ends at 4.0 s), relaxed by a minimum-jerk transition before the first movement
      const w = time <= 4 ? 1 : 1 - minJerk((time - 4) / 0.45);
      const arm = spec.side === 'right' ? pose.right : pose.left;
      arm.flexion += w * (cp.flexion ?? 0);
      arm.abduction += w * (cp.abduction ?? 0);
      pose.trunkPitch += w * (cp.trunkPitch ?? 0);
    }
    for (const p of plans) {
      const s = p.spec;
      const outEnd = Math.max(p.dur, p.trunkDelay + p.dur * s.trunkDurScale, p.elbowDelay + p.dur * s.elbowDurScale);
      const retStart = p.onset + Math.max(0, outEnd) + p.hold;
      const end = retStart + p.retDur * Math.max(1, s.trunkDurScale, s.elbowDurScale) + 0.05;
      const startMin = p.onset + Math.min(0, p.trunkDelay, p.elbowDelay);
      if (time < startMin || time > end + 0.5) continue;
      const sh = dof(time, p.onset, p.dur, 0, retStart, p.retDur, p.scale * s.shoulder + p.dShoulder);
      const tp = dof(time, p.onset + p.trunkDelay, p.dur * s.trunkDurScale, 0, retStart, p.retDur * s.trunkDurScale, p.scale * s.trunkPitch + p.dTrunkP);
      const tr = dof(time, p.onset + p.trunkDelay, p.dur * s.trunkDurScale, 0, retStart, p.retDur * s.trunkDurScale, p.scale * s.trunkRoll + p.dTrunkR);
      const el = dof(time, p.onset + p.elbowDelay, p.dur * s.elbowDurScale, 0, retStart, p.retDur * s.elbowDurScale, p.scale * s.elbow + p.dElbow);
      const arm = spec.side === 'right' ? pose.right : pose.left;
      if (flex) arm.flexion += sh;
      else arm.abduction += sh;
      arm.elbow += Math.max(0, el);
      pose.trunkPitch += tp;
      // kinematics: trunkRoll + = lean LEFT; "towards the instrumented arm" for the right arm = negative
      pose.trunkRoll += spec.side === 'right' ? -tr : tr;
    }
    return pose;
  };

  // ── sensors ──
  const placements: Placement[] = ['trunk', spec.side === 'right' ? 'upper_r' : 'upper_l', spec.side === 'right' ? 'fore_r' : 'fore_l'];
  const pr = spec.perturb ?? {};
  const imu = new ImuSimulator(pr.mountSeed !== undefined ? pr.mountSeed : spec.seed ^ 0x9e3779b9, rate, pr.noiseSeed);
  if (pr.sensorShiftM) for (const p of placements) imu.setPositionShift(p, pr.sensorShiftM[p] ?? null);
  if (pr.noiseFactor && pr.noiseFactor !== 1) for (const p of placements) imu.setNoiseFactor(p, pr.noiseFactor);
  const extra: Partial<Record<Placement, Mat3>> = {};
  if (pr.extraMisalignDeg) for (const p of placements) extra[p] = rotAxis([rng.normal(), rng.normal(), rng.normal()], pr.extraMisalignDeg * DEG);
  const walk: Partial<Record<Placement, Vec3>> = {};
  for (const p of placements) walk[p] = [0, 0, 0];
  const frames: RawFrame[] = [];
  const nFrames = Math.round(total * rate);
  for (let seq = 0; seq < nFrames; seq++) {
    const time = seq / rate;
    const f = imu.frame(poseAt(time), seq, placements);
    for (const p of placements) {
      const raw = f.data[p] as Int16Array;
      const R = extra[p];
      let acc: Vec3 = [(raw[0] as number) / ACC_LSB_PER_G, (raw[1] as number) / ACC_LSB_PER_G, (raw[2] as number) / ACC_LSB_PER_G];
      let gyr: Vec3 = [(raw[3] as number) / GYRO_LSB_PER_DPS, (raw[4] as number) / GYRO_LSB_PER_DPS, (raw[5] as number) / GYRO_LSB_PER_DPS];
      if (R) {
        acc = apply(R, acc);
        gyr = apply(R, gyr);
      }
      if (pr.biasWalkDpsPerSqrtS && time > 4) {
        const w = walk[p] as Vec3;
        const sd = pr.biasWalkDpsPerSqrtS * Math.sqrt(1 / rate);
        for (let k = 0; k < 3; k++) w[k] = (w[k] as number) + sd * rng.normal();
        gyr = [gyr[0] + w[0], gyr[1] + w[1], gyr[2] + w[2]];
      }
      if (R || pr.biasWalkDpsPerSqrtS) {
        const q = (v: number) => Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, Math.round(v)));
        f.data[p] = Int16Array.from([q(acc[0] * ACC_LSB_PER_G), q(acc[1] * ACC_LSB_PER_G), q(acc[2] * ACC_LSB_PER_G), q(gyr[0] * GYRO_LSB_PER_DPS), q(gyr[1] * GYRO_LSB_PER_DPS), q(gyr[2] * GYRO_LSB_PER_DPS)]);
      }
    }
    if (pr.removeSensor) delete f.data[pr.removeSensor];
    if (pr.dropProbability && time > 4 && rng.chance(pr.dropProbability)) continue;
    frames.push(f);
  }

  const truth: RepTruth[] = plans.map((p) => {
    const s = p.spec;
    const outEnd = Math.max(p.dur, p.trunkDelay + p.dur * s.trunkDurScale, p.elbowDelay + p.dur * s.elbowDurScale);
    const departure = p.onset + outEnd + p.hold;
    const endTime = p.onset + p.dur;
    const ps = poseAt(Math.min(departure, p.onset + outEnd));
    return {
      strategy: s.id,
      onset: p.onset + Math.min(0, p.trunkDelay, p.elbowDelay),
      endpoint: endTime,
      departure,
      offset: departure + p.retDur * Math.max(1, s.trunkDurScale, s.elbowDurScale),
      outcome: worldArmInclination(ps, spec.side),
      amplitudeScale: p.scale,
    };
  });
  const meta: RecordingMeta = {
    id: `syn-${spec.participantId}-${spec.sessionIndex}`,
    participantId: spec.participantId,
    startedAt: spec.startedAt ?? new Date(Date.UTC(2026, 0, 1 + 7 * spec.sessionIndex)).toISOString(),
    rateHz: rate,
    side: spec.side,
    steps: [{ exercise: spec.exercise, side: spec.side, tStart: 4, tEnd: total }],
    calibrationEnd: 4,
    source: 'synthetic',
    simulated: true,
  };
  return { frames, meta, truth, poseAt };
}

/** World inclination of the upper arm from hanging, degrees — ground truth of upper_elev: sensor X lies along the bone. */
export function worldArmInclination(pose: Pose, side: Side): number {
  const R = bodyKinematics(pose)[side === 'right' ? 'upper_r' : 'upper_l'].R;
  const bone = apply(R, [1, 0, 0]);
  return Math.acos(Math.max(-1, Math.min(1, -bone[2]))) / DEG;
}

/** Angle between the upper-arm and trunk long axes, degrees — ground truth of the humerothoracic channel. */
export function trueHumerothoracic(pose: Pose, side: Side): number {
  const k = bodyKinematics(pose);
  const a = apply(k[side === 'right' ? 'upper_r' : 'upper_l'].R, [1, 0, 0]);
  const b = apply(k.trunk.R, [1, 0, 0]);
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;
}

/** Convenience: strategy library used by the validation suite. */
export const STRATEGIES = {
  /** Arm-dominant: shoulder to the target, trunk upright. */
  armDominant: { id: 'arm', shoulder: 120, trunkPitch: 0, trunkRoll: 0, elbow: 5, trunkDelay: 0, elbowDelay: 0, trunkDurScale: 1, elbowDurScale: 1 } satisfies StrategySpec,
  /**
   * Trunk-assisted: less shoulder elevation relative to the trunk, trunk EXTENSION (leaning back) — the same world
   * arm inclination (≈ 120°): a backward lean of the trunk raises the arm in the world (COORDINATES.md §4).
   */
  trunkAssisted: { id: 'trunk', shoulder: 102, trunkPitch: -18, trunkRoll: 0, elbow: 5, trunkDelay: 0.1, elbowDelay: 0, trunkDurScale: 1, elbowDurScale: 1 } satisfies StrategySpec,
  /** Same joint contributions as trunkAssisted but the trunk LEADS the arm (timing strategy). */
  trunkLeading: { id: 'trunk_lead', shoulder: 102, trunkPitch: -18, trunkRoll: 0, elbow: 5, trunkDelay: -0.35, elbowDelay: 0, trunkDurScale: 0.8, elbowDurScale: 1 } satisfies StrategySpec,
  /** Bent-elbow reach. */
  elbowFlexed: { id: 'elbow', shoulder: 120, trunkPitch: 0, trunkRoll: 0, elbow: 45, trunkDelay: 0, elbowDelay: 0.15, trunkDurScale: 1, elbowDurScale: 0.9 } satisfies StrategySpec,
};

export function withRng(seed: number): Rng {
  return createRng(seed);
}
