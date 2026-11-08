// Raw IMU frames → calibrated, observability-checked multi-segment kinematic channels at the device rate.
//
// This is MCSE stage 1–3 (research/coordination-feasibility.md): quality control (reused: lab/quality.ts),
// calibrated sensor representation (reused: core/imu.ts toPhysical with the module's accelerometer calibration,
// gyroscope bias from the session's still calibration pose), segment inclination (reused: GravityTracker), elbow
// hinge angle (reused: core/pipeline.ts elbowFlexion) and ONE new estimated relative-orientation channel
// (humerothoracic elevation, quat.ts), which is valid only inside repetitions.
//
// Nothing is interpolated or back-filled: a sample that a sensor did not deliver is NaN in every channel that needs
// that sensor.

import { toPhysical, type AccCalibration } from '../../core/imu';
import { GravityTracker, angleBetween } from '../../core/orientation';
import { elbowFlexion, newElbowTrack } from '../../core/pipeline';
import type { Placement, RawFrame, Side } from '../../devices/types';
import { placementOf } from '../../devices/types';
import { cross, dot, normalize, scale, sub, type Vec3 } from '../../lib/vec3';
import { assessRecording, type RecordingQC } from '../quality';
import { findStill } from '../signals';
import { headingOf, madgwickSeries, qFromAxisAngle, qMul, qRotate, type Quat } from './quat';

export const CHANNEL_IDS = [
  'trunk_pitch',
  'trunk_roll',
  'upper_elev',
  'fore_elev',
  'elbow_flex',
  'humerothoracic',
  'trunk_rate',
  'upper_rate',
  'fore_rate',
  'upper_axial_rate',
  'fore_axial_rate',
] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export type Observability = 'observable' | 'measured' | 'estimated';

export interface ChannelDef {
  id: ChannelId;
  unit: '°' | '°/s';
  kind: 'angle' | 'rate';
  /** Sensor roles the channel needs. */
  needs: ('trunk' | 'upper' | 'fore')[];
  observability: Observability;
  definition: string;
  assumptions: string;
}

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  trunk_pitch: { id: 'trunk_pitch', unit: '°', kind: 'angle', needs: ['trunk'], observability: 'observable', definition: 'signed trunk tilt in the sagittal plane from the calibration pose; + = forward', assumptions: 'trunk sensor Z points forward in the calibration pose (mount rule); accuracy limited by strap misalignment (2–5°)' },
  trunk_roll: { id: 'trunk_roll', unit: '°', kind: 'angle', needs: ['trunk'], observability: 'observable', definition: 'signed trunk tilt in the frontal plane from the calibration pose; + = towards the instrumented arm', assumptions: 'as trunk_pitch' },
  upper_elev: { id: 'upper_elev', unit: '°', kind: 'angle', needs: ['upper'], observability: 'observable', definition: 'angle of the upper-arm sensor “up” from its calibration-pose direction = upper-arm inclination from hanging (the clinical ROM angle of the shoulder tests)', assumptions: 'gravity reference; independent of strap rotation about the bone; relative to vertical, not to the trunk' },
  fore_elev: { id: 'fore_elev', unit: '°', kind: 'angle', needs: ['fore'], observability: 'observable', definition: 'forearm inclination from its calibration-pose direction', assumptions: 'as upper_elev' },
  elbow_flex: { id: 'elbow_flex', unit: '°', kind: 'angle', needs: ['upper', 'fore'], observability: 'observable', definition: 'elbow flexion in the hinge plane (existing core/pipeline.ts elbowFlexion)', assumptions: 'elbow is a hinge whose axis is the upper-arm sensor Z; undefined when the hinge axis is near vertical (FINDINGS F3/F4)' },
  humerothoracic: { id: 'humerothoracic', unit: '°', kind: 'angle', needs: ['trunk', 'upper'], observability: 'estimated', definition: 'angle between the upper-arm and trunk long axes (arm elevation relative to the trunk)', assumptions: 'relative heading from 6-axis orientation integration (Madgwick IMU), aligned by the mount rule at calibration; heading drifts with residual gyroscope bias — valid only inside a repetition, drift diagnostic reported' },
  trunk_rate: { id: 'trunk_rate', unit: '°/s', kind: 'rate', needs: ['trunk'], observability: 'measured', definition: '|ω| of the trunk sensor, bias removed', assumptions: 'none beyond calibration' },
  upper_rate: { id: 'upper_rate', unit: '°/s', kind: 'rate', needs: ['upper'], observability: 'measured', definition: '|ω| of the upper-arm sensor, bias removed', assumptions: 'none beyond calibration' },
  fore_rate: { id: 'fore_rate', unit: '°/s', kind: 'rate', needs: ['fore'], observability: 'measured', definition: '|ω| of the forearm sensor, bias removed', assumptions: 'none beyond calibration' },
  upper_axial_rate: { id: 'upper_axial_rate', unit: '°/s', kind: 'rate', needs: ['upper'], observability: 'observable', definition: 'angular rate about the upper-arm long axis (bone axis = calibration gravity); mirrored for the left arm so the sign means the same rotation', assumptions: 'bone axis known from the calibration pose' },
  fore_axial_rate: { id: 'fore_axial_rate', unit: '°/s', kind: 'rate', needs: ['fore'], observability: 'observable', definition: 'angular rate about the forearm long axis (pronation/supination rate), mirrored for the left arm', assumptions: 'as upper_axial_rate' },
};

export interface RecordingMeta {
  id: string;
  participantId: string;
  /** ISO time of the recording start. */
  startedAt: string;
  rateHz: number;
  side: Side;
  accCal?: Partial<Record<Placement, AccCalibration>>;
  /** Exercise steps, seconds from the first frame. */
  steps: { exercise: string; side: Side; tStart: number; tEnd: number }[];
  /** Calibration window end (seconds from the first frame), from the session events, when known. */
  calibrationEnd: number | null;
  source: 'session' | 'practice' | 'file' | 'synthetic';
  simulated: boolean;
}

export interface CalibrationInfo {
  source: 'session_calibration' | 'first_still_period' | 'none';
  /** Sample indices of the calibration window. */
  start: number;
  end: number;
  biasDps: Partial<Record<Placement, Vec3>>;
  up: Partial<Record<Placement, Vec3>>;
}

export interface DriftDiagnostic {
  /** Gyroscope bias change between the calibration window and the last still period, °/s, per sensor. */
  residualBiasDps: Partial<Record<Placement, number>>;
  /** Upper bound of relative heading drift trunk↔upper arm implied by residual bias, °/s. */
  relativeHeadingDriftDps: number | null;
  /** Orientation-filter restarts after data gaps (heading lost). */
  restarts: number;
}

export interface ChannelSet {
  meta: RecordingMeta;
  t: number[];
  channels: Partial<Record<ChannelId, number[]>>;
  /** Channels the sensors of this recording cannot provide, and why. */
  unavailable: Partial<Record<ChannelId, string>>;
  calibration: CalibrationInfo;
  drift: DriftDiagnostic;
  qc: RecordingQC;
  placements: { trunk: Placement | null; upper: Placement | null; fore: Placement | null };
  /** Samples where elbow flexion was not observable (hinge axis within 30° of vertical). */
  elbowUnobservableSamples: number;
}

/** Forward direction of each sensor in its own frame, calibration pose (COORDINATES.md §2). */
function forwardAxis(role: 'trunk' | 'upper' | 'fore', side: Side): Vec3 {
  if (role === 'trunk') return [0, 0, 1];
  return side === 'right' ? [0, 1, 0] : [0, -1, 0];
}

/** Unit vector of `v` orthogonal to `n` (Gram–Schmidt); null when nearly parallel. */
function orthoUnit(v: Vec3, n: Vec3): Vec3 | null {
  const o = sub(v, scale(n, dot(v, n)));
  const m = Math.hypot(o[0], o[1], o[2]);
  return m < 0.3 ? null : scale(o, 1 / m);
}


export function buildChannels(frames: readonly RawFrame[], meta: RecordingMeta): ChannelSet {
  const n = frames.length;
  const t0 = n ? (frames[0] as RawFrame).t : 0;
  const t = frames.map((f) => f.t - t0);
  const present = new Set(frames.flatMap((f) => Object.keys(f.data) as Placement[]));
  const pl = {
    trunk: present.has('trunk') ? ('trunk' as Placement) : null,
    upper: present.has(placementOf('upper', meta.side)) ? placementOf('upper', meta.side) : null,
    fore: present.has(placementOf('fore', meta.side)) ? placementOf('fore', meta.side) : null,
  };
  const qc = assessRecording(frames, meta.rateHz);
  const roles = (['trunk', 'upper', 'fore'] as const).filter((r) => pl[r]);

  // ── physical units without bias, to locate the calibration window ──
  const physRaw: Partial<Record<Placement, { acc: Vec3[]; gyro: Vec3[]; ok: boolean[]; sat: boolean[] }>> = {};
  for (const r of roles) {
    const p = pl[r] as Placement;
    const acc: Vec3[] = [];
    const gyro: Vec3[] = [];
    const ok: boolean[] = [];
    const sat: boolean[] = [];
    for (const f of frames) {
      const raw = f.data[p];
      if (!raw) {
        acc.push([NaN, NaN, NaN]);
        gyro.push([NaN, NaN, NaN]);
        ok.push(false);
        sat.push(false);
        continue;
      }
      const s = toPhysical(raw, [0, 0, 0], meta.accCal?.[p]);
      acc.push(s.acc);
      gyro.push(s.gyro);
      ok.push(true);
      sat.push(s.saturated);
    }
    physRaw[p] = { acc, gyro, ok, sat };
  }

  // ── calibration window: the session's own (3 s before calibration_done) or the first 3 s still period ──
  const rate = meta.rateHz;
  let cal: CalibrationInfo = { source: 'none', start: 0, end: 0, biasDps: {}, up: {} };
  const ref = pl.upper ?? pl.fore ?? pl.trunk;
  if (ref && physRaw[ref]) {
    let win: { start: number; end: number } | null = null;
    let source: CalibrationInfo['source'] = 'none';
    if (meta.calibrationEnd !== null) {
      const end = t.findIndex((x) => x >= (meta.calibrationEnd as number));
      const e = end < 0 ? n : end;
      const s = Math.max(0, e - Math.round(3 * rate));
      if (e - s >= rate) {
        win = { start: s, end: e };
        source = 'session_calibration';
      }
    }
    if (!win) {
      const still = findStill(physRaw[ref].gyro, physRaw[ref].acc, rate, 3);
      if (still) {
        win = still;
        source = 'first_still_period';
      }
    }
    if (win) {
      cal = { source, start: win.start, end: win.end, biasDps: {}, up: {} };
      for (const r of roles) {
        const p = pl[r] as Placement;
        const ph = physRaw[p];
        if (!ph) continue;
        const b: Vec3 = [0, 0, 0];
        const a: Vec3 = [0, 0, 0];
        let k = 0;
        for (let i = win.start; i < win.end; i++) {
          if (!ph.ok[i]) continue;
          for (let j = 0; j < 3; j++) {
            b[j] = (b[j] as number) + ((ph.gyro[i] as Vec3)[j] as number);
            a[j] = (a[j] as number) + ((ph.acc[i] as Vec3)[j] as number);
          }
          k++;
        }
        if (k < rate / 2) continue;
        cal.biasDps[p] = scale(b, 1 / k);
        cal.up[p] = normalize(a);
      }
    }
  }

  const channels: Partial<Record<ChannelId, number[]>> = {};
  const unavailable: Partial<Record<ChannelId, string>> = {};
  const sideSign = meta.side === 'right' ? 1 : -1;
  const ups: Partial<Record<Placement, Vec3[]>> = {};
  const gyros: Partial<Record<Placement, Vec3[]>> = {};

  for (const r of roles) {
    const p = pl[r] as Placement;
    const ph = physRaw[p];
    const up0 = cal.up[p];
    const bias = cal.biasDps[p];
    if (!ph || !up0 || !bias) continue;
    const gyro = ph.gyro.map((g) => [g[0] - bias[0], g[1] - bias[1], g[2] - bias[2]] as Vec3);
    gyros[p] = gyro;
    const tr = new GravityTracker();
    const up: Vec3[] = [];
    let prevT: number | null = null;
    for (let i = 0; i < n; i++) {
      if (!ph.ok[i]) {
        up.push([NaN, NaN, NaN]);
        continue;
      }
      let dt = prevT === null ? 1 / rate : (t[i] as number) - prevT;
      if (dt > 0.5 || dt <= 0) {
        tr.reset();
        dt = 1 / rate;
      }
      // seed from the calibration direction at the start of the calibration window, as the live pipeline does
      if (i === cal.start) {
        tr.reset();
        tr.update(up0, [0, 0, 0], 0);
      }
      up.push(tr.update(ph.acc[i] as Vec3, gyro[i] as Vec3, dt));
      prevT = t[i] as number;
    }
    ups[p] = up;
    const elev = up.map((u, i) => (ph.ok[i] && i >= cal.start ? angleBetween(u, up0) : NaN));
    const rateC = gyro.map((g, i) => (ph.ok[i] ? Math.hypot(g[0], g[1], g[2]) : NaN));
    const bone = scale(up0, -1); // long axis, pointing distally (down in the calibration pose)
    if (r === 'trunk') {
      const f = orthoUnit(forwardAxis('trunk', meta.side), up0);
      if (f) {
        const left = cross(up0, f);
        // towards the instrumented arm: right arm → right = −left
        const lat = scale(left, -sideSign);
        channels.trunk_pitch = up.map((u, i) => (ph.ok[i] && i >= cal.start ? Math.atan2(-dot(u, f), dot(u, up0)) / (Math.PI / 180) : NaN));
        channels.trunk_roll = up.map((u, i) => (ph.ok[i] && i >= cal.start ? Math.atan2(-dot(u, lat), dot(u, up0)) / (Math.PI / 180) : NaN));
      } else {
        unavailable.trunk_pitch = 'trunk sensor forward axis parallel to gravity in the calibration pose (mount rule not met)';
        unavailable.trunk_roll = unavailable.trunk_pitch;
      }
      channels.trunk_rate = rateC;
    } else if (r === 'upper') {
      channels.upper_elev = elev;
      channels.upper_rate = rateC;
      channels.upper_axial_rate = gyro.map((g, i) => (ph.ok[i] ? sideSign * dot(g, bone) : NaN));
    } else {
      channels.fore_elev = elev;
      channels.fore_rate = rateC;
      channels.fore_axial_rate = gyro.map((g, i) => (ph.ok[i] ? sideSign * dot(g, bone) : NaN));
    }
    if (ph.sat.some(Boolean)) {
      // saturated samples are invalid in every channel of that sensor
      for (const id of CHANNEL_IDS) {
        const c = channels[id];
        if (!c || !CHANNELS[id].needs.includes(r)) continue;
        ph.sat.forEach((s, i) => {
          if (s) c[i] = NaN;
        });
      }
    }
  }

  // elbow hinge angle (existing algorithm, with its branch memory)
  let elbowDegenerateSamples = 0;
  if (pl.upper && pl.fore && ups[pl.upper] && ups[pl.fore] && cal.up[pl.upper]) {
    const uU = ups[pl.upper] as Vec3[];
    const fe = channels.fore_elev as number[];
    const ue = channels.upper_elev as number[];
    const fg = gyros[pl.fore] as Vec3[];
    const calU = cal.up[pl.upper] as Vec3;
    const track = newElbowTrack();
    // Hinge axis in the upper-arm sensor frame (Z, signed by side, orthogonal to the bone — as elbowFlexion builds it)
    const hinge = orthoUnit([0, 0, sideSign], scale(calU, -1));
    let degenerate = 0;
    channels.elbow_flex = t.map((ti, i) => {
      const a = fe[i] as number;
      const b = ue[i] as number;
      if (!Number.isFinite(a) || !Number.isFinite(b) || !hinge) return NaN;
      // Observability: the hinge plane must not be near horizontal. When the hinge axis is within 30° of vertical
      // (e.g. arm abducted towards 90°), gravity carries no elbow information and the existing code falls back to an
      // approximation that is wrong outside the sagittal plane (FINDINGS F3) — such samples are NaN, not estimates.
      const down = scale(uU[i] as Vec3, -1);
      const along = dot(down, hinge);
      if (Math.sqrt(Math.max(0, 1 - along * along)) < 0.5) {
        degenerate++;
        return NaN;
      }
      const g = fg[i] as Vec3;
      return elbowFlexion(meta.side, uU[i] as Vec3, calU, a, Math.hypot(g[0], g[1], g[2]), a - b, ti, track);
    });
    if (degenerate) elbowDegenerateSamples = degenerate;
  }

  // humerothoracic elevation: full 6-axis orientation of trunk and upper arm, headings aligned at calibration
  let restarts = 0;
  let relDrift: number | null = null;
  if (pl.trunk && pl.upper && cal.up.trunk && cal.up[pl.upper] && cal.end > cal.start) {
    const q: Partial<Record<'trunk' | 'upper', Quat[]>> = {};
    const bones: Partial<Record<'trunk' | 'upper', Vec3>> = {};
    let ok = true;
    for (const r of ['trunk', 'upper'] as const) {
      const p = pl[r] as Placement;
      const ph = physRaw[p];
      const g = gyros[p];
      if (!ph || !g) {
        ok = false;
        break;
      }
      // samples where the sensor is missing break the stream: the filter restarts (heading lost)
      const idx = [...Array(n).keys()].filter((i) => ph.ok[i]);
      const ser = madgwickSeries(idx.map((i) => t[i] as number), idx.map((i) => g[i] as Vec3), idx.map((i) => ph.acc[i] as Vec3), undefined, rate);
      restarts += ser.restarts.length - 1;
      const full: Quat[] = new Array(n).fill([NaN, NaN, NaN, NaN]);
      idx.forEach((i, j) => (full[i] = ser.q[j] as Quat));
      // heading alignment: the sensor's forward axis maps to world +X at the end of calibration
      const upCal = cal.up[p] as Vec3;
      const fwd = orthoUnit(forwardAxis(r, meta.side), upCal);
      const qc0 = full[Math.max(cal.start, cal.end - 1)] as Quat;
      if (!fwd || !Number.isFinite(qc0[0])) {
        ok = false;
        break;
      }
      const psi = headingOf(qRotate(qc0, fwd));
      if (!Number.isFinite(psi)) {
        ok = false;
        break;
      }
      const yaw = qFromAxisAngle([0, 0, 1], -psi);
      q[r] = full.map((x) => (Number.isFinite(x[0]) ? qMul(yaw, x) : x));
      bones[r] = scale(upCal, -1);
    }
    if (ok && q.trunk && q.upper && bones.trunk && bones.upper) {
      const qt = q.trunk;
      const qu = q.upper;
      const bt = bones.trunk;
      const bu = bones.upper;
      channels.humerothoracic = t.map((_, i) => {
        const a = qt[i] as Quat;
        const b = qu[i] as Quat;
        if (!Number.isFinite(a[0]) || !Number.isFinite(b[0]) || i < cal.start) return NaN;
        return angleBetween(qRotate(a, bt), qRotate(b, bu));
      });
    } else unavailable.humerothoracic = 'heading alignment not possible (forward axis parallel to gravity or missing calibration)';
  } else if (!pl.trunk || !pl.upper) unavailable.humerothoracic = 'needs trunk and upper-arm sensors';

  // drift diagnostic: residual gyroscope bias (after the calibration bias is removed) in the LAST strictly still
  // 2 s window after calibration. Strict on purpose — the calibration rule (range < 16 °/s) accepts slow movement,
  // which would be read as bias. Limit of 6-axis sensing: a slow steady rotation about the VERTICAL is invisible to
  // the accelerometer and cannot be told apart from bias; such a window would inflate (never hide) the bound.
  const residual: Partial<Record<Placement, number>> = {};
  const w = Math.round(2 * rate);
  for (const r of roles) {
    const p = pl[r] as Placement;
    const g = gyros[p];
    const ph = physRaw[p];
    if (!g || !ph) continue;
    for (let s = n - w; s >= cal.end; s -= Math.round(rate / 4)) {
      let ok = true;
      const lo: Vec3 = [Infinity, Infinity, Infinity];
      const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (let i = s; i < s + w && ok; i++) {
        if (!ph.ok[i]) ok = false;
        else {
          const gi = g[i] as Vec3;
          for (let j = 0; j < 3; j++) {
            lo[j] = Math.min(lo[j] as number, gi[j] as number);
            hi[j] = Math.max(hi[j] as number, gi[j] as number);
          }
          const a = ph.acc[i] as Vec3;
          if (Math.abs(Math.hypot(a[0], a[1], a[2]) - 1) > 0.05) ok = false;
        }
      }
      if (!ok || [0, 1, 2].some((j) => (hi[j] as number) - (lo[j] as number) > 3)) continue;
      const a0 = normalize(ph.acc[s] as Vec3);
      const a1 = normalize(ph.acc[s + w - 1] as Vec3);
      if (angleBetween(a0, a1) > 0.5 + 0.3) continue; // tilt < ~0.5° (+ accelerometer noise)
      const m: Vec3 = [0, 0, 0];
      for (let i = s; i < s + w; i++) for (let j = 0; j < 3; j++) m[j] = (m[j] as number) + ((g[i] as Vec3)[j] as number) / w;
      residual[p] = Math.hypot(...m);
      break;
    }
  }
  if (pl.trunk && pl.upper && residual.trunk !== undefined && residual[pl.upper] !== undefined) relDrift = (residual.trunk as number) + (residual[pl.upper] as number);

  for (const id of CHANNEL_IDS) {
    if (channels[id] || unavailable[id]) continue;
    const missing = CHANNELS[id].needs.filter((r) => !pl[r]);
    unavailable[id] = missing.length ? `sensor not present: ${missing.join(', ')}` : 'no calibration window found (no 3 s still period)';
  }
  return { meta, t, channels, unavailable, calibration: cal, drift: { residualBiasDps: residual, relativeHeadingDriftDps: relDrift, restarts }, qc, placements: pl, elbowUnobservableSamples: elbowDegenerateSamples };
}
