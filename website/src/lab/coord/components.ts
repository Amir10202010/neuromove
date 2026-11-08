// Kinematic coordination components — discretised functional PCA of phase-normalised multi-segment trajectories.
//
// Each repetition is one row: the concatenated, landmark-registered excursion curves of the chosen angle channels
// (all in degrees, so covariance PCA without re-scaling is appropriate; Daffertshofer et al. 2004). With equal grid
// spacing, PCA of the sampled curves is the discretised functional PCA of Ramsay & Silverman (2005, ch. 8).
// These are KINEMATIC coordination patterns, not muscle or neural synergies (no EMG is measured).
//
// The number of retained components is not chosen by a fixed explained-variance cut-off. A component k is retained
// only if ALL of these hold, for k = 1, 2, … consecutively (rule fixed before any data were analysed):
//   (1) its variance exceeds the 95th percentile of the k-th variance of column-permuted data (Horn's parallel
//       analysis, Horn 1965) — it is more than chance co-variation;
//   (2) its loading vector is reproducible: median Tucker congruence with bootstrap replicates ≥ 0.85
//       ("fair similarity", Lorenzo-Seva & ten Berge 2006);
//   (3) data sufficiency: n ≥ 10 repetitions in total and n ≥ 5·k + 5.
// Cross-validated reconstruction error (10-fold, held-out repetitions) is reported for every k as evidence of
// generalisation, not used as a cut-off.
//
// NMF is deliberately NOT used: its non-negativity assumption does not hold for signed excursion curves
// (trunk tilt and elbow excursions take both signs; Tresch et al. 2006 discuss when NMF is appropriate).

import { center, colMeans, column, congruence, project, reconstruct, svd, type Mat } from './linalg';
import { bootstrapIndices, createRng, median, quantileOf, shuffle } from './stats';

export interface PcaModel {
  mu: number[];
  /** d × r loadings (columns). */
  V: Mat;
  /** Component variances (eigenvalues of the covariance), descending. */
  variance: number[];
  explained: number[];
  cumulative: number[];
  /** n × r scores. */
  scores: Mat;
  n: number;
  d: number;
}

export function fitPca(X: Mat): PcaModel {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const mu = colMeans(X);
  const Xc = center(X, mu);
  const { U, s, V } = svd(Xc);
  const variance = s.map((x) => (x * x) / Math.max(1, n - 1));
  const tot = variance.reduce((a, b) => a + b, 0) || 1;
  const explained = variance.map((v) => v / tot);
  let c = 0;
  const cumulative = explained.map((e) => (c += e));
  const scores = U.map((row) => row.map((u, j) => u * (s[j] as number)));
  return { mu, V, variance, explained, cumulative, scores, n, d };
}

export interface ComponentSelection {
  k: number;
  status: 'supported' | 'no_structure' | 'insufficient_data';
  /** Observed component variances (first kMax) and the parallel-analysis 95th percentiles. */
  observed: number[];
  null95: number[];
  /** Median bootstrap congruence per component. */
  congruence: number[];
  /** Cross-validated reconstruction RMSE (degrees) using 0…kMax components. */
  cvRmse: number[];
  reasons: string[];
}

export interface SelectionOptions {
  seed: number;
  permutations: number;
  bootstraps: number;
  kMax: number;
  folds: number;
}

export const DEFAULT_SELECTION: SelectionOptions = { seed: 20261108, permutations: 60, bootstraps: 60, kMax: 6, folds: 10 };

export const SELECTION_RULE = { congruenceMin: 0.85, minReps: 10, repsPerComponent: 5 } as const;

export function selectComponents(X: Mat, o: SelectionOptions = DEFAULT_SELECTION): { model: PcaModel; selection: ComponentSelection } {
  const model = fitPca(X);
  const n = X.length;
  const kMax = Math.min(o.kMax, Math.max(0, n - 2), model.variance.length);
  const rng = createRng(o.seed);
  const reasons: string[] = [];
  // (1) parallel analysis: permute every column independently across repetitions
  const nullVals: number[][] = Array.from({ length: kMax }, () => []);
  for (let b = 0; b < o.permutations && kMax > 0; b++) {
    const cols = Array.from({ length: model.d }, (_, j) => shuffle(column(X, j), rng));
    const Xp = Array.from({ length: n }, (_, i) => cols.map((c) => c[i] as number));
    const pm = fitPca(Xp);
    for (let k = 0; k < kMax; k++) (nullVals[k] as number[]).push(pm.variance[k] ?? 0);
  }
  const null95 = nullVals.map((v) => quantileOf(v, 0.95));
  // (2) bootstrap congruence of loadings
  const cong: number[][] = Array.from({ length: kMax }, () => []);
  for (let b = 0; b < o.bootstraps && kMax > 0; b++) {
    const idx = bootstrapIndices(n, rng);
    if (new Set(idx).size < 3) continue;
    const bm = fitPca(idx.map((i) => X[i] as number[]));
    for (let k = 0; k < kMax; k++) {
      const vk = column(model.V, k);
      let best = 0;
      for (let j = 0; j < Math.min(kMax + 2, bm.V[0]?.length ?? 0); j++) best = Math.max(best, congruence(vk, column(bm.V, j)));
      (cong[k] as number[]).push(best);
    }
  }
  const congruenceMed = cong.map((c) => median(c));
  // (3) selection
  let k = 0;
  for (let j = 0; j < kMax; j++) {
    const okVar = (model.variance[j] as number) > (null95[j] as number);
    const okRep = (congruenceMed[j] as number) >= SELECTION_RULE.congruenceMin;
    const okN = n >= SELECTION_RULE.repsPerComponent * (j + 1) + 5;
    if (okVar && okRep && okN) k = j + 1;
    else {
      if (!okVar) reasons.push(`component_${j + 1}_within_parallel_null`);
      else if (!okRep) reasons.push(`component_${j + 1}_not_reproducible`);
      else reasons.push(`component_${j + 1}_needs_more_repetitions`);
      break;
    }
  }
  const cvRmse = crossValidatedRmse(X, kMax, o.folds, o.seed + 1);
  let status: ComponentSelection['status'] = k > 0 ? 'supported' : 'no_structure';
  if (n < SELECTION_RULE.minReps) {
    status = 'insufficient_data';
    reasons.unshift(`only_${n}_repetitions`);
  }
  return { model, selection: { k, status, observed: model.variance.slice(0, kMax), null95, congruence: congruenceMed, cvRmse, reasons } };
}

/** K-fold cross-validated reconstruction RMSE (deg) of held-out repetitions with 0…kMax components. */
export function crossValidatedRmse(X: Mat, kMax: number, folds: number, seed: number): number[] {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (n < 4 || !d) return [];
  const order = shuffle([...Array(n).keys()], createRng(seed));
  const F = Math.min(folds, n);
  const se = new Array<number>(kMax + 1).fill(0);
  let count = 0;
  for (let f = 0; f < F; f++) {
    const test = order.filter((_, i) => i % F === f);
    const train = order.filter((_, i) => i % F !== f);
    if (train.length < 3) continue;
    const m = fitPca(train.map((i) => X[i] as number[]));
    for (const i of test) {
      const x = X[i] as number[];
      const xc = x.map((v, j) => v - (m.mu[j] as number));
      for (let k = 0; k <= kMax; k++) {
        const kk = Math.min(k, m.V[0]?.length ?? 0);
        const sc = project(xc, m.V, kk);
        const xr = reconstruct(sc, m.V, m.mu);
        se[k]! += x.reduce((a, v, j) => a + (v - (xr[j] as number)) ** 2, 0);
      }
      count += d;
    }
  }
  return se.map((s) => Math.sqrt(s / count));
}

/** Share of each component's score variance that lies BETWEEN groups (e.g. participants, tasks, sessions). */
export function betweenGroupShare(scores: Mat, groups: readonly string[], k: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < k; j++) {
    const x = scores.map((r) => r[j] as number);
    const m = x.reduce((a, b) => a + b, 0) / x.length;
    const tot = x.reduce((a, b) => a + (b - m) ** 2, 0);
    const byG = new Map<string, number[]>();
    x.forEach((v, i) => {
      const g = groups[i] as string;
      if (!byG.has(g)) byG.set(g, []);
      (byG.get(g) as number[]).push(v);
    });
    let between = 0;
    for (const v of byG.values()) {
      const mg = v.reduce((a, b) => a + b, 0) / v.length;
      between += v.length * (mg - m) ** 2;
    }
    out.push(tot > 0 ? between / tot : NaN);
  }
  return out;
}

/** Project new repetitions onto an existing component model (used for held-out participants / sessions). */
export function projectRows(model: PcaModel, X: Mat, k: number): Mat {
  return X.map((x) =>
    project(
      x.map((v, j) => v - (model.mu[j] as number)),
      model.V,
      k,
    ),
  );
}

/** Per-channel share of a component's squared loadings (which segments the component involves). */
export function channelShares(loading: readonly number[], channels: readonly string[], grid: number): Record<string, number> {
  const out: Record<string, number> = {};
  let tot = 0;
  channels.forEach((c, ci) => {
    let s = 0;
    for (let k = 0; k < grid; k++) s += (loading[ci * grid + k] as number) ** 2;
    out[c] = s;
    tot += s;
  });
  for (const c of channels) out[c] = tot > 0 ? (out[c] as number) / tot : 0;
  return out;
}

/**
 * Performance-adjusted representation: every feature column is residualised on the task outcome by ordinary least
 * squares (x_ij − β_j (y_i − ȳ)). Removes the part of trajectory variation that is linearly explained by how far the
 * repetition went, so components and strategies describe movement ORGANISATION at a given performance level rather
 * than performance itself. Units stay degrees. β is returned so the adjustment can be inspected and re-applied.
 */
export function residualizeOnOutcome(X: Mat, y: readonly number[]): { X: Mat; beta: number[]; yMean: number } {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const ym = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const yc = y.map((v) => v - ym);
  const syy = yc.reduce((a, v) => a + v * v, 0);
  const beta = new Array<number>(d).fill(0);
  if (syy > 1e-9) {
    const mu = colMeans(X);
    for (let j = 0; j < d; j++) {
      let sxy = 0;
      for (let i = 0; i < n; i++) sxy += (((X[i] as number[])[j] as number) - (mu[j] as number)) * (yc[i] as number);
      beta[j] = sxy / syy;
    }
  }
  return { X: X.map((row, i) => row.map((v, j) => v - (beta[j] as number) * (yc[i] as number))), beta, yMean: ym };
}
