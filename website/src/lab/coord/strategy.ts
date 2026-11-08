// Movement-strategy discovery in the coordination-component space, with an explicit right to say "no".
//
// Model: Gaussian mixture with diagonal covariances fitted by EM (Dempster, Laird & Rubin 1977), K = 1 … Kmax,
// k-means++ initialisation with seeded restarts. Diagonal covariances because the scores are PCA scores
// (uncorrelated overall) and full covariances need K·p(p+1)/2 parameters that a few dozen repetitions cannot
// support. ADAPTED from the standard algorithm as in scikit-learn's GaussianMixture(covariance_type='diag');
// agreement benchmarked in research/algorithm-benchmarking.md.
//
// Decision rule — fixed before any analysis (research/mcse-validation.md §2):
//   K selection            the smallest K whose BIC is within 6 of the minimum (parsimony; fixed during development
//                          on one synthetic example, BEFORE the validation suite was run)
//   insufficient_data      n < 12 repetitions
//   single_pattern         BIC prefers K = 1, or the best K > 1 improves BIC by < 10 ("very strong" evidence
//                          threshold, Kass & Raftery 1995)
//   multiple_strategies    BIC gain ≥ 10 AND every one of:
//                            smallest cluster ≥ max(3, 10 % of n)
//                            bootstrap stability: median ARI ≥ 0.8 between bootstrap-refitted and full labels
//                            every cluster's median Jaccard recovery ≥ 0.75 (Hennig 2007)
//                            Ward hierarchical clustering at the same K agrees: ARI ≥ 0.7
//                            separation: every pair of cluster means ≥ 2 pooled within-cluster SDs apart
//                            co-occurrence: with several sessions, at least one session contains ≥ 2 members of
//                            each of two clusters. Clusters that only ever separate whole sessions cannot be told
//                            apart from sensor re-placement between sessions (validation run 1, §3)
//   inconclusive           BIC gain ≥ 10 but any check above fails (reasons listed)
// Assignments with posterior < 0.8 are reported as "uncertain" and never counted as a strategy occurrence.
// Labels are neutral (A, B, …) in order of first appearance; they carry no clinical meaning.

import { adjustedRand, bootstrapIndices, createRng, jaccard, median, type Rng } from './stats';
import type { Mat } from './linalg';

export interface Gmm {
  K: number;
  weights: number[];
  means: Mat;
  vars: Mat;
  logLik: number;
  bic: number;
  params: number;
}

const LOG2PI = Math.log(2 * Math.PI);

function logPdfDiag(x: readonly number[], m: readonly number[], v: readonly number[]): number {
  let s = 0;
  for (let j = 0; j < x.length; j++) s += -0.5 * (LOG2PI + Math.log(v[j] as number) + ((x[j] as number) - (m[j] as number)) ** 2 / (v[j] as number));
  return s;
}

function logSumExp(a: readonly number[]): number {
  const m = Math.max(...a);
  if (!Number.isFinite(m)) return m;
  return m + Math.log(a.reduce((s, x) => s + Math.exp(x - m), 0));
}

export function responsibilities(g: Gmm, Z: Mat): { R: Mat; logLik: number } {
  let ll = 0;
  const R = Z.map((x) => {
    const lp = g.means.map((m, k) => Math.log(g.weights[k] as number) + logPdfDiag(x, m, g.vars[k] as number[]));
    const l = logSumExp(lp);
    ll += l;
    return lp.map((v) => Math.exp(v - l));
  });
  return { R, logLik: ll };
}

function kmeansPP(Z: Mat, K: number, rng: Rng): Mat {
  const n = Z.length;
  const centers: Mat = [[...(Z[Math.floor(rng.next() * n)] as number[])]];
  while (centers.length < K) {
    const d2 = Z.map((x) => Math.min(...centers.map((c) => x.reduce((a, v, j) => a + (v - (c[j] as number)) ** 2, 0))));
    const tot = d2.reduce((a, b) => a + b, 0);
    let r = rng.next() * tot;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= d2[i] as number;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centers.push([...(Z[pick] as number[])]);
  }
  return centers;
}

export interface GmmOptions {
  restarts: number;
  maxIter: number;
  tol: number;
  seed: number;
}

export const DEFAULT_GMM: GmmOptions = { restarts: 8, maxIter: 300, tol: 1e-7, seed: 11 };

export function fitGmm(Z: Mat, K: number, o: GmmOptions = DEFAULT_GMM): Gmm {
  const n = Z.length;
  const p = Z[0]?.length ?? 0;
  const rng = createRng(o.seed + 7919 * K);
  // variance floor: 1e-3 of the overall per-dimension variance (prevents collapse onto single points)
  const mu = Array.from({ length: p }, (_, j) => Z.reduce((a, x) => a + (x[j] as number), 0) / n);
  const v0 = Array.from({ length: p }, (_, j) => Z.reduce((a, x) => a + ((x[j] as number) - (mu[j] as number)) ** 2, 0) / Math.max(1, n - 1));
  const floor = v0.map((v) => Math.max(1e-9, 1e-3 * v));
  let best: Gmm | null = null;
  for (let r = 0; r < (K === 1 ? 1 : o.restarts); r++) {
    let means = K === 1 ? [mu] : kmeansPP(Z, K, rng);
    let vars = Array.from({ length: K }, () => [...v0.map((v, j) => Math.max(v, floor[j] as number))]);
    let weights = new Array<number>(K).fill(1 / K);
    let prev = -Infinity;
    for (let it = 0; it < o.maxIter; it++) {
      const g: Gmm = { K, weights, means, vars, logLik: 0, bic: 0, params: 0 };
      const e = responsibilities(g, Z);
      const ll = e.logLik;
      const Nk = Array.from({ length: K }, (_, k) => e.R.reduce((a, rr) => a + (rr[k] as number), 0));
      if (Nk.some((x) => x < 1e-6)) break;
      weights = Nk.map((x) => x / n);
      means = Array.from({ length: K }, (_, k) => Array.from({ length: p }, (_, j) => e.R.reduce((a, rr, i) => a + (rr[k] as number) * ((Z[i] as number[])[j] as number), 0) / (Nk[k] as number)));
      vars = Array.from({ length: K }, (_, k) => Array.from({ length: p }, (_, j) => Math.max(floor[j] as number, e.R.reduce((a, rr, i) => a + (rr[k] as number) * (((Z[i] as number[])[j] as number) - ((means[k] as number[])[j] as number)) ** 2, 0) / (Nk[k] as number))));
      if (Math.abs(ll - prev) < o.tol * Math.max(1, Math.abs(ll))) break;
      prev = ll;
    }
    const fin = responsibilities({ K, weights, means, vars, logLik: 0, bic: 0, params: 0 }, Z).logLik;
    const params = K * p * 2 + (K - 1);
    const cand: Gmm = { K, weights, means, vars, logLik: fin, bic: -2 * fin + params * Math.log(n), params };
    if (Number.isFinite(fin) && (!best || cand.logLik > best.logLik)) best = cand;
  }
  return best as Gmm;
}

export function hardLabels(R: Mat): number[] {
  return R.map((r) => r.indexOf(Math.max(...r)));
}

/** Ward agglomerative clustering (Lance–Williams update), cut at K clusters. O(n³), fine for n ≤ a few hundred. */
export function wardClusters(Z: Mat, K: number): number[] {
  const n = Z.length;
  const D: number[][] = Z.map((a) => Z.map((b) => a.reduce((s, v, j) => s + (v - (b[j] as number)) ** 2, 0)));
  const size = new Array<number>(n).fill(1);
  const alive = new Array<boolean>(n).fill(true);
  const label = [...Array(n).keys()];
  let clusters = n;
  while (clusters > K) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!alive[j]) continue;
        const d = (D[i] as number[])[j] as number;
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    // merge j into i
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === bi || k === bj) continue;
      const ni = size[bi] as number;
      const nj = size[bj] as number;
      const nk = size[k] as number;
      const d = ((ni + nk) * ((D[bi] as number[])[k] as number) + (nj + nk) * ((D[bj] as number[])[k] as number) - nk * bd) / (ni + nj + nk);
      (D[bi] as number[])[k] = d;
      (D[k] as number[])[bi] = d;
    }
    size[bi] = (size[bi] as number) + (size[bj] as number);
    alive[bj] = false;
    for (let k = 0; k < n; k++) if (label[k] === bj) label[k] = bi;
    clusters--;
  }
  const map = new Map<number, number>();
  return label.map((l) => {
    if (!map.has(l)) map.set(l, map.size);
    return map.get(l) as number;
  });
}

export const STRATEGY_RULE = {
  minReps: 12,
  deltaBic: 10,
  minClusterFraction: 0.1,
  minClusterSize: 3,
  bootstrapAri: 0.8,
  jaccard: 0.75,
  wardAri: 0.7,
  separationSd: 2,
  posterior: 0.8,
  kMax: 4,
  parsimonyBic: 6,
} as const;

export type StrategyVerdict = 'insufficient_data' | 'single_pattern' | 'multiple_strategies' | 'inconclusive';

export interface StrategyAssignment {
  /** Neutral label ('A', 'B', …) or null when uncertain / no supported strategies. */
  label: string | null;
  /** Posterior probability of the most likely component. */
  posterior: number;
  /** Posteriors per label, in label order. */
  posteriors: number[];
}

export interface StrategyDiscovery {
  verdict: StrategyVerdict;
  reasons: string[];
  n: number;
  dims: number;
  bic: { K: number; bic: number; logLik: number }[];
  bestK: number;
  deltaBic: number;
  /** Labels in order of first appearance. */
  labels: string[];
  assignments: StrategyAssignment[];
  checks: { minClusterSize: number; bootstrapAriMedian: number; jaccard: number[]; wardAri: number; minSeparationSd: number } | null;
  model: Gmm | null;
}

export function discoverStrategies(Z: Mat, o: { seed: number; bootstraps: number; sessions?: readonly string[] } = { seed: 5, bootstraps: 40 }): StrategyDiscovery {
  const n = Z.length;
  const dims = Z[0]?.length ?? 0;
  const reasons: string[] = [];
  const empty = (verdict: StrategyVerdict): StrategyDiscovery => ({ verdict, reasons, n, dims, bic: [], bestK: 1, deltaBic: 0, labels: [], assignments: Z.map(() => ({ label: null, posterior: NaN, posteriors: [] })), checks: null, model: null });
  if (!dims) {
    reasons.push('no_coordination_components');
    return empty(n < STRATEGY_RULE.minReps ? 'insufficient_data' : 'single_pattern');
  }
  if (n < STRATEGY_RULE.minReps) {
    reasons.push(`only_${n}_repetitions_(minimum_${STRATEGY_RULE.minReps})`);
    return empty('insufficient_data');
  }
  const Kmax = Math.min(STRATEGY_RULE.kMax, Math.floor(n / 6));
  const fits: Gmm[] = [];
  for (let K = 1; K <= Kmax; K++) {
    const g = fitGmm(Z, K, { ...DEFAULT_GMM, seed: o.seed });
    if (g) fits.push(g);
  }
  const bic = fits.map((g) => ({ K: g.K, bic: g.bic, logLik: g.logLik }));
  const g1 = fits[0] as Gmm;
  // parsimony: the smallest K whose BIC is within ΔBIC ≤ 6 ("strong" evidence band, Kass & Raftery 1995) of the minimum
  const minBic = Math.min(...fits.map((g) => g.bic));
  const best = fits.find((g) => g.bic - minBic <= STRATEGY_RULE.parsimonyBic) ?? g1;
  const deltaBic = g1.bic - best.bic;
  const base: Omit<StrategyDiscovery, 'verdict' | 'labels' | 'assignments' | 'checks' | 'model'> = { reasons, n, dims, bic, bestK: best.K, deltaBic };
  if (best.K === 1 || deltaBic < STRATEGY_RULE.deltaBic) {
    reasons.push(best.K === 1 ? 'bic_prefers_one_pattern' : `bic_gain_${deltaBic.toFixed(1)}_below_${STRATEGY_RULE.deltaBic}`);
    return { ...base, verdict: 'single_pattern', labels: ['A'], assignments: Z.map(() => ({ label: 'A', posterior: 1, posteriors: [1] })), checks: null, model: g1 };
  }
  const { R } = responsibilities(best, Z);
  const hard = hardLabels(R);
  const sizes = Array.from({ length: best.K }, (_, k) => hard.filter((h) => h === k).length);
  const minSize = Math.min(...sizes);
  // bootstrap stability
  const rng = createRng(o.seed + 101);
  const aris: number[] = [];
  const jac: number[][] = Array.from({ length: best.K }, () => []);
  for (let b = 0; b < o.bootstraps; b++) {
    const idx = bootstrapIndices(n, rng);
    const gb = fitGmm(idx.map((i) => Z[i] as number[]), best.K, { ...DEFAULT_GMM, restarts: 4, seed: o.seed + b });
    if (!gb) continue;
    const lb = hardLabels(responsibilities(gb, Z).R);
    aris.push(adjustedRand(hard, lb));
    for (let k = 0; k < best.K; k++) {
      const C = new Set(hard.map((h, i) => (h === k ? i : -1)).filter((i) => i >= 0));
      let bj = 0;
      for (let m = 0; m < best.K; m++) bj = Math.max(bj, jaccard(C, new Set(lb.map((h, i) => (h === m ? i : -1)).filter((i) => i >= 0))));
      (jac[k] as number[]).push(bj);
    }
  }
  const ariMed = median(aris);
  const jMed = jac.map((j) => median(j));
  const ward = wardClusters(Z, best.K);
  const wardAri = adjustedRand(hard, ward);
  // separation in pooled within-cluster SD units
  let minSep = Infinity;
  for (let a = 0; a < best.K; a++)
    for (let b = a + 1; b < best.K; b++) {
      let s = 0;
      for (let j = 0; j < dims; j++) {
        const pooled = ((best.vars[a] as number[])[j] as number) / 2 + ((best.vars[b] as number[])[j] as number) / 2;
        s += (((best.means[a] as number[])[j] as number) - ((best.means[b] as number[])[j] as number)) ** 2 / pooled;
      }
      minSep = Math.min(minSep, Math.sqrt(s));
    }
  const checks = { minClusterSize: minSize, bootstrapAriMedian: ariMed, jaccard: jMed, wardAri, minSeparationSd: minSep };
  const needSize = Math.max(STRATEGY_RULE.minClusterSize, Math.ceil(STRATEGY_RULE.minClusterFraction * n));
  if (minSize < needSize) reasons.push(`smallest_cluster_${minSize}_below_${needSize}`);
  if (!(ariMed >= STRATEGY_RULE.bootstrapAri)) reasons.push(`bootstrap_ari_${ariMed.toFixed(2)}_below_${STRATEGY_RULE.bootstrapAri}`);
  jMed.forEach((j, k) => {
    if (!(j >= STRATEGY_RULE.jaccard)) reasons.push(`cluster_${k + 1}_jaccard_${j.toFixed(2)}_below_${STRATEGY_RULE.jaccard}`);
  });
  if (!(wardAri >= STRATEGY_RULE.wardAri)) reasons.push(`ward_agreement_${wardAri.toFixed(2)}_below_${STRATEGY_RULE.wardAri}`);
  if (!(minSep >= STRATEGY_RULE.separationSd)) reasons.push(`separation_${minSep.toFixed(2)}sd_below_${STRATEGY_RULE.separationSd}`);
  if (o.sessions && new Set(o.sessions).size > 1) {
    const ses = o.sessions;
    const cooccur = [...new Set(ses)].some((sid) => {
      const inS = hard.filter((_, i) => ses[i] === sid);
      return Array.from({ length: best.K }, (_, k) => inS.filter((h) => h === k).length).filter((c) => c >= 2).length >= 2;
    });
    if (!cooccur) reasons.push('clusters_coincide_with_sessions_(sensor_re-placement_cannot_be_excluded)');
  }
  const verdict: StrategyVerdict = reasons.length ? 'inconclusive' : 'multiple_strategies';
  // neutral labels by first appearance
  const order: number[] = [];
  for (const h of hard) if (!order.includes(h)) order.push(h);
  const labels = order.map((_, i) => String.fromCharCode(65 + i));
  const assignments: StrategyAssignment[] = R.map((r) => {
    const post = order.map((k) => r[k] as number);
    const mx = Math.max(...post);
    const li = post.indexOf(mx);
    return { label: verdict === 'multiple_strategies' && mx >= STRATEGY_RULE.posterior ? (labels[li] as string) : null, posterior: mx, posteriors: post };
  });
  return { ...base, verdict, labels, assignments, checks, model: best };
}
