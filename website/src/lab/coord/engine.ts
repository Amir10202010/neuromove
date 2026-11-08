// Motor Coordination & Strategy Discovery Engine (MCSE) — orchestration.
//
//   raw frames ─▶ manifest check ─▶ channels (QC, calibration, inclination, hinge, relative orientation)
//              ─▶ repetitions + phases (with boundary uncertainty) ─▶ landmark-registered trajectories
//              ─▶ coordination components (fPCA, data-driven k) ─▶ strategy discovery (GMM + refusal rules)
//              ─▶ signatures ─▶ performance–strategy dissociation ─▶ longitudinal strategy analysis
//
// Pure and deterministic (seeded), no UI, no network. Every result carries the component versions, the
// assumptions that apply, and the provenance of every recording (source, simulated flag, manifest status).

import type { RawFrame } from '../../devices/types';
import { ALGORITHM_VERSION } from '../../core/version';
import { COORD_VERSION, LAB_VERSIONS } from '../version';
import { alignRep, featureVector, type AlignMethod, type AlignedRep } from './align';
import { buildChannels, CHANNELS, type ChannelId, type ChannelSet, type RecordingMeta } from './channels';
import { betweenGroupShare, channelShares, fitPca, residualizeOnOutcome, selectComponents, DEFAULT_SELECTION, type ComponentSelection, type PcaModel, type SelectionOptions } from './components';
import { describeRepetition, strategySignature, type CoordinationDescriptor, type StrategySignature } from './coordination';
import { compareGroups, DEFAULT_DISSOCIATION, type DissociationConfig, type GroupComparison, type RepVector } from './dissociation';
import { congruence, column } from './linalg';
import { longitudinal, type LongitudinalResult, type SessionRep } from './longitudinal';
import { verifyManifest, type ManifestCheck, type RawManifest } from './provenance';
import { segmentRepetitions, type Repetition } from './segment';
import { discoverStrategies, type StrategyDiscovery } from './strategy';
import { adjustedRand } from './stats';

export const MCSE_VERSION = COORD_VERSION;
/** Every component whose numbers MCSE results depend on. */
export const MCSE_VERSIONS = { coord: COORD_VERSION, quality: LAB_VERSIONS.quality, core: ALGORITHM_VERSION } as const;

/** Angle channels eligible for the coordination representation (observable; humerothoracic is estimated → display only). */
export const REPRESENTATION_CANDIDATES: readonly ChannelId[] = ['trunk_pitch', 'trunk_roll', 'upper_elev', 'fore_elev', 'elbow_flex'];
export const DISPLAY_EXTRA: readonly ChannelId[] = ['humerothoracic'];

export const SUPPORTED_EXERCISES = ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion'] as const;

/**
 * Channels that FAILED channel validation for a movement and are therefore kept out of its representation (still
 * shown for inspection). elbow_flex during shoulder abduction: RMSE 7.1° > 4° criterion (validation V2d, run 2) —
 * the hinge axis turns towards vertical as the arm abducts, where gravity carries no elbow information.
 */
export const NOT_VALIDATED_FOR: Readonly<Record<string, readonly ChannelId[]>> = { shoulder_abduction: ['elbow_flex'] };

export interface McseRecordingInput {
  frames: readonly RawFrame[];
  meta: RecordingMeta;
  manifest?: RawManifest | null;
}

export interface McseOptions {
  exercise: string;
  /**
   * 'performance_adjusted' (default): components and strategies are computed on trajectories residualised on the
   * task outcome (organisation at a given performance level). 'absolute': on the raw excursion curves.
   * Dissociation tests always use absolute curves of outcome-matched repetitions.
   */
  representation?: 'performance_adjusted' | 'absolute';
  alignment?: AlignMethod;
  seed?: number;
  selection?: Partial<SelectionOptions>;
  dissociation?: Partial<DissociationConfig>;
  strategyBootstraps?: number;
}

export interface RecordingSummary {
  id: string;
  participantId: string;
  startedAt: string;
  source: RecordingMeta['source'];
  simulated: boolean;
  manifest: ManifestCheck;
  frames: number;
  qcConfidence: string;
  calibration: ChannelSet['calibration']['source'];
  drift: ChannelSet['drift'];
  unavailable: ChannelSet['unavailable'];
  repetitions: number;
  complete: number;
  /** Refused before analysis (e.g. manifest mismatch) — reason. */
  refused: string | null;
}

export interface RepRecord {
  id: string;
  recordingId: string;
  participantId: string;
  sessionIndex: number;
  startedAt: string;
  rep: Repetition;
  aligned: AlignedRep;
  descriptor: CoordinationDescriptor;
  outcome: number;
  /** Feature vector (landmark-aligned, representation channels). */
  x: number[];
  scores: number[];
  strategy: { label: string | null; posterior: number; posteriors: number[] };
}

export interface McseResult {
  version: string;
  versions: typeof MCSE_VERSIONS;
  exercise: string;
  status: 'ok' | 'unsupported_exercise' | 'no_repetitions' | 'insufficient_data';
  messages: string[];
  assumptions: string[];
  simulatedInputs: boolean;
  recordings: RecordingSummary[];
  /** Repetitions found but not used, with reasons. */
  excluded: { recordingId: string; index: number; reason: string }[];
  channels: { representation: ChannelId[]; display: ChannelId[] };
  representation: 'performance_adjusted' | 'absolute';
  reps: RepRecord[];
  components: {
    selection: ComponentSelection;
    explained: number[];
    /** Per retained component: share of squared loadings per channel. */
    channelShares: Record<string, number>[];
    loadings: number[][];
    mean: number[];
    /** Congruence of landmark-registered vs linearly normalised components (alignment sensitivity). */
    alignmentCongruence: number[];
    /** Between-participant and between-session share of each retained component's score variance. */
    participantShare: number[];
    sessionShare: number[];
  } | null;
  strategies: (Omit<StrategyDiscovery, 'model'> & { signatures: StrategySignature[] }) | null;
  /** Outbound-only vs return-only strategy assignment agreement (within-repetition consistency). */
  withinRepetition: { outbound: StrategyDiscovery['verdict']; return: StrategyDiscovery['verdict']; ari: number | null } | null;
  dissociation: GroupComparison[];
  longitudinal: LongitudinalResult | null;
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
    .filter((s) => s.start >= 0 && s.end > s.start);
}

export function runMcse(inputs: readonly McseRecordingInput[], o: McseOptions): McseResult {
  const seed = o.seed ?? 20261108;
  const alignment = o.alignment ?? 'landmark';
  const messages: string[] = [];
  const assumptions = [
    'Kinematic coordination only: no EMG, no muscle or neural synergies are measured or inferred.',
    'Inclinations are gravity-referenced from the calibration pose; heading/yaw is not observable (no magnetometer).',
    'Elbow flexion assumes a hinge whose axis is the upper-arm sensor Z (core/pipeline.ts elbowFlexion).',
    'Humerothoracic elevation is an ESTIMATED channel (6-axis relative heading, drift-bounded) shown for inspection only; it is not part of the representation.',
    'Sensors are read in one 100 Hz tick; intra-frame skew (≈2–4 ms) is below the 10 ms resolution of lag estimates.',
    'Strategy labels are neutral statistical clusters; they do not mean compensatory, pathological, efficient or worse.',
  ];
  const base = (status: McseResult['status']): McseResult => ({
    version: MCSE_VERSION,
    versions: MCSE_VERSIONS,
    exercise: o.exercise,
    status,
    messages,
    assumptions,
    simulatedInputs: inputs.some((i) => i.meta.simulated),
    recordings: [],
    excluded: [],
    channels: { representation: [], display: [] },
    representation: o.representation ?? 'performance_adjusted',
    reps: [],
    components: null,
    strategies: null,
    withinRepetition: null,
    dissociation: [],
    longitudinal: null,
  });
  if (!(SUPPORTED_EXERCISES as readonly string[]).includes(o.exercise)) {
    messages.push(`exercise_${o.exercise}_not_supported_(MCSE supports ${SUPPORTED_EXERCISES.join(', ')})`);
    return base('unsupported_exercise');
  }
  const result = base('ok');
  // chronological order per participant
  const sorted = [...inputs].sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt));
  const sessionIdx = new Map<string, number>();
  const firstDay = new Map<string, number>();
  const pending: { cs: ChannelSet; rep: Repetition; aligned: AlignedRep; alignedLin: AlignedRep; sessionIndex: number }[] = [];
  for (const inp of sorted) {
    const m = inp.meta;
    const check = inp.manifest === undefined && m.source === 'synthetic' ? 'no_manifest' : verifyManifest(inp.frames, inp.manifest ?? null);
    const summary: RecordingSummary = {
      id: m.id,
      participantId: m.participantId,
      startedAt: m.startedAt,
      source: m.source,
      simulated: m.simulated,
      manifest: check,
      frames: inp.frames.length,
      qcConfidence: 'unusable',
      calibration: 'none',
      drift: { residualBiasDps: {}, relativeHeadingDriftDps: null, restarts: 0 },
      unavailable: {},
      repetitions: 0,
      complete: 0,
      refused: null,
    };
    result.recordings.push(summary);
    if (check === 'hash_mismatch' || check === 'frame_count_mismatch' || check === 'unknown_scheme') {
      summary.refused = `raw stream does not match its manifest (${check}) — not analysed`;
      continue;
    }
    const cs = buildChannels(inp.frames, m);
    summary.qcConfidence = cs.qc.confidence;
    summary.calibration = cs.calibration.source;
    summary.drift = cs.drift;
    summary.unavailable = cs.unavailable;
    if (cs.qc.confidence === 'unusable' || cs.calibration.source === 'none') {
      summary.refused = cs.calibration.source === 'none' ? 'no calibration window (no 3 s still period)' : 'signal quality unusable';
      continue;
    }
    const k = (sessionIdx.get(m.participantId) ?? -1) + 1;
    sessionIdx.set(m.participantId, k);
    if (!firstDay.has(m.participantId)) firstDay.set(m.participantId, Date.parse(m.startedAt));
    for (const span of stepSpans(cs, o.exercise)) {
      for (const rep of segmentRepetitions(cs, o.exercise, span)) {
        summary.repetitions++;
        if (!rep.complete) {
          result.excluded.push({ recordingId: m.id, index: rep.index, reason: rep.flags.join(',') || 'incomplete' });
          continue;
        }
        const al = alignRep(cs, rep, [...REPRESENTATION_CANDIDATES, ...DISPLAY_EXTRA], alignment);
        const ll = alignRep(cs, rep, REPRESENTATION_CANDIDATES, alignment === 'landmark' ? 'linear' : 'landmark');
        if (!al || !ll) {
          result.excluded.push({ recordingId: m.id, index: rep.index, reason: 'landmarks_out_of_order' });
          continue;
        }
        summary.complete++;
        pending.push({ cs, rep, aligned: al, alignedLin: ll, sessionIndex: k });
      }
    }
  }
  if (!pending.length) {
    result.status = 'no_repetitions';
    messages.push('no_complete_repetitions_of_this_exercise_in_the_raw_recordings');
    return result;
  }
  // representation channels: present in ≥ 90 % of repetitions
  const blocked = NOT_VALIDATED_FOR[o.exercise] ?? [];
  const rep = REPRESENTATION_CANDIDATES.filter((c) => !blocked.includes(c) && pending.filter((p) => p.aligned.curves[c]).length >= 0.9 * pending.length);
  const display = [...rep, ...[...blocked, ...DISPLAY_EXTRA].filter((c) => pending.some((p) => p.aligned.curves[c]))];
  for (const c of blocked) messages.push(`channel_${c}_not_validated_for_${o.exercise}_(display_only)`);
  result.channels = { representation: rep, display };
  for (const c of REPRESENTATION_CANDIDATES) if (!rep.includes(c) && !blocked.includes(c)) messages.push(`channel_${c}_not_in_representation_(${CHANNELS[c].needs.join('+')}_missing_or_incomplete)`);
  const used = pending.filter((p) => rep.every((c) => p.aligned.curves[c] && p.alignedLin.curves[c]));
  pending.filter((p) => !used.includes(p)).forEach((p) => result.excluded.push({ recordingId: p.cs.meta.id, index: p.rep.index, reason: 'representation_channel_missing' }));
  const X = used.map((p) => featureVector(p.aligned, rep) as number[]);
  const outcomes = used.map((p) => p.rep.outcome);
  const representation = o.representation ?? 'performance_adjusted';
  const XR = representation === 'performance_adjusted' ? residualizeOnOutcome(X, outcomes).X : X;
  const XL0 = used.map((p) => featureVector(p.alignedLin, rep) as number[]);
  const XL = representation === 'performance_adjusted' ? residualizeOnOutcome(XL0, outcomes).X : XL0;
  const sel = selectComponents(XR, { ...DEFAULT_SELECTION, seed, ...o.selection });
  const model: PcaModel = sel.model;
  const k = sel.selection.k;
  const kShow = Math.max(1, Math.min(3, k || 1, model.V[0]?.length ?? 0));
  const lin = fitPca(XL);
  const alignmentCongruence = Array.from({ length: Math.min(kShow, lin.V[0]?.length ?? 0) }, (_, j) => congruence(column(model.V, j), column(lin.V, j)));
  const scoresAll = model.scores.map((r) => r.slice(0, k));
  result.components = {
    selection: sel.selection,
    explained: model.explained.slice(0, 8),
    channelShares: Array.from({ length: kShow }, (_, j) => channelShares(column(model.V, j), rep, 101)),
    loadings: Array.from({ length: kShow }, (_, j) => column(model.V, j)),
    mean: model.mu,
    alignmentCongruence,
    participantShare: betweenGroupShare(model.scores, used.map((p) => p.cs.meta.participantId), kShow),
    sessionShare: betweenGroupShare(model.scores, used.map((p) => p.cs.meta.id), kShow),
  };
  if (sel.selection.status === 'insufficient_data') result.status = 'insufficient_data';
  // strategies
  const disc = discoverStrategies(scoresAll, { seed, bootstraps: o.strategyBootstraps ?? 40, sessions: used.map((p) => p.cs.meta.id) });
  const records: RepRecord[] = used.map((p, i) => {
    const a = disc.assignments[i] ?? { label: null, posterior: NaN, posteriors: [] };
    return {
      id: `${p.cs.meta.id}#${p.rep.index}`,
      recordingId: p.cs.meta.id,
      participantId: p.cs.meta.participantId,
      sessionIndex: p.sessionIndex,
      startedAt: p.cs.meta.startedAt,
      rep: p.rep,
      aligned: p.aligned,
      descriptor: describeRepetition(p.cs, p.rep, p.aligned, display),
      outcome: p.rep.outcome,
      x: X[i] as number[],
      scores: scoresAll[i] as number[],
      strategy: a,
    };
  });
  result.reps = records;
  const members = records.map((r) => ({ aligned: r.aligned, descriptor: r.descriptor, outcome: r.outcome, scores: r.scores, label: r.strategy.label, posterior: r.strategy.posterior }));
  const sigLabels = disc.verdict === 'multiple_strategies' ? disc.labels : [];
  const signatures = sigLabels.map((l) => strategySignature(l, members, display));
  if (disc.verdict !== 'multiple_strategies') {
    // one descriptive signature of all repetitions (NOT a discovered strategy)
    signatures.push(strategySignature('all', members.map((m) => ({ ...m, label: 'all' })), display));
  }
  const { model: _m, ...discNoModel } = disc;
  void _m;
  result.strategies = { ...discNoModel, signatures };
  // within-repetition: outbound half vs return half
  if (disc.verdict === 'multiple_strategies') {
    const half = (from: number, to: number) => {
      const H = used.map((p) => rep.flatMap((c) => (p.aligned.curves[c] as number[]).slice(from, to)));
      return representation === 'performance_adjusted' ? residualizeOnOutcome(H, outcomes).X : H;
    };
    const so = selectComponents(half(0, 46), { ...DEFAULT_SELECTION, seed: seed + 3, permutations: 30, bootstraps: 30 });
    const sr = selectComponents(half(55, 101), { ...DEFAULT_SELECTION, seed: seed + 4, permutations: 30, bootstraps: 30 });
    const dO = discoverStrategies(so.model.scores.map((r) => r.slice(0, so.selection.k)), { seed: seed + 5, bootstraps: 20 });
    const dR = discoverStrategies(sr.model.scores.map((r) => r.slice(0, sr.selection.k)), { seed: seed + 6, bootstraps: 20 });
    const lo = dO.assignments.map((a) => a.label ?? '?');
    const lr = dR.assignments.map((a) => a.label ?? '?');
    result.withinRepetition = { outbound: dO.verdict, return: dR.verdict, ari: dO.verdict === 'multiple_strategies' && dR.verdict === 'multiple_strategies' ? adjustedRand(lo, lr) : null };
  }
  // dissociation
  const dcfg = { ...DEFAULT_DISSOCIATION, seed: seed + 9, ...o.dissociation };
  const vec = (r: RepRecord): RepVector => ({ id: r.id, outcome: r.outcome, x: r.x, scores: r.scores });
  if (disc.verdict === 'multiple_strategies') {
    for (let i = 0; i < disc.labels.length; i++)
      for (let j = i + 1; j < disc.labels.length; j++) {
        const la = disc.labels[i] as string;
        const lb = disc.labels[j] as string;
        result.dissociation.push(compareGroups(la, records.filter((r) => r.strategy.label === la).map(vec), lb, records.filter((r) => r.strategy.label === lb).map(vec), rep, dcfg));
      }
  }
  // longitudinal (per participant; the first participant in the input when several are pooled)
  const participants = [...new Set(records.map((r) => r.participantId))];
  if (participants.length > 1) messages.push('several_participants_pooled:_components_and_strategies_are_pooled,_longitudinal_analysis_per_participant_only_for_the_first');
  const pid = participants[0] as string;
  const own = records.filter((r) => r.participantId === pid);
  const sessionsOf = [...new Set(own.map((r) => r.recordingId))];
  if (sessionsOf.length >= 2) {
    const first = own.filter((r) => r.recordingId === sessionsOf[0]);
    const last = own.filter((r) => r.recordingId === sessionsOf[sessionsOf.length - 1]);
    result.dissociation.push(compareGroups('first session', first.map(vec), 'last session', last.map(vec), rep, { ...dcfg, crossSession: true }));
  }
  const sr: SessionRep[] = own.map((r) => ({ ...vec(r), sessionId: r.recordingId, sessionIndex: r.sessionIndex, day: (Date.parse(r.startedAt) - (firstDay.get(pid) as number)) / 86_400_000, label: r.strategy.label }));
  result.longitudinal = longitudinal(sr, k > 0 ? model : null, k, seed + 13);
  return result;
}
