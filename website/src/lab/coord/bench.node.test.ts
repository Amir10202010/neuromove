// Benchmark fixtures: runs the NeuroMove implementations on seeded inputs and writes inputs + outputs for the
// Python reference comparison (research/benchmarks/compare.py). Only writes when COORD_BENCH_OUT is set.
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { dtw } from './align';
import { fitGmm, hardLabels, responsibilities, wardClusters } from './strategy';
import { svd } from './linalg';
import { madgwickSeries } from './quat';
import { adjustedRand, createRng } from './stats';
import type { Vec3 } from '../../lib/vec3';

it('benchmark fixtures', () => {
  const rng = createRng(424242);
  const t0 = performance.now();
  // SVD: 40 × 505 with low-rank structure + noise
  const X = Array.from({ length: 40 }, () => {
    const a = rng.normal() * 30;
    const b = rng.normal() * 10;
    return Array.from({ length: 505 }, (_, j) => a * Math.sin(j / 40) + b * Math.cos(j / 15) + rng.normal());
  });
  const ts = performance.now();
  const S = svd(X);
  const svdMs = performance.now() - ts;
  // Madgwick: 2000 samples of a tumbling sensor (gyro °/s, acc g)
  const n = 2000;
  const t = Array.from({ length: n }, (_, i) => i / 100);
  const gyro: Vec3[] = t.map((x) => [40 * Math.sin(0.7 * x), 25 * Math.cos(0.5 * x), 15 * Math.sin(0.3 * x + 1)] as Vec3);
  const acc: Vec3[] = t.map((x) => [0.2 * Math.sin(0.7 * x) + 0.01 * rng.normal(), -0.3 * Math.cos(0.5 * x) + 0.01 * rng.normal(), 0.93 + 0.01 * rng.normal()] as Vec3);
  const tm = performance.now();
  const M = madgwickSeries(t, gyro, acc);
  const madMs = performance.now() - tm;
  // DTW: 20 pairs of multivariate series of different length
  const pairs = Array.from({ length: 20 }, (_, k) => {
    const la = 60 + (k % 7) * 5;
    const lb = 50 + (k % 5) * 9;
    const a = Array.from({ length: la }, (_, i) => [Math.sin(i / 7) + 0.1 * rng.normal(), Math.cos(i / 9) + 0.1 * rng.normal(), 0.1 * rng.normal()]);
    const b = Array.from({ length: lb }, (_, i) => [Math.sin(i / 6 + 0.3) + 0.1 * rng.normal(), Math.cos(i / 8) + 0.1 * rng.normal(), 0.1 * rng.normal()]);
    return { a, b };
  });
  const td = performance.now();
  const dtwFree = pairs.map((p) => dtw(p.a, p.b).distance);
  const dtwMs = performance.now() - td;
  // GMM / Ward: 2-D data, 3 clusters
  const Z = [...Array(90).keys()].map((i) => {
    const c = i % 3;
    return [c * 4 + rng.normal(), (c === 1 ? 3 : 0) + rng.normal() * (c === 2 ? 0.5 : 1)];
  });
  const tg = performance.now();
  const gmms = [1, 2, 3, 4].map((K) => fitGmm(Z, K));
  const gmmMs = performance.now() - tg;
  const g3 = gmms[2]!;
  const labels = hardLabels(responsibilities(g3, Z).R);
  const ward3 = wardClusters(Z, 3);
  // ARI fixtures
  const la = Array.from({ length: 200 }, () => rng.int(0, 3));
  const lb = la.map((x) => (rng.chance(0.3) ? rng.int(0, 4) : x));
  const out = {
    svd: { X, s: S.s, V3: S.V.map((r) => r.slice(0, 3)), ms: svdMs },
    madgwick: { t, gyro, acc, q: M.q, ms: madMs },
    dtw: { pairs, free: dtwFree, banded: pairs.map((p) => dtw(p.a, p.b, 5).distance), equal: pairs.map((p) => ({ a: p.a.slice(0, 50), b: p.b.slice(0, 50), d: dtw(p.a.slice(0, 50), p.b.slice(0, 50), 5).distance })), ms: dtwMs },
    gmm: { Z, bic: gmms.map((g) => g.bic), logLik: gmms.map((g) => g.logLik), labels3: labels, ms: gmmMs },
    ward: { labels3: ward3 },
    ari: { a: la, b: lb, value: adjustedRand(la, lb) },
    elapsedMs: performance.now() - t0,
  };
  expect(S.s.length).toBe(40);
  if (process.env.COORD_BENCH_OUT) writeFileSync(process.env.COORD_BENCH_OUT, JSON.stringify(out));
});
