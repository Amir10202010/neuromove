// Measurement-agreement statistics for IMU vs. reference (goniometer) comparisons.
//
// Pure functions, no rounding: every value is returned at full floating-point precision; the UI rounds
// for display only. Every function documents its model and assumptions (docs/research/STATISTICS.md).
//
// Conventions
//   difference d = IMU − reference (degrees). Positive bias = IMU reads higher than the goniometer.
//   SD is the SAMPLE standard deviation (n − 1).
//   "null" means "not computable from these data" — never 0, never a guess.

// ── Distribution functions ─────────────────────────────────────────────────────────────────────────

/** ln Γ(x), Lanczos approximation (g = 7, n = 9); |rel. error| < 1e-13 for x > 0. */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0] as number;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Student t CDF P(T ≤ t), df > 0. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** F CDF P(F ≤ f). */
export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  return incompleteBeta((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
}

/** Inverse of a monotone increasing CDF on (lo, hi) by bisection (64-bit precision in ≤ 200 steps). */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  while (cdf(hi) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-12 * Math.max(1, Math.abs(mid))) break;
  }
  return (lo + hi) / 2;
}

/** Student t quantile: tQuantile(0.975, 9) = 2.2621571627… */
export function tQuantile(p: number, df: number): number {
  if (!(df > 0) || !(p > 0 && p < 1)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  return invert((x) => tCdf(x, df), p, 0, 10);
}

/** F quantile. */
export function fQuantile(p: number, d1: number, d2: number): number {
  if (!(d1 > 0 && d2 > 0) || !(p > 0 && p < 1)) return NaN;
  return invert((x) => fCdf(x, d1, d2), p, 0, 10);
}

/** Standard normal quantile for the conventional 95 % two-sided limits. */
export const Z975 = 1.959963984540054;

// ── Descriptive helpers (local, so this module has no dependencies) ────────────────────────────────

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
const meanOf = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : NaN);
function sdOf(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = meanOf(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
function medianOf(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
const finite = (x: number): number | null => (Number.isFinite(x) ? x : null);

// ── Paired errors ─────────────────────────────────────────────────────────────────────────────────

export interface Pair {
  /** IMU angle, degrees. */
  imu: number;
  /** Reference (goniometer) angle, degrees. */
  ref: number;
  /** Subject / participant id — needed for repeated-measures methods. */
  subject?: string;
  /** Free identifier (trial id) carried through to flags. */
  id?: string;
}

export const signedError = (p: Pair): number => p.imu - p.ref;
export const absoluteError = (p: Pair): number => Math.abs(p.imu - p.ref);

export interface ErrorSummary {
  n: number;
  meanImu: number | null;
  meanRef: number | null;
  /** Mean signed error (IMU − reference). */
  bias: number | null;
  /** 95 % CI of the bias (t distribution, df = n − 1). Needs n ≥ 2. */
  biasCi: [number, number] | null;
  /** Sample SD of the signed errors. Needs n ≥ 2. */
  sd: number | null;
  mae: number | null;
  rmse: number | null;
  medianAbs: number | null;
  /** Most negative and most positive signed error. */
  minSigned: number | null;
  maxSigned: number | null;
  maxAbs: number | null;
}

export function errorSummary(pairs: readonly Pair[]): ErrorSummary {
  const n = pairs.length;
  const d = pairs.map(signedError);
  const abs = d.map(Math.abs);
  const bias = meanOf(d);
  const sd = sdOf(d);
  const half = n >= 2 ? tQuantile(0.975, n - 1) * (sd / Math.sqrt(n)) : NaN;
  return {
    n,
    meanImu: finite(meanOf(pairs.map((p) => p.imu))),
    meanRef: finite(meanOf(pairs.map((p) => p.ref))),
    bias: finite(bias),
    biasCi: Number.isFinite(half) ? [bias - half, bias + half] : null,
    sd: finite(sd),
    mae: finite(meanOf(abs)),
    rmse: n ? Math.sqrt(meanOf(d.map((x) => x * x))) : null,
    medianAbs: finite(medianOf(abs)),
    minSigned: n ? Math.min(...d) : null,
    maxSigned: n ? Math.max(...d) : null,
    maxAbs: n ? Math.max(...abs) : null,
  };
}

// ── Linear regression with CI (used for proportional bias and drift) ──────────────────────────────

export interface LineFit {
  n: number;
  intercept: number;
  slope: number;
  /** 95 % CI of the slope (t, df = n − 2). Needs n ≥ 3 and non-constant x. */
  slopeCi: [number, number] | null;
}

export function lineFit(xs: readonly number[], ys: readonly number[]): LineFit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = meanOf(xs.slice(0, n));
  const my = meanOf(ys.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += ((xs[i] as number) - mx) ** 2;
    sxy += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let slopeCi: [number, number] | null = null;
  if (n >= 3) {
    let sse = 0;
    for (let i = 0; i < n; i++) sse += ((ys[i] as number) - intercept - slope * (xs[i] as number)) ** 2;
    const se = Math.sqrt(sse / (n - 2) / sxx);
    const h = tQuantile(0.975, n - 2) * se;
    slopeCi = [slope - h, slope + h];
  }
  return { n, intercept, slope, slopeCi };
}

// ── Bland–Altman, independent observations ────────────────────────────────────────────────────────

export interface BlandAltman {
  method: 'standard' | 'repeated_measures';
  n: number;
  /** Number of distinct subjects (repeated-measures method). */
  subjects: number;
  bias: number;
  /** SD of differences used for the limits (total SD in the repeated-measures method). */
  sd: number;
  loa: [number, number];
  biasCi: [number, number] | null;
  /** Approximate 95 % CIs of the lower and upper limit (Bland & Altman 1999, SE ≈ √(3s²/n)). */
  lowerCi: [number, number] | null;
  upperCi: [number, number] | null;
  /** Regression of difference on mean: a slope whose CI excludes 0 suggests proportional bias. */
  proportional: LineFit | null;
  points: { mean: number; diff: number; id?: string }[];
}

/**
 * Standard Bland–Altman (Bland & Altman 1986). Assumes independent pairs, constant bias and SD across
 * the measured range, and approximately normal differences. Needs n ≥ 3.
 * Repeated trials from ONE participant are not independent of each other in the population sense: the
 * result then describes agreement for that participant, not for the population.
 */
export function blandAltman(pairs: readonly Pair[]): BlandAltman | null {
  const n = pairs.length;
  if (n < 3) return null;
  const d = pairs.map(signedError);
  const m = pairs.map((p) => (p.imu + p.ref) / 2);
  const bias = meanOf(d);
  const sd = sdOf(d);
  const t = tQuantile(0.975, n - 1);
  const seBias = sd / Math.sqrt(n);
  const seLoa = Math.sqrt((3 * sd * sd) / n);
  const loa: [number, number] = [bias - Z975 * sd, bias + Z975 * sd];
  return {
    method: 'standard',
    n,
    subjects: new Set(pairs.map((p) => p.subject ?? '')).size,
    bias,
    sd,
    loa,
    biasCi: [bias - t * seBias, bias + t * seBias],
    lowerCi: [loa[0] - t * seLoa, loa[0] + t * seLoa],
    upperCi: [loa[1] - t * seLoa, loa[1] + t * seLoa],
    proportional: lineFit(m, d),
    points: pairs.map((p, i) => ({ mean: m[i] as number, diff: d[i] as number, ...(p.id ? { id: p.id } : {}) })),
  };
}

/**
 * Bland–Altman for multiple observations per subject where the true value varies between observations
 * (Bland & Altman 2007, Stat Methods Med Res 16:571–582, §5). One-way ANOVA of the differences by subject:
 *   σ²_w = MS_within,  σ²_b = max(0, (MS_between − MS_within) / λ),  λ = (N² − Σmᵢ²) / ((k − 1) N)
 *   total SD = √(σ²_b + σ²_w),  LoA = mean(d) ± 1.96 · total SD
 * Needs ≥ 2 subjects and N > k. No CI for the limits is reported (the 2007 paper gives no simple formula).
 */
export function blandAltmanRepeated(pairs: readonly Pair[]): BlandAltman | null {
  const groups = new Map<string, number[]>();
  for (const p of pairs) {
    const key = p.subject ?? '';
    groups.set(key, [...(groups.get(key) ?? []), signedError(p)]);
  }
  const k = groups.size;
  const N = pairs.length;
  if (k < 2 || N <= k) return null;
  const all = pairs.map(signedError);
  const grand = meanOf(all);
  let ssb = 0;
  let ssw = 0;
  let sumM2 = 0;
  for (const ds of groups.values()) {
    const mi = meanOf(ds);
    ssb += ds.length * (mi - grand) ** 2;
    for (const x of ds) ssw += (x - mi) ** 2;
    sumM2 += ds.length ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const lambda = (N * N - sumM2) / ((k - 1) * N);
  const varB = Math.max(0, (msb - msw) / lambda);
  const sd = Math.sqrt(varB + msw);
  const m = pairs.map((p) => (p.imu + p.ref) / 2);
  const t = tQuantile(0.975, k - 1);
  // Bias CI from subject means (conservative: treats subjects as the independent units)
  const subjectMeans = [...groups.values()].map(meanOf);
  const seBias = sdOf(subjectMeans) / Math.sqrt(k);
  return {
    method: 'repeated_measures',
    n: N,
    subjects: k,
    bias: grand,
    sd,
    loa: [grand - Z975 * sd, grand + Z975 * sd],
    biasCi: Number.isFinite(seBias) ? [grand - t * seBias, grand + t * seBias] : null,
    lowerCi: null,
    upperCi: null,
    proportional: lineFit(m, all),
    points: pairs.map((p, i) => ({ mean: m[i] as number, diff: all[i] as number, ...(p.id ? { id: p.id } : {}) })),
  };
}

/** Choose the method the data structure requires: several subjects with repeats → repeated measures. */
export function agreement(pairs: readonly Pair[]): BlandAltman | null {
  const subjects = new Set(pairs.map((p) => p.subject ?? ''));
  if (subjects.size >= 2 && pairs.length > subjects.size) return blandAltmanRepeated(pairs);
  return blandAltman(pairs);
}

// ── Intraclass correlation (McGraw & Wong 1996; Shrout & Fleiss 1979) ─────────────────────────────

export interface Icc {
  /** n targets (rows) × k raters / methods / occasions (columns). */
  n: number;
  k: number;
  /** ICC(A,1): two-way random effects, absolute agreement, single measurement (= Shrout–Fleiss ICC(2,1)). */
  agreement: number;
  agreementCi: [number, number] | null;
  /** ICC(C,1): two-way, consistency, single measurement (= Shrout–Fleiss ICC(3,1)). */
  consistency: number;
  consistencyCi: [number, number] | null;
  msr: number;
  msc: number;
  mse: number;
  /** SEM for agreement: √(σ²_columns + σ²_error) = √((MSC − MSE)/n + MSE). */
  semAgreement: number;
  /** SEM for consistency: √MSE. */
  semConsistency: number;
  /** MDC95 = 1.96 · √2 · SEM (agreement). */
  mdc95: number;
}

/**
 * Two-way ANOVA ICCs for a complete n × k matrix (no missing cells). Rows are the measured targets
 * (e.g. trials or participants), columns the methods/raters/occasions. Needs n ≥ 2 and k ≥ 2.
 * Assumptions: targets are a random sample, errors are normal with constant variance, no target × rater
 * interaction beyond error. Repeated trials of one participant used as "targets" violate independence:
 * report as descriptive only.
 */
export function icc(matrix: readonly (readonly number[])[]): Icc | null {
  const n = matrix.length;
  const k = matrix[0]?.length ?? 0;
  if (n < 2 || k < 2 || matrix.some((r) => r.length !== k || r.some((x) => !Number.isFinite(x)))) return null;
  const grand = meanOf(matrix.flat());
  const rowMeans = matrix.map(meanOf);
  const colMeans = Array.from({ length: k }, (_, j) => meanOf(matrix.map((r) => r[j] as number)));
  const ssr = k * sum(rowMeans.map((m) => (m - grand) ** 2));
  const ssc = n * sum(colMeans.map((m) => (m - grand) ** 2));
  const sst = sum(matrix.flat().map((x) => (x - grand) ** 2));
  const sse = sst - ssr - ssc;
  const msr = ssr / (n - 1);
  const msc = ssc / (k - 1);
  const mse = sse / ((n - 1) * (k - 1));
  const agreement = (msr - mse) / (msr + (k - 1) * mse + (k / n) * (msc - mse));
  const consistency = (msr - mse) / (msr + (k - 1) * mse);

  // CI for ICC(C,1): F-based (McGraw & Wong 1996, Table 7, case 3)
  let consistencyCi: [number, number] | null = null;
  let agreementCi: [number, number] | null = null;
  if (mse > 0) {
    const df1 = n - 1;
    const df2 = (n - 1) * (k - 1);
    const fObs = msr / mse;
    const fl = fObs / fQuantile(0.975, df1, df2);
    const fu = fObs * fQuantile(0.975, df2, df1);
    consistencyCi = [(fl - 1) / (fl + k - 1), (fu - 1) / (fu + k - 1)];
    // CI for ICC(A,1): Satterthwaite approximation (McGraw & Wong 1996, Table 7, case 2A)
    const a = (k * agreement) / (n * (1 - agreement));
    const b = 1 + (k * agreement * (n - 1)) / (n * (1 - agreement));
    const v = (a * msc + b * mse) ** 2 / ((a * msc) ** 2 / (k - 1) + (b * mse) ** 2 / ((n - 1) * (k - 1)));
    if (Number.isFinite(v) && v > 0) {
      const fs = fQuantile(0.975, n - 1, v);
      const fss = fQuantile(0.975, v, n - 1);
      const c = k * msc + (k * n - k - n) * mse;
      agreementCi = [(n * (msr - fs * mse)) / (fs * c + n * msr), (n * (fss * msr - mse)) / (c + n * fss * msr)];
    }
  }
  const semAgreement = Math.sqrt(Math.max(0, (msc - mse) / n) + mse);
  return {
    n,
    k,
    agreement,
    agreementCi,
    consistency,
    consistencyCi,
    msr,
    msc,
    mse,
    semAgreement,
    semConsistency: Math.sqrt(mse),
    mdc95: Z975 * Math.SQRT2 * semAgreement,
  };
}

// ── Flags, ranges, drift, sufficiency ─────────────────────────────────────────────────────────────

export type PairFlag = 'outside_loa' | 'robust_outlier' | 'above_review_threshold';

/**
 * Flags unusual pairs for operator review. Never removes anything.
 *  - outside_loa: difference outside the Bland–Altman limits (≈ 5 % expected by construction)
 *  - robust_outlier: |d − median| / (1.4826·MAD) > 3.5 (Iglewicz & Hoaglin)
 *  - above_review_threshold: |d| above the protocol's review threshold
 */
export function flagPairs(pairs: readonly Pair[], reviewAbsErrorDeg: number | null): Map<number, PairFlag[]> {
  const out = new Map<number, PairFlag[]>();
  const add = (i: number, f: PairFlag) => out.set(i, [...(out.get(i) ?? []), f]);
  const d = pairs.map(signedError);
  const ba = blandAltman(pairs);
  if (ba) d.forEach((x, i) => (x < ba.loa[0] || x > ba.loa[1]) && add(i, 'outside_loa'));
  if (d.length >= 5) {
    const med = medianOf(d);
    const mad = medianOf(d.map((x) => Math.abs(x - med)));
    if (mad > 0) d.forEach((x, i) => Math.abs(x - med) / (1.4826 * mad) > 3.5 && add(i, 'robust_outlier'));
  }
  if (reviewAbsErrorDeg !== null) d.forEach((x, i) => Math.abs(x) > reviewAbsErrorDeg && add(i, 'above_review_threshold'));
  return out;
}

export interface RangeBin {
  from: number;
  to: number;
  summary: ErrorSummary;
}

/** Agreement across the measured range: pairs binned by REFERENCE angle. */
export function rangeAgreement(pairs: readonly Pair[], binDeg = 30): RangeBin[] {
  if (!pairs.length) return [];
  const bins = new Map<number, Pair[]>();
  for (const p of pairs) {
    const b = Math.floor(p.ref / binDeg);
    bins.set(b, [...(bins.get(b) ?? []), p]);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, ps]) => ({ from: b * binDeg, to: (b + 1) * binDeg, summary: errorSummary(ps) }));
}

/** Change of signed error over the session (trial order): slope in degrees per trial. */
export function drift(errorsInOrder: readonly number[]): LineFit | null {
  return lineFit(
    errorsInOrder.map((_, i) => i + 1),
    errorsInOrder,
  );
}

export type Sufficiency = 'none' | 'insufficient' | 'limited' | 'adequate';

/**
 * Whether there are enough paired measurements for an analysis. Thresholds are conventions stated up
 * front, not statistical guarantees:
 *   - error summary: SD needs n ≥ 2; < 5 insufficient; 5–14 limited; ≥ 15 adequate for a session summary
 *   - Bland–Altman: < 10 insufficient; 10–29 limited (wide CIs of the limits); ≥ 30 adequate
 *   - ICC: < 10 targets insufficient; 10–29 limited; ≥ 30 adequate (Koo & Li 2016 recommend ≥ 30)
 */
export function sufficiency(n: number, analysis: 'summary' | 'bland_altman' | 'icc'): Sufficiency {
  if (n === 0) return 'none';
  const [low, ok] = analysis === 'summary' ? [5, 15] : [10, 30];
  if (n < low) return 'insufficient';
  if (n < ok) return 'limited';
  return 'adequate';
}
