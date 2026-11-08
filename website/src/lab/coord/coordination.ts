// Per-repetition coordination descriptors and per-strategy signatures.
//
// Descriptors are computed on MEASURED/OBSERVABLE channels of one repetition:
//   excursions          peak signed excursion of each angle channel from its onset value, outbound phase
//   trunkContribution   explicit definition: |trunk tilt excursion in the task plane| / |upper-arm inclination
//                       excursion|, outbound phase. Task plane: sagittal (trunk_pitch) for shoulder flexion,
//                       frontal (trunk_roll) for abduction. An OBSERVED kinematic ratio — not a diagnosis of
//                       compensation.
//   correlations        Pearson r between angle channels over the outbound phase (co-variation, not causation)
//   lagged              lag (±0.3 s) maximising the cross-correlation of trunk and upper-arm angular speed;
//                       resolution 10 ms (100 Hz frames); intra-frame skew between sensors ≈ 2–4 ms, unmeasured
//   onsetLags           segment onset − upper-arm onset, ms (intersegment timing)
// Continuous relative phase (Hilbert or phase-portrait) is NOT computed: it assumes quasi-oscillatory signals,
// and the movements here are discrete, single-cycle repetitions with holds; it is reported as unavailable.

import type { ChannelId, ChannelSet } from './channels';
import type { AlignedRep } from './align';
import { GRID } from './align';
import type { Repetition } from './segment';
import { phaseDurations } from './segment';
import { mean, sd } from './stats';

export interface CoordinationDescriptor {
  excursions: Partial<Record<ChannelId, number>>;
  trunkContribution: number | null;
  correlations: { a: ChannelId; b: ChannelId; r: number }[];
  lagged: { lagMs: number; r: number } | null;
  onsetLags: { trunkMs: number | null; foreMs: number | null };
  phases: ReturnType<typeof phaseDurations>;
  unavailable: { relativePhase: string };
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : NaN;
}

export function describeRepetition(cs: ChannelSet, r: Repetition, aligned: AlignedRep, angleChannels: readonly ChannelId[]): CoordinationDescriptor {
  const half = Math.round(0.45 * (GRID - 1)); // arrival landmark: end of the outbound phase
  const excursions: CoordinationDescriptor['excursions'] = {};
  for (const c of angleChannels) {
    const v = aligned.curves[c];
    if (!v) continue;
    let best = 0;
    for (let k = 0; k <= half; k++) if (Math.abs(v[k] as number) > Math.abs(best)) best = v[k] as number;
    excursions[c] = best;
  }
  const plane: ChannelId = r.exercise === 'shoulder_abduction' ? 'trunk_roll' : 'trunk_pitch';
  const te = excursions[plane];
  const ue = excursions.upper_elev;
  const trunkContribution = te !== undefined && ue !== undefined && Math.abs(ue) >= 20 ? Math.abs(te) / Math.abs(ue) : null;
  const correlations: CoordinationDescriptor['correlations'] = [];
  for (let i = 0; i < angleChannels.length; i++)
    for (let j = i + 1; j < angleChannels.length; j++) {
      const a = aligned.curves[angleChannels[i] as ChannelId];
      const b = aligned.curves[angleChannels[j] as ChannelId];
      if (a && b) correlations.push({ a: angleChannels[i] as ChannelId, b: angleChannels[j] as ChannelId, r: pearson(a.slice(0, half + 1), b.slice(0, half + 1)) });
    }
  // lagged cross-correlation of angular speeds (time domain, original samples, outbound phase)
  let lagged: CoordinationDescriptor['lagged'] = null;
  const tr = cs.channels.trunk_rate;
  const ur = cs.channels.upper_rate;
  if (tr && ur && r.onset) {
    const i0 = r.onset.i;
    const i1 = r.iPeak;
    const maxLag = Math.round(0.3 * cs.meta.rateHz);
    if (i1 - i0 >= 2 * maxLag) {
      let bestR = -Infinity;
      let bestL = 0;
      for (let L = -maxLag; L <= maxLag; L++) {
        const a: number[] = [];
        const b: number[] = [];
        for (let i = i0; i <= i1; i++) {
          const j = i + L;
          if (j < 0 || j >= tr.length) continue;
          a.push(ur[i] as number);
          b.push(tr[j] as number);
        }
        if (a.some((x) => !Number.isFinite(x)) || b.some((x) => !Number.isFinite(x))) continue;
        const rr = pearson(a, b);
        if (rr > bestR) {
          bestR = rr;
          bestL = L;
        }
      }
      if (Number.isFinite(bestR)) lagged = { lagMs: Math.round((bestL * 1000) / cs.meta.rateHz), r: bestR };
    }
  }
  const so = r.segmentOnsets;
  return {
    excursions,
    trunkContribution,
    correlations,
    lagged,
    onsetLags: {
      trunkMs: so.trunk !== null && so.upper !== null ? Math.round((so.trunk - so.upper) * 1000) : null,
      foreMs: so.fore !== null && so.upper !== null ? Math.round((so.fore - so.upper) * 1000) : null,
    },
    phases: phaseDurations(r),
    unavailable: { relativePhase: 'discrete single-cycle movements with holds: continuous relative phase assumes quasi-oscillatory signals' },
  };
}

export interface StrategySignature {
  label: string;
  n: number;
  meanPosterior: number;
  /** Mean ± SD phase-normalised excursion curve per channel. */
  curves: Partial<Record<ChannelId, { mean: number[]; sd: number[] }>>;
  /** Mean component scores. */
  scores: number[];
  outcome: { mean: number; sd: number };
  excursions: Partial<Record<ChannelId, { mean: number; sd: number }>>;
  trunkContribution: { mean: number; sd: number; n: number };
  onsetLagTrunkMs: { mean: number; sd: number; n: number };
  durations: { outbound: { mean: number; sd: number }; return: { mean: number; sd: number } };
  /** Mean RMS distance (deg) of members to their own mean curve: within-strategy variability. */
  withinRmsDeg: number;
}

export interface MemberInput {
  aligned: AlignedRep;
  descriptor: CoordinationDescriptor;
  outcome: number;
  scores: number[];
  label: string | null;
  posterior: number;
}

const ms = (xs: readonly number[]) => ({ mean: mean(xs), sd: sd(xs) });

export function strategySignature(label: string, members: readonly MemberInput[], channels: readonly ChannelId[]): StrategySignature {
  const m = members.filter((x) => x.label === label);
  const curves: StrategySignature['curves'] = {};
  for (const c of channels) {
    const rows = m.map((x) => x.aligned.curves[c]).filter((v): v is number[] => !!v);
    if (!rows.length) continue;
    curves[c] = {
      mean: Array.from({ length: GRID }, (_, k) => mean(rows.map((r) => r[k] as number))),
      sd: Array.from({ length: GRID }, (_, k) => (rows.length > 1 ? sd(rows.map((r) => r[k] as number)) : NaN)),
    };
  }
  const excursions: StrategySignature['excursions'] = {};
  for (const c of channels) excursions[c] = ms(m.map((x) => x.descriptor.excursions[c]).filter((v): v is number => v !== undefined));
  const tc = m.map((x) => x.descriptor.trunkContribution).filter((v): v is number => v !== null);
  const lag = m.map((x) => x.descriptor.onsetLags.trunkMs).filter((v): v is number => v !== null);
  let within = 0;
  let cnt = 0;
  for (const x of m) {
    let s = 0;
    let k = 0;
    for (const c of channels) {
      const v = x.aligned.curves[c];
      const mu = curves[c]?.mean;
      if (!v || !mu) continue;
      for (let i = 0; i < GRID; i++) {
        s += ((v[i] as number) - (mu[i] as number)) ** 2;
        k++;
      }
    }
    if (k) {
      within += Math.sqrt(s / k);
      cnt++;
    }
  }
  const dims = m[0]?.scores.length ?? 0;
  return {
    label,
    n: m.length,
    meanPosterior: mean(m.map((x) => x.posterior)),
    curves,
    scores: Array.from({ length: dims }, (_, j) => mean(m.map((x) => x.scores[j] as number))),
    outcome: ms(m.map((x) => x.outcome)),
    excursions,
    trunkContribution: { ...ms(tc), n: tc.length },
    onsetLagTrunkMs: { ...ms(lag), n: lag.length },
    durations: { outbound: ms(m.map((x) => x.aligned.durations.outbound)), return: ms(m.map((x) => x.aligned.durations.return)) },
    withinRmsDeg: cnt ? within / cnt : NaN,
  };
}
