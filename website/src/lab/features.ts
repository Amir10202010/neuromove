// Movement features of each velocity-defined movement, at the device rate (100 Hz).
//
// Each feature declares its provenance and validity condition (research/measurement-model.md §6). Smoothness is
// computed from the GYROSCOPE angular speed (SPARC), not from accelerometer jerk: accelerometer-based jerk metrics
// are contaminated by gravity and orientation changes (Melendez-Calderon et al. 2021, doi:10.3389/fbioe.2020.558771).

import { sparc } from '../core/sparc';
import { meanOf } from './numeric';
import type { MovementEvent } from './events';
import type { SensorSignals } from './signals';

export type Provenance = 'measured' | 'derived' | 'estimated' | 'predicted' | 'hypothetical';

export interface FeatureDef {
  id: FeatureId;
  unit: string;
  provenance: Provenance;
  definition: string;
  validWhen: string;
}

export type FeatureId =
  | 'duration'
  | 'peak_speed'
  | 'mean_speed'
  | 'time_to_peak_fraction'
  | 'speed_peaks'
  | 'sparc'
  | 'inclination_change'
  | 'trunk_tilt'
  | 'trunk_ratio'
  | 'trunk_arm_correlation'
  | 'trunk_lag';

export const FEATURES: Record<FeatureId, FeatureDef> = {
  duration: { id: 'duration', unit: 's', provenance: 'derived', definition: 'offset − onset of the velocity-defined movement', validWhen: 'movement complete (not touching a gap or the recording edge)' },
  peak_speed: { id: 'peak_speed', unit: '°/s', provenance: 'derived', definition: 'max of 6 Hz low-passed |ω| within the movement', validWhen: 'no gyroscope saturation (±1000 °/s) in the movement' },
  mean_speed: { id: 'mean_speed', unit: '°/s', provenance: 'derived', definition: 'mean low-passed |ω| within the movement', validWhen: 'as peak_speed' },
  time_to_peak_fraction: { id: 'time_to_peak_fraction', unit: '', provenance: 'derived', definition: '(t_peak − onset) / duration', validWhen: 'movement complete' },
  speed_peaks: {
    id: 'speed_peaks',
    unit: '',
    provenance: 'derived',
    definition: 'local maxima of low-passed |ω| with prominence ≥ 10 % of the movement peak (submovement count, Rohrer et al. 2002)',
    validWhen: 'movement complete; sensitive to the low-pass cut-off',
  },
  sparc: { id: 'sparc', unit: '', provenance: 'derived', definition: 'spectral arc length of |ω| (fc 10 Hz, threshold 0.05; Balasubramanian et al. 2015); closer to 0 = smoother', validWhen: 'movement complete, ≥ 8 samples' },
  inclination_change: { id: 'inclination_change', unit: '°', provenance: 'derived', definition: 'segment inclination at offset − at onset (gravity-referenced, complementary filter)', validWhen: 'segment not accelerating strongly at onset/offset; heading not observable' },
  trunk_tilt: { id: 'trunk_tilt', unit: '°', provenance: 'derived', definition: 'max trunk tilt from its first still orientation within the movement', validWhen: 'trunk sensor present and a still period at the start' },
  trunk_ratio: { id: 'trunk_ratio', unit: '', provenance: 'derived', definition: 'max trunk tilt / |inclination change| of the arm segment', validWhen: 'arm inclination change ≥ 20°' },
  trunk_arm_correlation: { id: 'trunk_arm_correlation', unit: '', provenance: 'derived', definition: 'Pearson r between trunk tilt and arm inclination within the movement', validWhen: '≥ 20 samples; describes co-variation, not causation' },
  trunk_lag: { id: 'trunk_lag', unit: 's', provenance: 'derived', definition: 'lag (±0.5 s) maximising the cross-correlation of trunk tilt rate and arm inclination rate; > 0: trunk after arm', validWhen: '≥ 50 samples and correlation peak ≥ 0.5' },
};

export interface MovementFeatures {
  event: MovementEvent;
  values: Partial<Record<FeatureId, number>>;
  /** Features not computed for this movement and why. */
  missing: Partial<Record<FeatureId, string>>;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = meanOf(a.slice(0, n));
  const mb = meanOf(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

export function speedPeaks(sp: readonly number[], prominenceFrac = 0.1): number {
  const peak = Math.max(...sp);
  if (!(peak > 0)) return 0;
  const thr = prominenceFrac * peak;
  let count = 0;
  let lastMin = sp[0] as number;
  let rising = true;
  let localMax = sp[0] as number;
  for (let i = 1; i < sp.length; i++) {
    const v = sp[i] as number;
    if (rising) {
      if (v > localMax) localMax = v;
      else if (localMax - v >= thr && localMax - lastMin >= thr) {
        count += 1;
        rising = false;
        lastMin = v;
      }
    } else {
      if (v < lastMin) lastMin = v;
      else if (v - lastMin >= thr) {
        rising = true;
        localMax = v;
      }
    }
  }
  // a final peak that rises but has no following drop of the threshold (movement ends at its offset)
  if (rising && localMax - lastMin >= thr) count += 1;
  return Math.max(1, count);
}

export function movementFeatures(event: MovementEvent, arm: SensorSignals, speedFiltered: readonly number[], rateHz: number, trunk: SensorSignals | null): MovementFeatures {
  const values: MovementFeatures['values'] = {};
  const missing: MovementFeatures['missing'] = {};
  const s = event.iOnset;
  const e = event.iOffset;
  const sp = speedFiltered.slice(s, e + 1);
  const dur = event.offset - event.onset;
  const sat = arm.saturated.slice(s, e + 1).some(Boolean);
  const complete = !event.incomplete;
  if (complete) values.duration = dur;
  else missing.duration = 'incomplete';
  if (!sat) {
    values.peak_speed = event.peakSpeed;
    values.mean_speed = meanOf(sp);
  } else {
    missing.peak_speed = 'saturated';
    missing.mean_speed = 'saturated';
  }
  if (complete && dur > 0) values.time_to_peak_fraction = (event.peak - event.onset) / dur;
  if (complete) values.speed_peaks = speedPeaks(sp);
  else missing.speed_peaks = 'incomplete';
  const raw = arm.speed.slice(s, e + 1);
  if (complete && raw.length >= 8) {
    const v = sparc(raw, rateHz);
    if (Number.isFinite(v)) values.sparc = v;
    else missing.sparc = 'not_computable';
  } else missing.sparc = complete ? 'too_short' : 'incomplete';
  const dElev = (arm.elevation[e] as number) - (arm.elevation[s] as number);
  values.inclination_change = dElev;
  if (trunk) {
    // align trunk samples to the arm's time window (same frames → same timestamps)
    const t0 = event.onset;
    const t1 = event.offset;
    const ti: number[] = [];
    const tt: number[] = [];
    for (let i = 0; i < trunk.t.length; i++) {
      const t = trunk.t[i] as number;
      if (t >= t0 && t <= t1 && Number.isFinite(trunk.tiltFromStart[i] as number)) {
        ti.push(i);
        tt.push(trunk.tiltFromStart[i] as number);
      }
    }
    if (tt.length) {
      const maxTilt = Math.max(...tt);
      values.trunk_tilt = maxTilt;
      if (Math.abs(dElev) >= 20) values.trunk_ratio = maxTilt / Math.abs(dElev);
      else missing.trunk_ratio = 'arm_change_below_20';
      const armOnTrunkT = ti.map((i) => {
        const t = trunk.t[i] as number;
        // nearest arm sample at the same time (same frame in practice)
        let k = s;
        while (k < e && (arm.t[k] as number) < t) k += 1;
        return arm.elevation[k] as number;
      });
      if (tt.length >= 20) {
        const r = pearson(tt, armOnTrunkT);
        if (Number.isFinite(r)) values.trunk_arm_correlation = r;
      } else missing.trunk_arm_correlation = 'too_few_samples';
      if (tt.length >= 50) {
        const lag = bestLag(diff(tt), diff(armOnTrunkT), Math.round(0.5 * rateHz));
        if (lag && lag.r >= 0.5) values.trunk_lag = lag.k / rateHz;
        else missing.trunk_lag = 'weak_correlation';
      } else missing.trunk_lag = 'too_few_samples';
    } else missing.trunk_tilt = 'no_trunk_reference';
  } else {
    missing.trunk_tilt = 'no_trunk_sensor';
  }
  return { event, values, missing };
}

const diff = (x: readonly number[]) => x.slice(1).map((v, i) => v - (x[i] as number));

/** Lag k (samples) in [−maxLag, maxLag] maximising corr(trunk[i], arm[i − k]); k > 0 → trunk follows arm. */
export function bestLag(trunk: readonly number[], arm: readonly number[], maxLag: number): { k: number; r: number } | null {
  let best: { k: number; r: number } | null = null;
  for (let k = -maxLag; k <= maxLag; k++) {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < trunk.length; i++) {
      const j = i - k;
      if (j < 0 || j >= arm.length) continue;
      a.push(trunk[i] as number);
      b.push(arm[j] as number);
    }
    const r = pearson(a, b);
    if (Number.isFinite(r) && (!best || r > best.r)) best = { k, r };
  }
  return best;
}
