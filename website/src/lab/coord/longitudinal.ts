// Longitudinal coordination analysis — how one participant's movement organisation changes over sessions, kept
// strictly separate from how their task PERFORMANCE changes.
//
// Layers (never merged into one score):
//   observed performance      task outcome per repetition (degrees)
//   observed coordination     phase-normalised multi-segment curves; distances in degrees
//   statistical assignments   strategy labels with posteriors (strategy.ts)
//   model-derived             component scores, Markov transition estimates
//   hypotheses                NOT computed here (e.g. "explores before stabilising" is a pattern to examine,
//                             not a finding the engine asserts)
//
// Integration with the existing Motor Learning engine: per-session series of coordination metrics are converted to
// the existing ModelData format and passed to lab/fit.ts compareModels — the SAME pre-specified model set
// (stationary always a candidate) and selection rule — instead of re-implementing learning curves here.

import type { ModelData } from '../dataset';
import { compareModels, type Comparison } from '../fit';
import type { ModelId } from '../models';
import { REPLACEMENT_MARGIN_DEG, rmsDistance, type RepVector } from './dissociation';
import { congruence, column } from './linalg';
import { fitPca, type PcaModel } from './components';
import { bootstrapIndices, createRng, dirichletSample, entropyMillerMadow, mean, quantileOf, shuffle } from './stats';

export interface SessionRep extends RepVector {
  sessionId: string;
  sessionIndex: number;
  /** Days since the participant's first analysed session. */
  day: number;
  /** Confident strategy label or null. */
  label: string | null;
}

export interface SessionMetrics {
  sessionId: string;
  sessionIndex: number;
  day: number;
  n: number;
  outcome: { mean: number; sd: number };
  counts: Record<string, number>;
  uncertain: number;
  entropyBits: { value: number; ci95: [number, number] } | null;
  /** Mean RMS distance of repetitions to the session mean curve, degrees (coordination variability). */
  variabilityDeg: { value: number; ci95: [number, number] };
  /**
   * RMS distance of the session mean curve from the baseline (first session) mean curve, degrees; p from a
   * permutation test; `changed` only when p < 0.05 AND the distance exceeds the sensor re-placement margin
   * (sessions are recorded with re-attached sensors, so a significant but small difference may be re-placement).
   */
  fromBaselineDeg: { value: number; ci95: [number, number]; p: number | null; marginDeg: number; changed: boolean } | null;
  /** RMS distance from the previous session's mean curve, degrees. */
  fromPreviousDeg: number | null;
  /** Tucker congruence of this session's first components with the pooled components (n ≥ 10 only). */
  componentCongruence: number[] | null;
}

export interface TransitionModel {
  labels: string[];
  counts: number[][];
  /** Dirichlet(1) posterior mean and 95 % credible interval per transition. */
  posterior: { mean: number[][]; lo: number[][]; hi: number[][] };
  /** Observed proportion of consecutive confident repetitions that change strategy. */
  switchRate: number;
  /** Permutation test of persistence: P(switch rate ≤ observed | order shuffled within sessions). */
  persistenceP: number | null;
  /** Labels absent for ≥ 1 whole session and then observed again. */
  reappearing: string[];
  pairs: number;
}

export interface LongitudinalResult {
  sessions: SessionMetrics[];
  transitions: TransitionModel | null;
  /** Existing-engine model comparison for performance and coordination series (null if < 3 sessions). */
  models: { metric: 'outcome' | 'coord_from_baseline' | 'coord_variability'; selected: ModelId | null; reason: string[]; comparison: Comparison | null }[];
  notes: string[];
}

function meanCurve(xs: readonly number[][]): number[] {
  const d = xs[0]?.length ?? 0;
  return Array.from({ length: d }, (_, j) => mean(xs.map((x) => x[j] as number)));
}

function ci(vals: readonly number[]): [number, number] {
  return [quantileOf(vals, 0.025), quantileOf(vals, 0.975)];
}

export function longitudinal(reps: readonly SessionRep[], pooled: PcaModel | null, k: number, seed = 31): LongitudinalResult {
  const rng = createRng(seed);
  const notes: string[] = [];
  const bySession = new Map<string, SessionRep[]>();
  for (const r of reps) {
    if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
    (bySession.get(r.sessionId) as SessionRep[]).push(r);
  }
  const sessions = [...bySession.values()].sort((a, b) => (a[0] as SessionRep).sessionIndex - (b[0] as SessionRep).sessionIndex);
  const labels = [...new Set(reps.map((r) => r.label).filter((l): l is string => l !== null))].sort();
  const base = sessions[0];
  const baseMean = base ? meanCurve(base.map((r) => r.x)) : null;
  let prevMean: number[] | null = null;
  const out: SessionMetrics[] = sessions.map((s) => {
    const X = s.map((r) => r.x);
    const mu = meanCurve(X);
    const counts: Record<string, number> = {};
    for (const l of labels) counts[l] = s.filter((r) => r.label === l).length;
    const uncertain = s.filter((r) => r.label === null).length;
    const confident = labels.map((l) => counts[l] as number);
    const nConf = confident.reduce((a, b) => a + b, 0);
    let entropy: SessionMetrics['entropyBits'] = null;
    if (labels.length > 1 && nConf >= 3) {
      const boots: number[] = [];
      const confReps = s.filter((r) => r.label !== null);
      for (let b = 0; b < 500; b++) {
        const idx = bootstrapIndices(confReps.length, rng);
        boots.push(entropyMillerMadow(labels.map((l) => idx.filter((i) => (confReps[i] as SessionRep).label === l).length)));
      }
      entropy = { value: entropyMillerMadow(confident), ci95: ci(boots) };
    }
    const variability = (rows: readonly number[][]) => {
      const m = meanCurve(rows);
      return mean(rows.map((x) => rmsDistance(x, m)));
    };
    const vb: number[] = [];
    for (let b = 0; b < 300 && X.length > 1; b++) vb.push(variability(bootstrapIndices(X.length, rng).map((i) => X[i] as number[])));
    let fromBase: SessionMetrics['fromBaselineDeg'] = null;
    if (baseMean && base && s !== base) {
      const BX = base.map((r) => r.x);
      const obs = rmsDistance(mu, baseMean);
      const bb: number[] = [];
      for (let b = 0; b < 300; b++) bb.push(rmsDistance(meanCurve(bootstrapIndices(X.length, rng).map((i) => X[i] as number[])), meanCurve(bootstrapIndices(BX.length, rng).map((i) => BX[i] as number[]))));
      // permutation test: exchange session labels between this session and baseline
      let p: number | null = null;
      if (X.length >= 3 && BX.length >= 3) {
        const pool = [...X, ...BX];
        let ge = 0;
        const P = 500;
        for (let q = 0; q < P; q++) {
          const sh = shuffle(pool, rng);
          if (rmsDistance(meanCurve(sh.slice(0, X.length)), meanCurve(sh.slice(X.length))) >= obs) ge++;
        }
        p = (1 + ge) / (P + 1);
      }
      fromBase = { value: obs, ci95: ci(bb), p, marginDeg: REPLACEMENT_MARGIN_DEG, changed: p !== null && p < 0.05 && obs > REPLACEMENT_MARGIN_DEG };
    }
    let cong: number[] | null = null;
    if (pooled && k > 0 && X.length >= 10) {
      const sm = fitPca(X);
      cong = Array.from({ length: k }, (_, j) => {
        let best = 0;
        for (let m = 0; m < Math.min(k + 2, sm.V[0]?.length ?? 0); m++) best = Math.max(best, congruence(column(pooled.V, j), column(sm.V, m)));
        return best;
      });
    }
    const first = s[0] as SessionRep;
    const res: SessionMetrics = {
      sessionId: first.sessionId,
      sessionIndex: first.sessionIndex,
      day: first.day,
      n: s.length,
      outcome: { mean: mean(s.map((r) => r.outcome)), sd: s.length > 1 ? Math.sqrt(s.reduce((a, r) => a + (r.outcome - mean(s.map((q) => q.outcome))) ** 2, 0) / (s.length - 1)) : NaN },
      counts,
      uncertain,
      entropyBits: entropy,
      variabilityDeg: { value: X.length > 1 ? variability(X) : NaN, ci95: ci(vb) },
      fromBaselineDeg: fromBase,
      fromPreviousDeg: prevMean ? rmsDistance(mu, prevMean) : null,
      componentCongruence: cong,
    };
    prevMean = mu;
    return res;
  });

  const transitions = labels.length > 1 ? markov(sessions, labels, rng) : null;
  if (labels.length <= 1) notes.push('strategy_transitions_not_estimated_(fewer_than_two_supported_strategies)');

  // existing-engine model comparison on per-session series
  const models: LongitudinalResult['models'] = [];
  if (sessions.length >= 3 && baseMean) {
    const series = (metric: LongitudinalResult['models'][number]['metric'], perRep: (r: SessionRep, sessionMean: number[]) => number) => {
      const rows = sessions.map((s) => {
        const mu = meanCurve(s.map((r) => r.x));
        const v = s.map((r) => perRep(r, mu));
        const m = mean(v);
        return { t: (s[0] as SessionRep).day, v, m, id: (s[0] as SessionRep).sessionId };
      });
      const t0 = rows[0]?.t ?? 0;
      const data: ModelData = {
        t: rows.map((r) => r.t - t0),
        y: rows.map((r) => r.m),
        n: rows.map((r) => r.v.length),
        dose: rows.map((_, i) => (i === 0 ? 0 : 1)),
        ss: rows.map((r) => r.v.reduce((a, x) => a + (x - r.m) ** 2, 0)),
        sessionIds: rows.map((r) => r.id),
      };
      try {
        const c = compareModels(data, { doseMode: 'per_visit' });
        models.push({ metric, selected: c.selected, reason: c.selectionReason, comparison: c });
      } catch {
        models.push({ metric, selected: null, reason: ['model_comparison_failed'], comparison: null });
      }
    };
    series('outcome', (r) => r.outcome);
    series('coord_from_baseline', (r) => rmsDistance(r.x, baseMean));
    series('coord_variability', (r, mu) => rmsDistance(r.x, mu));
  } else notes.push('fewer_than_3_sessions:_learning_models_not_fitted');
  return { sessions: out, transitions, models, notes };
}

function markov(sessions: readonly SessionRep[][], labels: readonly string[], rng: ReturnType<typeof createRng>): TransitionModel {
  const K = labels.length;
  const idx = (l: string) => labels.indexOf(l);
  const countSwitches = (seqs: readonly (string | null)[][]) => {
    const C = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    let pairs = 0;
    let sw = 0;
    for (const seq of seqs)
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1];
        const b = seq[i];
        if (a === null || b === null || a === undefined || b === undefined) continue; // uncertain breaks the chain
        (C[idx(a)] as number[])[idx(b)]!++;
        pairs++;
        if (a !== b) sw++;
      }
    return { C, pairs, sw };
  };
  const seqs = sessions.map((s) => s.map((r) => r.label));
  const { C, pairs, sw } = countSwitches(seqs);
  const draws = 2000;
  const samples: number[][][] = C.map(() => []);
  for (let d = 0; d < draws; d++) C.forEach((row, i) => (samples[i] as number[][]).push(dirichletSample(row.map((c) => c + 1), rng)));
  const meanM = C.map((row) => {
    const tot = row.reduce((a, b) => a + b, 0) + K;
    return row.map((c) => (c + 1) / tot);
  });
  const lo = samples.map((s) => Array.from({ length: K }, (_, j) => quantileOf(s.map((v) => v[j] as number), 0.025)));
  const hi = samples.map((s) => Array.from({ length: K }, (_, j) => quantileOf(s.map((v) => v[j] as number), 0.975)));
  const rate = pairs ? sw / pairs : NaN;
  let persistenceP: number | null = null;
  if (pairs >= 5) {
    let le = 0;
    const P = 1000;
    for (let q = 0; q < P; q++) {
      const sh = countSwitches(seqs.map((s) => shuffle(s, rng)));
      if (sh.pairs && sh.sw / sh.pairs <= rate) le++;
    }
    persistenceP = (1 + le) / (P + 1);
  }
  const present = sessions.map((s) => new Set(s.map((r) => r.label).filter(Boolean)));
  const reappearing = labels.filter((l) => {
    let seen = false;
    let gap = false;
    for (const p of present) {
      if (p.has(l)) {
        if (seen && gap) return true;
        seen = true;
        gap = false;
      } else if (seen) gap = true;
    }
    return false;
  });
  return { labels: [...labels], counts: C, posterior: { mean: meanM, lo, hi }, switchRate: rate, persistenceP, reappearing, pairs };
}
