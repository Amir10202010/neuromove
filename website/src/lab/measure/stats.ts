// Distribution helpers for the measurement-science modules. The t, F and beta functions already exist in
// research/stats.ts and are reused; this file adds only what was missing (χ², Kendall's τ).

import { lnGamma } from '../../research/stats';
import { normCdf } from '../numeric';

/** Regularised lower incomplete gamma P(a, x) — series for x < a + 1, continued fraction otherwise (Numerical Recipes). */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) return NaN;
  if (x === 0) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let ap = a;
    let del = 1 / a;
    let sum = del;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** χ² CDF with ν degrees of freedom. */
export const chi2Cdf = (x: number, nu: number): number => (x <= 0 ? 0 : gammaP(nu / 2, x / 2));

/** χ² quantile by bisection on the CDF (monotone). */
export function chi2Quantile(p: number, nu: number): number {
  if (!(nu > 0) || !(p > 0 && p < 1)) return NaN;
  let lo = 0;
  let hi = Math.max(10, nu * 4);
  while (chi2Cdf(hi, nu) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (chi2Cdf(mid, nu) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, mid)) break;
  }
  return (lo + hi) / 2;
}

/**
 * Confidence interval of a standard deviation estimated as √(mean square) with ν degrees of freedom:
 * [√(ν·MS/χ²₁₋α/₂), √(ν·MS/χ²α/₂)].
 */
export function sdInterval(sd: number, nu: number, level = 0.95): [number, number] | null {
  if (!(nu >= 1) || !(sd >= 0)) return null;
  const a = (1 - level) / 2;
  return [sd * Math.sqrt(nu / chi2Quantile(1 - a, nu)), sd * Math.sqrt(nu / chi2Quantile(a, nu))];
}

/**
 * Kendall's τ-b with a two-sided p-value from the normal approximation with tie correction (Kendall 1970).
 * p is null below 8 pairs, where the approximation is poor and power is negligible.
 */
export function kendallTau(x: readonly number[], y: readonly number[]): { tau: number; p: number | null; n: number } {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { tau: NaN, p: null, n };
  let conc = 0;
  let disc = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign((x[i] as number) - (x[j] as number));
      const dy = Math.sign((y[i] as number) - (y[j] as number));
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx++;
      else if (dy === 0) ty++;
      else if (dx === dy) conc++;
      else disc++;
    }
  const den = Math.sqrt((conc + disc + tx) * (conc + disc + ty));
  const tau = den > 0 ? (conc - disc) / den : NaN;
  if (n < 8 || !Number.isFinite(tau)) return { tau, p: null, n };
  // variance of S = conc − disc under H0, with corrections for ties in x and y
  const ties = (v: readonly number[]) => {
    const m = new Map<number, number>();
    for (let i = 0; i < n; i++) m.set(v[i] as number, (m.get(v[i] as number) ?? 0) + 1);
    return [...m.values()].filter((c) => c > 1);
  };
  const tX = ties(x);
  const tY = ties(y);
  const v0 = n * (n - 1) * (2 * n + 5);
  const vt = tX.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0);
  const vu = tY.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0);
  const v1 = (tX.reduce((a, t) => a + t * (t - 1), 0) * tY.reduce((a, t) => a + t * (t - 1), 0)) / (2 * n * (n - 1));
  const v2 = (tX.reduce((a, t) => a + t * (t - 1) * (t - 2), 0) * tY.reduce((a, t) => a + t * (t - 1) * (t - 2), 0)) / (9 * n * (n - 1) * (n - 2));
  const varS = (v0 - vt - vu) / 18 + v1 + v2;
  const z = varS > 0 ? (conc - disc) / Math.sqrt(varS) : 0;
  return { tau, p: 2 * (1 - normCdf(Math.abs(z))), n };
}
