// What happens to performance ACROSS the repetitions of one sitting — and what that can and cannot be called.
//
// A run of repetitions can get better (warm-up, practice), get worse (fatigue, loss of attention, discomfort), do
// both in turn, or neither. Inertial sensors see only the kinematic pattern; they do not see why. So the analysis
// returns a PATTERN ('practice_like', 'decline_like', 'rise_then_decline', …), never a diagnosis of fatigue, and
// says 'mixed' or 'no_trend_detected' when the features disagree or the evidence is thin.
//
// Per feature (in repetition order), three nested least-squares models are compared by AICc with the lab's
// parsimony rule (ΔAICc ≤ 2 → the simplest):
//     constant            y_r = a
//     linear              y_r = a + b·r
//     broken stick        y_r = a + b·r + c·(r − r*)₊      one change of slope at r*, continuous (grid over r*)
// The direction of change is expressed on a common "performance-up" convention so that features can be combined:
//     larger amplitude, higher peak rate, SHORTER duration, smoother (SPARC closer to 0)  = up
// This convention orders the axis only; it is not a statement that "up" is clinically better for a given child.
// Whether a feature departs from a constant level at all is decided by ONE permutation test per feature: the
// statistic is the largest AICc improvement over the constant model among the linear and all broken-stick fits, its
// null distribution comes from permuting the repetition order (which accounts for having searched over the break
// position), and the p-values are Holm-adjusted across the features of a sitting. The shape is read only for
// features that pass. (Run 1 of benchmark W1 selected shapes by AICc alone and reported a pattern in 12 % of
// trend-free sittings; the permutation test was added for that reason.)
//
// Needs: ≥ 8 repetitions for a trend, ≥ 12 for a change of slope. A clinic assessment step (3 repetitions) is
// therefore always 'insufficient_repetitions' — within-session dynamics need a practice sitting.

import { createRng, type Rng } from '../../lib/random';
import { tCdf } from '../../research/stats';

export const WITHIN_FEATURES = ['amplitude', 'peak_rate', 'duration', 'smoothness'] as const;
export type WithinFeature = (typeof WITHIN_FEATURES)[number];

/** +1: an increase of the value is "performance-up"; −1: a decrease is. */
export const PERFORMANCE_UP: Record<WithinFeature, 1 | -1> = { amplitude: 1, peak_rate: 1, duration: -1, smoothness: 1 };

export const WITHIN_RULE = { minTrend: 8, minBreak: 12, alpha: 0.05, parsimony: 2, minSegment: 4, permutations: 499 } as const;

export type TrendShape = 'constant' | 'linear' | 'broken_stick';

export interface FeatureDynamics {
  feature: WithinFeature;
  n: number;
  shape: TrendShape;
  /** AICc of the three models (NaN when a model could not be fitted). */
  aicc: Record<TrendShape, number>;
  /** Linear slope per repetition (always reported for n ≥ minTrend) and its SE. */
  slope: number | null;
  slopeSe: number | null;
  /** Two-sided p of the linear slope alone (descriptive). */
  pLinear: number | null;
  /** Permutation p of "no departure from a constant level" (linear or broken stick, break position searched). */
  p: number | null;
  /** Holm-adjusted across the features of the sitting. */
  pHolm: number | null;
  /** Broken stick: repetition index (0-based) where the slope changes, and the slope before / after it. */
  breakAt: number | null;
  slopeBefore: number | null;
  slopeAfter: number | null;
  /** Direction on the performance-up convention: 'up', 'down', 'up_then_down', 'down_then_up' or 'none'. */
  direction: 'up' | 'down' | 'up_then_down' | 'down_then_up' | 'none';
}

export type SittingPattern = 'insufficient_repetitions' | 'no_trend_detected' | 'practice_like' | 'decline_like' | 'rise_then_decline' | 'mixed';

export interface SittingDynamics {
  pattern: SittingPattern;
  reasons: string[];
  features: FeatureDynamics[];
  notes: string[];
}

function aicc(rss: number, n: number, k: number): number {
  // k counts mean-structure parameters + the residual variance
  if (!(rss > 0) || n - k - 1 <= 0) return NaN;
  return n * Math.log(rss / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
}

/** Ordinary least squares with a small design matrix (columns given); returns coefficients and RSS. */
function ols(cols: readonly (readonly number[])[], y: readonly number[]): { beta: number[]; rss: number } | null {
  const p = cols.length;
  const n = y.length;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < p; b++) for (let i = 0; i < n; i++) A[a]![b] = (A[a]![b] as number) + ((cols[a] as number[])[i] as number) * ((cols[b] as number[])[i] as number);
    for (let i = 0; i < n; i++) A[a]![p] = (A[a]![p] as number) + ((cols[a] as number[])[i] as number) * (y[i] as number);
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r]![c] as number) > Math.abs(A[piv]![c] as number)) piv = r;
    if (Math.abs(A[piv]![c] as number) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv] as number[], A[c] as number[]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = (A[r]![c] as number) / (A[c]![c] as number);
      for (let j = c; j <= p; j++) A[r]![j] = (A[r]![j] as number) - f * (A[c]![j] as number);
    }
  }
  const beta = A.map((row, i) => (row[p] as number) / (row[i] as number));
  let rss = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let a = 0; a < p; a++) f += (beta[a] as number) * ((cols[a] as number[])[i] as number);
    rss += ((y[i] as number) - f) ** 2;
  }
  return { beta, rss };
}

interface Fits {
  a0: number;
  a1: number;
  a2: number;
  slope: number;
  se: number;
  pLinear: number;
  brk: { at: number; before: number; after: number } | null;
  /** Largest AICc improvement over the constant model. */
  gain: number;
}

function fitShapes(y: readonly number[]): Fits | null {
  const n = y.length;
  const one = y.map(() => 1);
  const r = y.map((_, i) => i);
  const c0 = ols([one], y);
  const c1 = ols([one, r], y);
  if (!c0 || !c1) return null;
  const a0 = aicc(c0.rss, n, 2);
  const a1 = aicc(c1.rss, n, 3);
  const mx = (n - 1) / 2;
  const sxx = r.reduce((a, v) => a + (v - mx) ** 2, 0);
  const se = Math.sqrt(c1.rss / (n - 2) / sxx);
  const b = c1.beta[1] as number;
  const pLinear = se > 0 ? 2 * (1 - tCdf(Math.abs(b / se), n - 2)) : b === 0 ? 1 : 0;
  let a2 = NaN;
  let brk: Fits['brk'] = null;
  if (n >= WITHIN_RULE.minBreak) {
    let best: { rss: number; at: number; beta: number[] } | null = null;
    for (let k = WITHIN_RULE.minSegment - 1; k <= n - WITHIN_RULE.minSegment; k++) {
      const f = ols([one, r, r.map((v) => Math.max(0, v - k))], y);
      if (f && (!best || f.rss < best.rss)) best = { rss: f.rss, at: k, beta: f.beta };
    }
    if (best) {
      // the break position is a searched parameter: counted as one more parameter
      a2 = aicc(best.rss, n, 5);
      brk = { at: best.at, before: best.beta[1] as number, after: (best.beta[1] as number) + (best.beta[2] as number) };
    }
  }
  const gains = [a0 - a1, a0 - a2].filter(Number.isFinite);
  return { a0, a1, a2, slope: b, se, pLinear, brk, gain: gains.length ? Math.max(...gains) : -Infinity };
}

export function featureDynamics(feature: WithinFeature, values: readonly number[], rng: Rng = createRng(20261110)): FeatureDynamics {
  const y = values.filter(Number.isFinite);
  const n = y.length;
  const base: FeatureDynamics = { feature, n, shape: 'constant', aicc: { constant: NaN, linear: NaN, broken_stick: NaN }, slope: null, slopeSe: null, pLinear: null, p: null, pHolm: null, breakAt: null, slopeBefore: null, slopeAfter: null, direction: 'none' };
  if (n < WITHIN_RULE.minTrend) return base;
  const f = fitShapes(y);
  if (!f) return base;
  // permutation test of the largest AICc gain (order of repetitions shuffled)
  let ge = 0;
  const perm = [...y];
  for (let q = 0; q < WITHIN_RULE.permutations; q++) {
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
    }
    const g = fitShapes(perm);
    if (g && g.gain >= f.gain - 1e-12) ge++;
  }
  const p = (1 + ge) / (WITHIN_RULE.permutations + 1);
  // shape among the NON-constant models (parsimony: linear unless the broken stick is better by more than 2);
  // whether the feature moves at all is decided by the permutation test, in sittingDynamics
  const shape: TrendShape = Number.isFinite(f.a2) && f.a1 - f.a2 > WITHIN_RULE.parsimony ? 'broken_stick' : 'linear';
  const up = PERFORMANCE_UP[feature];
  let direction: FeatureDynamics['direction'] = 'none';
  if (shape === 'linear') direction = f.slope * up > 0 ? 'up' : 'down';
  else if (f.brk) {
    const s1 = Math.sign(f.brk.before * up);
    const s2 = Math.sign(f.brk.after * up);
    direction = s1 > 0 && s2 < 0 ? 'up_then_down' : s1 < 0 && s2 > 0 ? 'down_then_up' : s1 + s2 > 0 ? 'up' : s1 + s2 < 0 ? 'down' : 'none';
  }
  const bs = shape === 'broken_stick' && f.brk ? f.brk : null;
  return { ...base, shape, aicc: { constant: f.a0, linear: f.a1, broken_stick: f.a2 }, slope: f.slope, slopeSe: f.se, pLinear: f.pLinear, p, breakAt: bs ? bs.at : null, slopeBefore: bs ? bs.before : null, slopeAfter: bs ? bs.after : null, direction };
}

export function sittingDynamics(series: Partial<Record<WithinFeature, readonly number[]>>, seed = 20261110): SittingDynamics {
  const notes = [
    'a_kinematic_pattern,_not_a_diagnosis:_fatigue,_attention,_discomfort_and_motivation_are_not_measured',
    'the_"up"_direction_(larger,_faster,_shorter,_smoother)_is_a_convention_for_combining_features,_not_a_clinical_value',
  ];
  const reasons: string[] = [];
  const rng = createRng(seed);
  const features = WITHIN_FEATURES.filter((f) => series[f]).map((f) => featureDynamics(f, series[f] as readonly number[], rng));
  const tested = features.filter((f) => f.p !== null);
  if (!tested.length) {
    reasons.push(`no_feature_has_${WITHIN_RULE.minTrend}_repetitions`);
    return { pattern: 'insufficient_repetitions', reasons, features, notes };
  }
  // Holm across the features of the sitting
  const order = [...tested].sort((a, b) => (a.p as number) - (b.p as number));
  let run = 0;
  order.forEach((f, i) => {
    run = Math.max(run, Math.min(1, (order.length - i) * (f.p as number)));
    f.pHolm = run;
  });
  // a feature "moves" only when the Holm-adjusted permutation test rejects a constant level; otherwise its shape
  // and direction are not interpreted
  for (const f of tested) if (!((f.pHolm as number) < WITHIN_RULE.alpha)) Object.assign(f, { shape: 'constant', direction: 'none', breakAt: null, slopeBefore: null, slopeAfter: null });
  const moving = tested.filter((f) => f.shape !== 'constant');
  const dirs = new Set(moving.map((f) => f.direction));
  let pattern: SittingPattern;
  if (!moving.length) {
    pattern = 'no_trend_detected';
    reasons.push('no_feature_departs_from_a_constant_level_(not_evidence_that_nothing_changed)');
  } else if (dirs.has('up_then_down') && !dirs.has('down_then_up') && !dirs.has('up')) pattern = 'rise_then_decline';
  else if (dirs.size === 1 && dirs.has('up')) pattern = 'practice_like';
  else if (dirs.size === 1 && dirs.has('down')) pattern = 'decline_like';
  else {
    pattern = 'mixed';
    reasons.push(`features_move_in_different_directions:_${moving.map((f) => `${f.feature}_${f.direction}`).join(',_')}`);
  }
  if (moving.length === 1 && pattern !== 'mixed' && pattern !== 'no_trend_detected') reasons.push('carried_by_a_single_feature');
  return { pattern, reasons, features, notes };
}
