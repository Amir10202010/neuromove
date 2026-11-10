// Repetition-level features of one raw recording, computed by the EXISTING coordination pipeline
// (channels → repetitions with phase boundaries → landmark registration → descriptors). One helper so that
// uncertainty propagation, the re-attachment study, strategy profiles and the scenario engine all read the same
// numbers from the same code — no second implementation of any metric.

import { sparc } from '../../core/sparc';
import type { RawFrame } from '../../devices/types';
import { alignRep, type AlignedRep } from '../coord/align';
import { buildChannels, type ChannelId, type ChannelSet, type RecordingMeta } from '../coord/channels';
import { describeRepetition, type CoordinationDescriptor } from '../coord/coordination';
import { lowpassNaN, segmentRepetitions, type Repetition } from '../coord/segment';

export const FEATURE_CHANNELS: readonly ChannelId[] = ['trunk_pitch', 'trunk_roll', 'upper_elev', 'fore_elev', 'elbow_flex', 'humerothoracic'];

/** Scalar features of one repetition. Units are in REP_FEATURE_UNITS; a feature that cannot be computed is absent. */
export type RepFeatureId =
  | 'outcome'
  | 'exc_trunk_pitch'
  | 'exc_trunk_roll'
  | 'exc_upper_elev'
  | 'exc_fore_elev'
  | 'exc_elbow_flex'
  | 'exc_humerothoracic'
  | 'trunk_contribution'
  | 'dur_outbound'
  | 'dur_return'
  | 'peak_rate'
  | 'time_to_peak_fraction'
  | 'sparc_outbound'
  | 'onset_lag_trunk_ms'
  | 'onset_lag_fore_ms';

export const REP_FEATURE_IDS: readonly RepFeatureId[] = [
  'outcome',
  'exc_trunk_pitch',
  'exc_trunk_roll',
  'exc_upper_elev',
  'exc_fore_elev',
  'exc_elbow_flex',
  'exc_humerothoracic',
  'trunk_contribution',
  'dur_outbound',
  'dur_return',
  'peak_rate',
  'time_to_peak_fraction',
  'sparc_outbound',
  'onset_lag_trunk_ms',
  'onset_lag_fore_ms',
];

export const REP_FEATURE_UNITS: Record<RepFeatureId, string> = {
  outcome: '°',
  exc_trunk_pitch: '°',
  exc_trunk_roll: '°',
  exc_upper_elev: '°',
  exc_fore_elev: '°',
  exc_elbow_flex: '°',
  exc_humerothoracic: '°',
  trunk_contribution: '',
  dur_outbound: 's',
  dur_return: 's',
  peak_rate: '°/s',
  time_to_peak_fraction: '',
  sparc_outbound: '',
  onset_lag_trunk_ms: 'ms',
  onset_lag_fore_ms: 'ms',
};

/** Registry entry (measure/registry.ts) each feature traces to. */
export const REP_FEATURE_REGISTRY: Record<RepFeatureId, string> = {
  outcome: 'channel.upper_elev',
  exc_trunk_pitch: 'channel.trunk_pitch',
  exc_trunk_roll: 'channel.trunk_roll',
  exc_upper_elev: 'channel.upper_elev',
  exc_fore_elev: 'channel.fore_elev',
  exc_elbow_flex: 'channel.elbow_flex',
  exc_humerothoracic: 'channel.humerothoracic',
  trunk_contribution: 'coordination.trunk_contribution',
  dur_outbound: 'feature.duration',
  dur_return: 'feature.duration',
  peak_rate: 'feature.peak_speed',
  time_to_peak_fraction: 'feature.time_to_peak_fraction',
  sparc_outbound: 'feature.sparc',
  onset_lag_trunk_ms: 'feature.trunk_lag',
  onset_lag_fore_ms: 'feature.trunk_lag',
};

export interface RepFeatureRecord {
  /** Index of the repetition among the COMPLETE repetitions of the exercise in this recording. */
  index: number;
  /** Seconds from the first frame (onset, θ = 5 %). */
  tOnset: number;
  tOffset: number;
  rep: Repetition;
  aligned: AlignedRep;
  descriptor: CoordinationDescriptor;
  values: Partial<Record<RepFeatureId, number>>;
}

export interface RecordingFeatures {
  cs: ChannelSet;
  reps: RepFeatureRecord[];
  /** Repetitions detected but not usable, with the reason. */
  excluded: { index: number; reason: string }[];
}

function stepSpans(cs: ChannelSet, exercise: string): { start: number; end: number }[] {
  const spans = cs.meta.steps.filter((s) => s.exercise === exercise && s.side === cs.meta.side);
  return spans
    .map((s) => {
      const start = cs.t.findIndex((t) => t >= s.tStart);
      let end = cs.t.findIndex((t) => t > s.tEnd);
      if (end < 0) end = cs.t.length;
      return { start: Math.max(0, start), end: end - 1 };
    })
    .filter((s) => s.end > s.start);
}

export function featuresOfChannels(cs: ChannelSet, exercise: string): RecordingFeatures {
  const reps: RepFeatureRecord[] = [];
  const excluded: RecordingFeatures['excluded'] = [];
  const rate = cs.meta.rateHz;
  const rateCh = exercise === 'elbow_flexion' ? cs.channels.fore_rate : cs.channels.upper_rate;
  const rateLp = rateCh ? lowpassNaN(rateCh, 6, rate) : null;
  for (const span of stepSpans(cs, exercise)) {
    for (const rep of segmentRepetitions(cs, exercise, span)) {
      if (!rep.complete || !rep.onset || !rep.offset || !rep.arrival || !rep.departure) {
        excluded.push({ index: rep.index, reason: rep.flags.join(',') || 'incomplete' });
        continue;
      }
      const aligned = alignRep(cs, rep, FEATURE_CHANNELS);
      if (!aligned) {
        excluded.push({ index: rep.index, reason: 'landmarks_out_of_order' });
        continue;
      }
      const descriptor = describeRepetition(cs, rep, aligned, FEATURE_CHANNELS);
      const v: Partial<Record<RepFeatureId, number>> = {};
      const put = (k: RepFeatureId, x: number | null | undefined) => {
        if (x !== null && x !== undefined && Number.isFinite(x)) v[k] = x;
      };
      put('outcome', rep.outcome);
      for (const c of FEATURE_CHANNELS) put(`exc_${c}` as RepFeatureId, descriptor.excursions[c]);
      put('trunk_contribution', descriptor.trunkContribution);
      put('dur_outbound', aligned.durations.outbound);
      put('dur_return', aligned.durations.return);
      put('onset_lag_trunk_ms', descriptor.onsetLags.trunkMs);
      put('onset_lag_fore_ms', descriptor.onsetLags.foreMs);
      if (rateLp && rateCh) {
        let pk = -Infinity;
        for (let i = rep.onset.i; i <= rep.offset.i; i++) if ((rateLp[i] as number) > pk) pk = rateLp[i] as number;
        put('peak_rate', pk);
        const out = rateCh.slice(rep.onset.i, rep.arrival.i + 1);
        if (out.length >= 8 && out.every(Number.isFinite)) put('sparc_outbound', sparc(out, rate));
      }
      if (rep.peakVelOut && aligned.durations.outbound > 0) put('time_to_peak_fraction', (rep.peakVelOut.t - rep.onset.t) / aligned.durations.outbound);
      reps.push({ index: reps.length, tOnset: rep.onset.t, tOffset: rep.offset.t, rep, aligned, descriptor, values: v });
    }
  }
  return { cs, reps, excluded };
}

export function recordingFeatures(frames: readonly RawFrame[], meta: RecordingMeta, exercise: string): RecordingFeatures {
  return featuresOfChannels(buildChannels(frames, meta), exercise);
}

/**
 * Pair the repetitions of two analyses of the SAME movement (e.g. original and perturbed raw stream) by time
 * overlap, so that a feature is compared repetition by repetition. Unmatched repetitions are returned separately.
 */
export function pairByTime(a: readonly RepFeatureRecord[], b: readonly RepFeatureRecord[]): { pairs: [RepFeatureRecord, RepFeatureRecord][]; unmatchedA: number; unmatchedB: number } {
  const used = new Set<number>();
  const pairs: [RepFeatureRecord, RepFeatureRecord][] = [];
  for (const x of a) {
    let best = -1;
    let bo = 0;
    b.forEach((y, j) => {
      if (used.has(j)) return;
      const ov = Math.min(x.tOffset, y.tOffset) - Math.max(x.tOnset, y.tOnset);
      if (ov > bo) {
        bo = ov;
        best = j;
      }
    });
    // at least half of the shorter repetition must overlap
    if (best >= 0 && bo >= 0.5 * Math.min(x.tOffset - x.tOnset, (b[best] as RepFeatureRecord).tOffset - (b[best] as RepFeatureRecord).tOnset)) {
      used.add(best);
      pairs.push([x, b[best] as RepFeatureRecord]);
    }
  }
  return { pairs, unmatchedA: a.length - pairs.length, unmatchedB: b.length - pairs.length };
}
