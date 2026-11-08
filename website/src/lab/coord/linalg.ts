// Linear algebra for the coordination engine — a thin typed wrapper around ml-matrix (mljs, MIT, v6.15.1).
//
// Decision (research/software-dependency-decisions.md): REUSE + WRAP. SVD and symmetric eigendecomposition are
// taken from ml-matrix (JAMA-derived Golub–Kahan SVD and Householder/QL symmetric EVD) instead of a custom
// implementation; this file only fixes the conventions MCSE relies on:
//   • singular values sorted descending,
//   • sign of every component fixed (largest-|value| loading positive) so results are deterministic,
//   • thin decomposition for wide matrices (n repetitions ≪ d trajectory samples) via autoTranspose.
// Agreement with numpy.linalg.svd is benchmarked in research/algorithm-benchmarking.md.

import { EigenvalueDecomposition, Matrix, SingularValueDecomposition } from 'ml-matrix';

export type Mat = number[][];

export interface Svd {
  /** n × r left singular vectors (columns). */
  U: Mat;
  /** r singular values, descending. */
  s: number[];
  /** d × r right singular vectors (columns) — the component loadings. */
  V: Mat;
}

/** Thin SVD X = U diag(s) Vᵀ with deterministic order and signs. r = min(n, d). */
export function svd(X: Mat): Svd {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  if (!n || !d) return { U: [], s: [], V: [] };
  const dec = new SingularValueDecomposition(new Matrix(X), { autoTranspose: true });
  const U0 = dec.leftSingularVectors.to2DArray();
  const V0 = dec.rightSingularVectors.to2DArray();
  const s0 = dec.diagonal;
  const r = Math.min(n, d, s0.length);
  const order = [...Array(s0.length).keys()].sort((a, b) => (s0[b] as number) - (s0[a] as number)).slice(0, r);
  const U: Mat = Array.from({ length: n }, () => new Array<number>(r).fill(0));
  const V: Mat = Array.from({ length: d }, () => new Array<number>(r).fill(0));
  const s: number[] = [];
  order.forEach((k, j) => {
    // sign convention: the loading with the largest magnitude is positive
    let big = 0;
    for (let i = 0; i < d; i++) if (Math.abs((V0[i] as number[])[k] as number) > Math.abs(big)) big = (V0[i] as number[])[k] as number;
    const sg = big < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) (U[i] as number[])[j] = sg * ((U0[i] as number[])[k] ?? 0);
    for (let i = 0; i < d; i++) (V[i] as number[])[j] = sg * ((V0[i] as number[])[k] ?? 0);
    s.push(s0[k] as number);
  });
  return { U, s, V };
}

/** Eigen-decomposition of a symmetric matrix: eigenvalues descending, eigenvectors as columns. */
export function symEig(C: Mat): { values: number[]; vectors: Mat } {
  const d = C.length;
  if (!d) return { values: [], vectors: [] };
  const dec = new EigenvalueDecomposition(new Matrix(C), { assumeSymmetric: true });
  const vals = dec.realEigenvalues;
  const E = dec.eigenvectorMatrix.to2DArray();
  const order = [...vals.keys()].sort((a, b) => (vals[b] as number) - (vals[a] as number));
  return { values: order.map((k) => vals[k] as number), vectors: E.map((row) => order.map((k) => row[k] as number)) };
}

export function colMeans(X: Mat): number[] {
  const d = X[0]?.length ?? 0;
  const m = new Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) m[j]! += (row[j] as number) / X.length;
  return m;
}

export function center(X: Mat, mu: readonly number[] = colMeans(X)): Mat {
  return X.map((row) => row.map((v, j) => v - (mu[j] as number)));
}

export function matVec(A: Mat, x: readonly number[]): number[] {
  return A.map((row) => row.reduce((acc, v, j) => acc + v * (x[j] as number), 0));
}

/** xᵀ·V[:, k] for the first k columns. */
export function project(x: readonly number[], V: Mat, k: number): number[] {
  const out = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = V[i] as number[];
    for (let j = 0; j < k; j++) out[j]! += (x[i] as number) * (row[j] as number);
  }
  return out;
}

export function reconstruct(scores: readonly number[], V: Mat, mu: readonly number[]): number[] {
  return mu.map((m, i) => {
    const row = V[i] as number[];
    let v = m;
    for (let j = 0; j < scores.length; j++) v += (scores[j] as number) * (row[j] as number);
    return v;
  });
}

export function sqDist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] as number) - (b[i] as number)) ** 2;
  return s;
}

/**
 * Tucker's congruence coefficient |aᵀb| / (‖a‖‖b‖) — similarity of two loading vectors, sign-invariant.
 * Interpretation bands (Lorenzo-Seva & ten Berge 2006): ≥ 0.95 equal, 0.85–0.94 fair similarity, < 0.85 different.
 */
export function congruence(a: readonly number[], b: readonly number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] as number) * (b[i] as number);
    aa += (a[i] as number) ** 2;
    bb += (b[i] as number) ** 2;
  }
  return aa > 0 && bb > 0 ? Math.abs(ab) / Math.sqrt(aa * bb) : 0;
}

export function column(M: Mat, k: number): number[] {
  return M.map((row) => row[k] as number);
}

/** log-determinant and inverse of a small symmetric positive-definite matrix (Cholesky); null if not SPD. */
export function cholInvLogDet(S: Mat): { inv: Mat; logDet: number } | null {
  const d = S.length;
  const L: Mat = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let s = (S[i] as number[])[j] as number;
      for (let k = 0; k < j; k++) s -= ((L[i] as number[])[k] as number) * ((L[j] as number[])[k] as number);
      if (i === j) {
        if (!(s > 0)) return null;
        (L[i] as number[])[i] = Math.sqrt(s);
      } else (L[i] as number[])[j] = s / ((L[j] as number[])[j] as number);
    }
  }
  let logDet = 0;
  for (let i = 0; i < d; i++) logDet += 2 * Math.log((L[i] as number[])[i] as number);
  // inverse of L, then (L⁻¹)ᵀ L⁻¹
  const Li: Mat = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    (Li[i] as number[])[i] = 1 / ((L[i] as number[])[i] as number);
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= ((L[i] as number[])[k] as number) * ((Li[k] as number[])[j] as number);
      (Li[i] as number[])[j] = s / ((L[i] as number[])[i] as number);
    }
  }
  const inv: Mat = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++)
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = Math.max(i, j); k < d; k++) s += ((Li[k] as number[])[i] as number) * ((Li[k] as number[])[j] as number);
      (inv[i] as number[])[j] = s;
    }
  return { inv, logDet };
}
