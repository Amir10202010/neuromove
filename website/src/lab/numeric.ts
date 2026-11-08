// Numerical core of the computational motor learning lab: optimisation, derivatives, small dense
// linear algebra and the normal distribution. Pure functions, no React, no DOM — the same code runs in
// the browser, in Node tests and (via the API bundle) on the server.
//
// Optimiser: Nelder–Mead downhill simplex (Lagarias et al. 1998, doi:10.1137/S1052623496303470) with
// restarts. It needs no gradients, which suits likelihoods that contain recursions (Kalman filter,
// learning–retention dynamics). Every model is optimised in an UNCONSTRAINED parameterisation
// (log for scales, logit-like maps for bounded parameters); see models.ts.

export interface OptimResult {
  x: number[];
  fx: number;
  iterations: number;
  evaluations: number;
  converged: boolean;
}

export interface NelderMeadOptions {
  /** Initial simplex step per coordinate (default 0.1·|x|, at least 0.1). */
  step?: number[];
  maxIterations?: number;
  /** Convergence: simplex value spread and size both below these. */
  fTol?: number;
  xTol?: number;
}

/** Nelder–Mead with the standard coefficients (reflection 1, expansion 2, contraction ½, shrink ½). */
export function nelderMead(f: (x: number[]) => number, x0: readonly number[], o: NelderMeadOptions = {}): OptimResult {
  const n = x0.length;
  const maxIt = o.maxIterations ?? 400 * Math.max(1, n);
  const fTol = o.fTol ?? 1e-9;
  const xTol = o.xTol ?? 1e-7;
  let evals = 0;
  const F = (x: number[]) => {
    evals += 1;
    const v = f(x);
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  const simplex: number[][] = [[...x0]];
  for (let i = 0; i < n; i++) {
    const v = [...x0];
    const s = o.step?.[i] ?? Math.max(0.1, 0.1 * Math.abs(x0[i] as number));
    v[i] = (v[i] as number) + s;
    simplex.push(v);
  }
  let values = simplex.map(F);
  let it = 0;
  let converged = false;
  for (; it < maxIt; it++) {
    const order = values.map((_, i) => i).sort((a, b) => (values[a] as number) - (values[b] as number));
    const sx = order.map((i) => simplex[i] as number[]);
    const sv = order.map((i) => values[i] as number);
    simplex.splice(0, simplex.length, ...sx);
    values = sv;
    const best = values[0] as number;
    const worst = values[n] as number;
    let size = 0;
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) size = Math.max(size, Math.abs((simplex[i] as number[])[j]! - (simplex[0] as number[])[j]!));
    if (Number.isFinite(worst) && Math.abs(worst - best) <= fTol * (1 + Math.abs(best)) && size <= xTol * (1 + norm(simplex[0] as number[]))) {
      converged = true;
      break;
    }
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j]! += (simplex[i] as number[])[j]! / n;
    const w = simplex[n] as number[];
    const at = (t: number) => centroid.map((c, j) => c + t * (w[j]! - c));
    const xr = at(-1);
    const fr = F(xr);
    if (fr < (values[0] as number)) {
      const xe = at(-2);
      const fe = F(xe);
      if (fe < fr) {
        simplex[n] = xe;
        values[n] = fe;
      } else {
        simplex[n] = xr;
        values[n] = fr;
      }
      continue;
    }
    if (fr < (values[n - 1] as number)) {
      simplex[n] = xr;
      values[n] = fr;
      continue;
    }
    const outside = fr < worst;
    const xc = at(outside ? -0.5 : 0.5);
    const fc = F(xc);
    if (fc < (outside ? fr : worst)) {
      simplex[n] = xc;
      values[n] = fc;
      continue;
    }
    // Shrink towards the best vertex
    const b = simplex[0] as number[];
    for (let i = 1; i <= n; i++) {
      simplex[i] = (simplex[i] as number[]).map((v, j) => b[j]! + 0.5 * (v - b[j]!));
      values[i] = F(simplex[i] as number[]);
    }
  }
  let bi = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] as number) < (values[bi] as number)) bi = i;
  return { x: [...(simplex[bi] as number[])], fx: values[bi] as number, iterations: it, evaluations: evals, converged };
}

/** Run Nelder–Mead from several starts, then restart once from the best point (guards against a collapsed simplex). */
export function minimize(f: (x: number[]) => number, starts: readonly (readonly number[])[], o: NelderMeadOptions = {}): OptimResult {
  let best: OptimResult | null = null;
  let evaluations = 0;
  for (const s of starts) {
    const r = nelderMead(f, s, o);
    evaluations += r.evaluations;
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best) throw new Error('minimize: no starting point');
  const again = nelderMead(f, best.x, o);
  evaluations += again.evaluations;
  const out = again.fx <= best.fx ? again : best;
  return { ...out, evaluations, converged: out.converged && Math.abs(again.fx - best.fx) <= 1e-6 * (1 + Math.abs(best.fx)) };
}

export function norm(x: readonly number[]): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s);
}

/** Central-difference Hessian. Step h_i = max(1e-4, 1e-4·|x_i|). */
export function hessian(f: (x: number[]) => number, x: readonly number[]): number[][] {
  const n = x.length;
  const h = x.map((v) => Math.max(1e-4, 1e-4 * Math.abs(v)));
  const H: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const f0 = f([...x]);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let v: number;
      if (i === j) {
        const p = [...x];
        const m = [...x];
        p[i] = (p[i] as number) + (h[i] as number);
        m[i] = (m[i] as number) - (h[i] as number);
        v = (f(p) - 2 * f0 + f(m)) / ((h[i] as number) * (h[i] as number));
      } else {
        const pp = [...x];
        const pm = [...x];
        const mp = [...x];
        const mm = [...x];
        pp[i] = (pp[i] as number) + (h[i] as number); pp[j] = (pp[j] as number) + (h[j] as number);
        pm[i] = (pm[i] as number) + (h[i] as number); pm[j] = (pm[j] as number) - (h[j] as number);
        mp[i] = (mp[i] as number) - (h[i] as number); mp[j] = (mp[j] as number) + (h[j] as number);
        mm[i] = (mm[i] as number) - (h[i] as number); mm[j] = (mm[j] as number) - (h[j] as number);
        v = (f(pp) - f(pm) - f(mp) + f(mm)) / (4 * (h[i] as number) * (h[j] as number));
      }
      H[i]![j] = v;
      H[j]![i] = v;
    }
  }
  return H;
}

/** Forward-difference Jacobian of a vector function. */
export function jacobian(g: (x: number[]) => number[], x: readonly number[]): number[][] {
  const g0 = g([...x]);
  const J: number[][] = g0.map(() => new Array<number>(x.length).fill(0));
  for (let j = 0; j < x.length; j++) {
    const h = Math.max(1e-6, 1e-6 * Math.abs(x[j] as number));
    const p = [...x];
    p[j] = (p[j] as number) + h;
    const gp = g(p);
    for (let i = 0; i < g0.length; i++) J[i]![j] = ((gp[i] as number) - (g0[i] as number)) / h;
  }
  return J;
}

/** Inverse of a small square matrix by Gauss–Jordan with partial pivoting; null when (numerically) singular. */
export function invert(M: readonly (readonly number[])[]): number[][] | null {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  let scale = 0;
  for (const r of M) for (const v of r) scale = Math.max(scale, Math.abs(v));
  if (!(scale > 0)) return null;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12 * scale) return null;
    [A[c], A[p]] = [A[p] as number[], A[c] as number[]];
    const piv = A[c]![c]!;
    for (let j = 0; j < 2 * n; j++) A[c]![j]! /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = A[r]![c]!;
      if (k === 0) continue;
      for (let j = 0; j < 2 * n; j++) A[r]![j]! -= k * A[c]![j]!;
    }
  }
  return A.map((r) => r.slice(n));
}

/** True when every leading principal minor is positive (Sylvester) — i.e. the matrix is positive definite. */
export function isPositiveDefinite(M: readonly (readonly number[])[]): boolean {
  const n = M.length;
  // Cholesky attempt
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (!(s > 0)) return false;
        L[i]![i] = Math.sqrt(s);
      } else L[i]![j] = s / L[j]![j]!;
    }
  }
  return true;
}

// ── Normal distribution ─────────────────────────────────────────────────────────────────────────

export const LOG_2PI = Math.log(2 * Math.PI);
/** χ²(1) 95 % quantile: profile-likelihood threshold 2·Δℓ ≤ 3.841… */
export const CHI2_1_95 = 3.841458820694124;

/** Normal log density. */
export function normLogPdf(x: number, mean: number, variance: number): number {
  const d = x - mean;
  return -0.5 * (LOG_2PI + Math.log(variance) + (d * d) / variance);
}

/** Standard normal CDF via erfc (W. J. Cody's rational approximations are overkill here; this is accurate to ~1e-7). */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

function erfc(x: number): number {
  // Numerical Recipes erfcc (Chebyshev), fractional error < 1.2e-7
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal quantile (Acklam's algorithm). */
export function normQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // Acklam's relative error is ≤ 1.15e-9; a Newton step through normCdf (≈1e-7) would make it worse, so none.
  return x;
}

/** Empirical quantile, type 7 (R default / NumPy linear). */
export function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0] as number;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return (sorted[lo] as number) + (h - lo) * ((sorted[hi] as number) - (sorted[lo] as number));
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function meanOf(xs: readonly number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}

/** Sample variance (n − 1). */
export function varianceOf(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = meanOf(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

/** Lag-1 autocorrelation of a centred series (descriptive; low power for short series). */
export function lag1(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = meanOf(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += (xs[i]! - m) ** 2;
    if (i > 0) num += (xs[i]! - m) * (xs[i - 1]! - m);
  }
  return den > 0 ? num / den : NaN;
}
