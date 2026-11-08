// Performance–Strategy Dissociation Analysis (PSDA).
//
// Question: do repetitions with EQUIVALENT observed task outcomes differ in their multi-segment movement
// organisation by more than repetition-to-repetition variability — where, by how much, and reproducibly?
//
// Group comparison (two sets of repetitions: two discovered strategies, two sessions, or any researcher-chosen
// sets), every step pre-specified:
//   1. Outcome matching: caliper matching on the task outcome (greedy nearest neighbour, without replacement,
//      caliper = equivalence margin), so the compared sets have overlapping outcome distributions.
//   2. Outcome equivalence: two one-sided tests via the 90 % bootstrap CI of the mean outcome difference; the sets
//      are "equivalent" only if the whole CI lies within ±margin (default 5°, larger than the inclination
//      measurement error of ≈ 1–3° established in validation).
//   3. Trajectory difference: Welch t at every channel × normalised-time sample; family-wise error controlled by
//      the permutation distribution of max|t| (non-parametric SPM; Nichols & Holmes 2002, Pataky 2010).
//      p_FWE and the supra-threshold regions (channel, % of movement) are reported.
//   4. Contributions: share of the squared mean-difference curve per channel and per phase (outbound/return);
//      standardised difference of every retained coordination component with a bootstrap CI.
//   5. Reproducibility: split-half replication — in random halves of each set, is the max-statistic test
//      significant in BOTH halves?
// Verdict: 'dissociation' needs outcome equivalence AND p_FWE < 0.05. It is a statement about observed kinematics
// only. It never labels a strategy compensatory, pathological, efficient or worse.

import type { ChannelId } from './channels';
import { GRID, LANDMARKS } from './align';

/** Grid index of the arrival / departure landmarks (outbound = 0…OUT_END, hold, return = RET_START…100). */
const OUT_END = Math.round(LANDMARKS[1] * (GRID - 1));
const RET_START = Math.round(LANDMARKS[2] * (GRID - 1));
import { bootstrapIndices, createRng, mean, quantileOf, sd, shuffle, type Rng } from './stats';

export interface DissociationConfig {
  marginDeg: number;
  /**
   * The two sets come from DIFFERENT sessions (sensors re-attached in between). A coordination difference is then
   * reported only if the RMS mean-curve difference also exceeds the sensor re-placement margin.
   */
  crossSession?: boolean;
  replacementMarginDeg?: number;
  permutations: number;
  bootstraps: number;
  splits: number;
  alpha: number;
  minPerGroup: number;
  seed: number;
}

/**
 * Sensor re-placement margin, degrees: RMS difference between session mean curves that re-attaching the sensors
 * alone can produce. PROVISIONAL — derived from the synthetic re-placement model (2–5° mount misalignment per
 * session, simulation/imuModel.ts) by validation.ts calibrateReplacementMargin() on seeds disjoint from the
 * validation suite: 95th percentile = 2.50° of 160 stationary session comparisons (median 1.36°, max 5.34°;
 * research/mcse-validation.md §3). A re-donning reliability study with real
 * children is required to replace it.
 */
export const REPLACEMENT_MARGIN_DEG = 2.5;

export const DEFAULT_DISSOCIATION: DissociationConfig = { marginDeg: 5, permutations: 2000, bootstraps: 1000, splits: 40, alpha: 0.05, minPerGroup: 5, seed: 1729 };

export interface RepVector {
  id: string;
  outcome: number;
  /** Channel-major concatenation of GRID samples per channel. */
  x: number[];
  /** Coordination-component scores (may be empty). */
  scores: number[];
}

export interface Region {
  channel: ChannelId;
  fromPct: number;
  toPct: number;
  /** Largest |mean difference| inside the region, degrees (B − A). */
  peakDiffDeg: number;
}

export type DissociationVerdict = 'dissociation' | 'no_coordination_difference' | 'within_replacement_margin' | 'outcome_not_equivalent' | 'insufficient_data';

export interface GroupComparison {
  a: string;
  b: string;
  nA: number;
  nB: number;
  matching: { caliperDeg: number; droppedA: number; droppedB: number; ids: { a: string[]; b: string[] } };
  outcome: { meanA: number; meanB: number; diff: number; ci90: [number, number]; equivalent: boolean };
  trajectory: {
    maxT: number;
    /** RMS of the mean-difference curve over all channels and samples, degrees. */
    rmsTotalDeg: number;
    criticalT: number;
    pFwe: number;
    regions: Region[];
    meanDiff: Partial<Record<ChannelId, number[]>>;
    rmsByChannel: { channel: ChannelId; rmsDeg: number; ci95: [number, number]; share: number }[];
    shareByPhase: { outbound: number; return: number; hold: number };
  };
  components: { index: number; d: number; ci95: [number, number] }[];
  stability: { replication: number; splits: number };
  verdict: DissociationVerdict;
  reasons: string[];
}

/** Greedy caliper matching on the outcome. */
export function matchOnOutcome(A: readonly RepVector[], B: readonly RepVector[], caliper: number): { a: RepVector[]; b: RepVector[] } {
  const small = A.length <= B.length ? A : B;
  const large = A.length <= B.length ? B : A;
  const used = new Set<number>();
  const pairs: [RepVector, RepVector][] = [];
  // match the hardest (most extreme) outcomes first: order the smaller set by distance from the larger set's median
  const med = quantileOf(large.map((r) => r.outcome), 0.5);
  const order = [...small].sort((x, y) => Math.abs(y.outcome - med) - Math.abs(x.outcome - med));
  for (const s of order) {
    let best = -1;
    let bd = Infinity;
    large.forEach((l, i) => {
      if (used.has(i)) return;
      const d = Math.abs(l.outcome - s.outcome);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0 && bd <= caliper) {
      used.add(best);
      pairs.push([s, large[best] as RepVector]);
    }
  }
  const ms = pairs.map((p) => p[0]);
  const ml = pairs.map((p) => p[1]);
  return A.length <= B.length ? { a: ms, b: ml } : { a: ml, b: ms };
}

function welchT(A: readonly number[][], B: readonly number[][], d: number): number[] {
  const t = new Array<number>(d).fill(0);
  const nA = A.length;
  const nB = B.length;
  for (let j = 0; j < d; j++) {
    let ma = 0;
    let mb = 0;
    for (const r of A) ma += r[j] as number;
    for (const r of B) mb += r[j] as number;
    ma /= nA;
    mb /= nB;
    let va = 0;
    let vb = 0;
    for (const r of A) va += ((r[j] as number) - ma) ** 2;
    for (const r of B) vb += ((r[j] as number) - mb) ** 2;
    va /= Math.max(1, nA - 1);
    vb /= Math.max(1, nB - 1);
    const se = Math.sqrt(va / nA + vb / nB);
    t[j] = se > 1e-9 ? (mb - ma) / se : 0;
  }
  return t;
}

function maxAbs(x: readonly number[]): number {
  let m = 0;
  for (const v of x) if (Math.abs(v) > m) m = Math.abs(v);
  return m;
}

function permutationMaxT(A: readonly number[][], B: readonly number[][], perms: number, rng: Rng): { obs: number[]; null: number[] } {
  const d = A[0]?.length ?? 0;
  const obs = welchT(A, B, d);
  const pooled = [...A, ...B];
  const nul: number[] = [];
  for (let p = 0; p < perms; p++) {
    const s = shuffle(pooled, rng);
    nul.push(maxAbs(welchT(s.slice(0, A.length), s.slice(A.length), d)));
  }
  return { obs, null: nul };
}

export function compareGroups(aLabel: string, A0: readonly RepVector[], bLabel: string, B0: readonly RepVector[], channels: readonly ChannelId[], cfg: DissociationConfig = DEFAULT_DISSOCIATION): GroupComparison {
  const rng = createRng(cfg.seed);
  const { a: A, b: B } = matchOnOutcome(A0, B0, cfg.marginDeg);
  const reasons: string[] = [];
  const empty = (): GroupComparison['trajectory'] => ({ maxT: NaN, rmsTotalDeg: NaN, criticalT: NaN, pFwe: NaN, regions: [], meanDiff: {}, rmsByChannel: [], shareByPhase: { outbound: NaN, return: NaN, hold: NaN } });
  const base = {
    a: aLabel,
    b: bLabel,
    nA: A.length,
    nB: B.length,
    matching: { caliperDeg: cfg.marginDeg, droppedA: A0.length - A.length, droppedB: B0.length - B.length, ids: { a: A.map((r) => r.id), b: B.map((r) => r.id) } },
  };
  // outcome equivalence (bootstrap 90 % CI of mean difference)
  const oa = A.map((r) => r.outcome);
  const ob = B.map((r) => r.outcome);
  const diffs: number[] = [];
  for (let b = 0; b < cfg.bootstraps && A.length && B.length; b++) {
    const ia = bootstrapIndices(A.length, rng);
    const ib = bootstrapIndices(B.length, rng);
    diffs.push(mean(ib.map((i) => ob[i] as number)) - mean(ia.map((i) => oa[i] as number)));
  }
  const ci90: [number, number] = [quantileOf(diffs, 0.05), quantileOf(diffs, 0.95)];
  const outcome = { meanA: mean(oa), meanB: mean(ob), diff: mean(ob) - mean(oa), ci90, equivalent: ci90[0] >= -cfg.marginDeg && ci90[1] <= cfg.marginDeg };
  if (A.length < cfg.minPerGroup || B.length < cfg.minPerGroup) {
    // Too few outcome-matched repetitions. If the UNMATCHED sets are large enough, the reason is that their outcomes
    // do not overlap: that is a performance difference, not missing data.
    if (A0.length >= cfg.minPerGroup && B0.length >= cfg.minPerGroup) {
      const ua = A0.map((r) => r.outcome);
      const ub = B0.map((r) => r.outcome);
      const ud: number[] = [];
      for (let b = 0; b < cfg.bootstraps; b++) ud.push(mean(bootstrapIndices(ub.length, rng).map((i) => ub[i] as number)) - mean(bootstrapIndices(ua.length, rng).map((i) => ua[i] as number)));
      const uci: [number, number] = [quantileOf(ud, 0.05), quantileOf(ud, 0.95)];
      if (!(uci[0] >= -cfg.marginDeg && uci[1] <= cfg.marginDeg)) {
        reasons.push(`outcomes_do_not_overlap:_difference_ci90_[${uci[0].toFixed(1)},${uci[1].toFixed(1)}]`);
        return { ...base, outcome: { meanA: mean(ua), meanB: mean(ub), diff: mean(ub) - mean(ua), ci90: uci, equivalent: false }, trajectory: empty(), components: [], stability: { replication: NaN, splits: 0 }, verdict: 'outcome_not_equivalent', reasons };
      }
    }
    reasons.push(`after_outcome_matching_${A.length}_and_${B.length}_repetitions_(minimum_${cfg.minPerGroup}_each)`);
    return { ...base, outcome, trajectory: empty(), components: [], stability: { replication: NaN, splits: 0 }, verdict: 'insufficient_data', reasons };
  }
  const XA = A.map((r) => r.x);
  const XB = B.map((r) => r.x);
  const d = XA[0]?.length ?? 0;
  const perm = permutationMaxT(XA, XB, cfg.permutations, rng);
  const maxT = maxAbs(perm.obs);
  const criticalT = quantileOf(perm.null, 1 - cfg.alpha);
  const pFwe = (1 + perm.null.filter((v) => v >= maxT).length) / (perm.null.length + 1);
  // mean difference curves and regions
  const meanDiff: Partial<Record<ChannelId, number[]>> = {};
  const regions: Region[] = [];
  const md = Array.from({ length: d }, (_, j) => mean(XB.map((r) => r[j] as number)) - mean(XA.map((r) => r[j] as number)));
  channels.forEach((c, ci) => {
    const seg = md.slice(ci * GRID, (ci + 1) * GRID);
    meanDiff[c] = seg;
    let k = 0;
    while (k < GRID) {
      if (Math.abs(perm.obs[ci * GRID + k] as number) > criticalT) {
        const s = k;
        let peak = 0;
        while (k < GRID && Math.abs(perm.obs[ci * GRID + k] as number) > criticalT) {
          if (Math.abs(seg[k] as number) > Math.abs(peak)) peak = seg[k] as number;
          k++;
        }
        regions.push({ channel: c, fromPct: s, toPct: k - 1, peakDiffDeg: peak });
      } else k++;
    }
  });
  // contributions with bootstrap CIs of the per-channel RMS difference
  const rmsOf = (v: readonly number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0) / Math.max(1, v.length));
  const totalSq = md.reduce((a, x) => a + x * x, 0) || 1;
  const bootRms: number[][] = channels.map(() => []);
  for (let b = 0; b < Math.min(cfg.bootstraps, 400); b++) {
    const ia = bootstrapIndices(A.length, rng);
    const ib = bootstrapIndices(B.length, rng);
    channels.forEach((_, ci) => {
      const v: number[] = [];
      for (let k = 0; k < GRID; k++) {
        const j = ci * GRID + k;
        v.push(mean(ib.map((i) => (XB[i] as number[])[j] as number)) - mean(ia.map((i) => (XA[i] as number[])[j] as number)));
      }
      (bootRms[ci] as number[]).push(rmsOf(v));
    });
  }
  const rmsByChannel = channels.map((c, ci) => {
    const seg = md.slice(ci * GRID, (ci + 1) * GRID);
    return { channel: c, rmsDeg: rmsOf(seg), ci95: [quantileOf(bootRms[ci] as number[], 0.025), quantileOf(bootRms[ci] as number[], 0.975)] as [number, number], share: seg.reduce((a, x) => a + x * x, 0) / totalSq };
  });
  let out = 0;
  let ret = 0;
  channels.forEach((_, ci) => {
    for (let k = 0; k < GRID; k++) {
      const v = (md[ci * GRID + k] as number) ** 2;
      if (k <= OUT_END) out += v;
      else if (k >= RET_START) ret += v;
    }
  });
  const shareByPhase = { outbound: out / totalSq, return: ret / totalSq, hold: 1 - (out + ret) / totalSq };
  // components: standardised mean differences with bootstrap CI
  const components: GroupComparison['components'] = [];
  const k = Math.min(A[0]?.scores.length ?? 0, B[0]?.scores.length ?? 0);
  for (let j = 0; j < k; j++) {
    const sa = A.map((r) => r.scores[j] as number);
    const sb = B.map((r) => r.scores[j] as number);
    const cohen = (x: readonly number[], y: readonly number[]) => {
      const pooled = Math.sqrt(((x.length - 1) * sd(x) ** 2 + (y.length - 1) * sd(y) ** 2) / Math.max(1, x.length + y.length - 2));
      return pooled > 0 ? (mean(y) - mean(x)) / pooled : NaN;
    };
    const bs: number[] = [];
    for (let b = 0; b < Math.min(cfg.bootstraps, 400); b++) {
      const ia = bootstrapIndices(sa.length, rng);
      const ib = bootstrapIndices(sb.length, rng);
      bs.push(cohen(ia.map((i) => sa[i] as number), ib.map((i) => sb[i] as number)));
    }
    components.push({ index: j + 1, d: cohen(sa, sb), ci95: [quantileOf(bs, 0.025), quantileOf(bs, 0.975)] });
  }
  // split-half replication
  let rep = 0;
  let splits = 0;
  if (A.length >= 2 * 3 && B.length >= 2 * 3) {
    for (let s = 0; s < cfg.splits; s++) {
      const pa = shuffle(XA, rng);
      const pb = shuffle(XB, rng);
      const ha = Math.floor(pa.length / 2);
      const hb = Math.floor(pb.length / 2);
      const t1 = permutationMaxT(pa.slice(0, ha), pb.slice(0, hb), 199, rng);
      const t2 = permutationMaxT(pa.slice(ha), pb.slice(hb), 199, rng);
      const p1 = (1 + t1.null.filter((v) => v >= maxAbs(t1.obs)).length) / 200;
      const p2 = (1 + t2.null.filter((v) => v >= maxAbs(t2.obs)).length) / 200;
      if (p1 < cfg.alpha && p2 < cfg.alpha) rep++;
      splits++;
    }
  }
  const rmsTotalDeg = rmsOf(md);
  let verdict: DissociationVerdict;
  if (!outcome.equivalent) {
    verdict = 'outcome_not_equivalent';
    reasons.push(`outcome_difference_ci90_[${ci90[0].toFixed(1)},${ci90[1].toFixed(1)}]_not_within_±${cfg.marginDeg}`);
  } else if (pFwe < cfg.alpha && cfg.crossSession && !(rmsTotalDeg > (cfg.replacementMarginDeg ?? REPLACEMENT_MARGIN_DEG))) {
    verdict = 'within_replacement_margin';
    reasons.push(`cross_session_rms_${rmsTotalDeg.toFixed(2)}°_not_above_replacement_margin_${(cfg.replacementMarginDeg ?? REPLACEMENT_MARGIN_DEG).toFixed(2)}°`);
  } else if (pFwe < cfg.alpha) verdict = 'dissociation';
  else {
    verdict = 'no_coordination_difference';
    reasons.push(`p_fwe_${pFwe.toFixed(3)}`);
  }
  return {
    ...base,
    outcome,
    trajectory: { maxT, rmsTotalDeg, criticalT, pFwe, regions, meanDiff, rmsByChannel, shareByPhase },
    components,
    stability: { replication: splits ? rep / splits : NaN, splits },
    verdict,
    reasons,
  };
}

export interface PairComparison {
  a: string;
  b: string;
  outcomeDiff: number;
  outcomeWithinMargin: boolean;
  /** Total RMS difference of the phase-normalised curves, degrees. */
  rmsDeg: number;
  byChannel: { channel: ChannelId; rmsDeg: number; share: number }[];
  shareByPhase: { outbound: number; return: number };
  diff: Partial<Record<ChannelId, number[]>>;
  /** Reference: RMS distances between OUTCOME-EQUIVALENT pairs (|Δoutcome| ≤ margin) of the same reference group. */
  reference: { kind: string; pairs: number; p95: number; percentile: number } | null;
  exceedsTypicalVariability: boolean | null;
}

export function rmsDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] as number) - (b[i] as number)) ** 2;
  return Math.sqrt(s / Math.max(1, a.length));
}

/** Compare two single repetitions against the distribution of within-group pair distances. */
export function comparePair(a: RepVector, b: RepVector, channels: readonly ChannelId[], reference: { kind: string; groups: readonly (readonly RepVector[])[] } | null, marginDeg = DEFAULT_DISSOCIATION.marginDeg): PairComparison {
  const diff: PairComparison['diff'] = {};
  let tot = 0;
  const per = channels.map((c, ci) => {
    const seg = Array.from({ length: GRID }, (_, k) => (b.x[ci * GRID + k] as number) - (a.x[ci * GRID + k] as number));
    diff[c] = seg;
    const ss = seg.reduce((s, x) => s + x * x, 0);
    tot += ss;
    return { channel: c, ss, rmsDeg: Math.sqrt(ss / GRID) };
  });
  let out = 0;
  per.forEach((_, ci) => {
    for (let k = 0; k <= OUT_END; k++) out += ((diff[channels[ci] as ChannelId] as number[])[k] as number) ** 2;
  });
  const rms = rmsDistance(a.x, b.x);
  let ref: PairComparison['reference'] = null;
  if (reference) {
    const ds: number[] = [];
    for (const g of reference.groups)
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const gi = g[i] as RepVector;
          const gj = g[j] as RepVector;
          if (gi.id === a.id || gi.id === b.id || gj.id === a.id || gj.id === b.id) continue;
          // only outcome-equivalent reference pairs: otherwise the reference mixes performance differences into
          // "typical variability" and hides organisation differences (found in workspace testing, 2026-11-08)
          if (Math.abs(gi.outcome - gj.outcome) > marginDeg) continue;
          ds.push(rmsDistance(gi.x, gj.x));
        }
    if (ds.length >= 10) ref = { kind: reference.kind, pairs: ds.length, p95: quantileOf(ds, 0.95), percentile: ds.filter((x) => x < rms).length / ds.length };
  }
  return {
    a: a.id,
    b: b.id,
    outcomeDiff: b.outcome - a.outcome,
    outcomeWithinMargin: Math.abs(b.outcome - a.outcome) <= marginDeg,
    rmsDeg: rms,
    byChannel: per.map((p) => ({ channel: p.channel, rmsDeg: p.rmsDeg, share: tot > 0 ? p.ss / tot : 0 })),
    shareByPhase: { outbound: tot > 0 ? out / tot : NaN, return: tot > 0 ? 1 - out / tot : NaN },
    diff,
    reference: ref,
    exceedsTypicalVariability: ref ? rms > ref.p95 : null,
  };
}
