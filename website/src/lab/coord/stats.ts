// Small, deterministic statistics helpers for the coordination engine (seeded resampling, partition agreement,
// entropy). Everything takes an explicit seed — the same input always gives the same result.

import { createRng, type Rng } from '../../lib/random';

export { createRng, type Rng };

export function bootstrapIndices(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => Math.floor(rng.next() * n));
}

export function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function quantileOf(xs: readonly number[], p: number): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return (s[lo] as number) + (h - lo) * ((s[hi] as number) - (s[lo] as number));
}

export const median = (xs: readonly number[]): number => quantileOf(xs, 0.5);

export function mean(xs: readonly number[]): number {
  const f = xs.filter(Number.isFinite);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN;
}

export function sd(xs: readonly number[]): number {
  const f = xs.filter(Number.isFinite);
  if (f.length < 2) return NaN;
  const m = mean(f);
  return Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / (f.length - 1));
}

/** Adjusted Rand index (Hubert & Arabie 1985) between two labelings of the same items. */
export function adjustedRand(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const table = new Map<string, number>();
  const ra = new Map<string | number, number>();
  const rb = new Map<string | number, number>();
  for (let i = 0; i < n; i++) {
    const k = `${a[i]}\u0000${b[i]}`;
    table.set(k, (table.get(k) ?? 0) + 1);
    ra.set(a[i] as string | number, (ra.get(a[i] as string | number) ?? 0) + 1);
    rb.set(b[i] as string | number, (rb.get(b[i] as string | number) ?? 0) + 1);
  }
  const c2 = (x: number) => (x * (x - 1)) / 2;
  let sumIJ = 0;
  for (const v of table.values()) sumIJ += c2(v);
  let sumA = 0;
  for (const v of ra.values()) sumA += c2(v);
  let sumB = 0;
  for (const v of rb.values()) sumB += c2(v);
  const expected = (sumA * sumB) / c2(n);
  const max = (sumA + sumB) / 2;
  if (max === expected) return 1; // both partitions trivial and identical in structure
  return (sumIJ - expected) / (max - expected);
}

/** Jaccard similarity of two index sets. */
export function jaccard(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

/** Shannon entropy in bits of a probability vector. */
export function entropyBits(p: readonly number[]): number {
  let h = 0;
  for (const x of p) if (x > 0) h -= x * Math.log2(x);
  return h;
}

/**
 * Plug-in entropy of observed counts with the Miller–Madow bias correction ((K_observed − 1) / 2n nats),
 * in bits. The plug-in estimator is biased downwards for small n; the correction is first-order only.
 */
export function entropyMillerMadow(counts: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return NaN;
  const k = counts.filter((c) => c > 0).length;
  return entropyBits(counts.map((c) => c / n)) + (k - 1) / (2 * n * Math.LN2);
}

/** Gamma(shape, 1) sampler — Marsaglia & Tsang 2000 (used for Dirichlet posteriors). */
export function gammaSample(shape: number, rng: Rng): number {
  if (shape < 1) return gammaSample(shape + 1, rng) * Math.pow(rng.next() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function dirichletSample(alpha: readonly number[], rng: Rng): number[] {
  const g = alpha.map((a) => gammaSample(a, rng));
  const s = g.reduce((a, b) => a + b, 0);
  return g.map((x) => x / s);
}
