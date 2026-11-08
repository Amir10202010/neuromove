// Trial-level two-state (fast/slow) learning model — Smith, Ghazizadeh & Shadmehr 2006,
// doi:10.1371/journal.pbio.0040179; estimation issues: Albert & Shadmehr 2018, doi:10.1152/jn.00197.2017.
//
//   x_f(n+1) = A_f·x_f(n) + B_f·e(n)        0 < A_f < A_s < 1
//   x_s(n+1) = A_s·x_s(n) + B_s·e(n)        0 < B_s < B_f < 1
//   x(n) = x_f(n) + x_s(n),  e(n) = p(n) − x(n)   (p = target/perturbation; error-clamp trials: e(n) = 0)
//   y(n) = x(n) + v(n),  v ~ N(0, σ²)         (observed only on trials in `observed`)
//
// WHY IT IS HERE: the research mandate asks whether multi-rate learning models can describe NeuroMove data.
// They need a trial-by-trial ERROR signal (a target the participant tries to reach, with feedback) and dense
// observation. Current NeuroMove sessions are assessments (≈3 repetitions per movement per week, no target),
// so this model is NOT applied to them. It is used in the identifiability study (experiments.ts) that tells the
// Study Designer which future protocol could support it. See research/mathematical-models.md §5.

import { createRng } from '../lib/random';
import { CHI2_1_95, LOG_2PI, minimize } from './numeric';

export interface TrialSchedule {
  /** Target / perturbation per trial. */
  p: number[];
  /** Error-clamp trials: the error is held at 0 regardless of output. */
  clamp: boolean[];
  /** Trials on which the output is observed. */
  observed: boolean[];
}

export interface DualRateParams {
  Af: number;
  As: number;
  Bf: number;
  Bs: number;
  sigma: number;
}

const sig = (u: number) => 1 / (1 + Math.exp(-u));
const logit = (x: number) => Math.log(x / (1 - x));

export function toFreeDR(q: DualRateParams): number[] {
  return [logit(q.As), logit(q.Af / q.As), logit(q.Bf), logit(q.Bs / q.Bf), Math.log(q.sigma)];
}
export function fromFreeDR(u: readonly number[]): DualRateParams {
  const As = sig(u[0] as number);
  const Bf = sig(u[2] as number);
  return { As, Af: As * sig(u[1] as number), Bf, Bs: Bf * sig(u[3] as number), sigma: Math.exp(u[4] as number) };
}

/** Noise-free net output x(n) on every trial. */
export function dualRateOutput(q: Pick<DualRateParams, 'Af' | 'As' | 'Bf' | 'Bs'>, s: Pick<TrialSchedule, 'p' | 'clamp'>): number[] {
  let xf = 0;
  let xs = 0;
  const out: number[] = [];
  for (let n = 0; n < s.p.length; n++) {
    const x = xf + xs;
    out.push(x);
    const e = s.clamp[n] ? 0 : (s.p[n] as number) - x;
    xf = q.Af * xf + q.Bf * e;
    xs = q.As * xs + q.Bs * e;
  }
  return out;
}

export function simulateDualRate(q: DualRateParams, s: TrialSchedule, seed: number): (number | null)[] {
  const rng = createRng(seed);
  return dualRateOutput(q, s).map((x, n) => (s.observed[n] ? x + rng.normal(0, q.sigma) : null));
}

function negLL(u: readonly number[], s: TrialSchedule, y: readonly (number | null)[]): number {
  const q = fromFreeDR(u);
  const x = dualRateOutput(q, s);
  const v = q.sigma * q.sigma;
  let nll = 0;
  for (let n = 0; n < y.length; n++) {
    const yn = y[n];
    if (yn === null || yn === undefined) continue;
    const e = yn - (x[n] as number);
    nll += 0.5 * (LOG_2PI + Math.log(v) + (e * e) / v);
  }
  return nll;
}

export interface DualRateFit {
  params: DualRateParams;
  nll: number;
  /** Profile-likelihood 95 % intervals on A_f, A_s, B_f, B_s (natural scale); open = not bounded by the data. */
  profiles: Record<'Af' | 'As' | 'Bf' | 'Bs', { lo: number; hi: number; open: boolean }>;
}

const STARTS: DualRateParams[] = [
  { Af: 0.6, As: 0.99, Bf: 0.2, Bs: 0.02, sigma: 0.1 },
  { Af: 0.8, As: 0.995, Bf: 0.1, Bs: 0.05, sigma: 0.2 },
  { Af: 0.4, As: 0.97, Bf: 0.35, Bs: 0.01, sigma: 0.05 },
];

export function fitDualRate(s: TrialSchedule, y: readonly (number | null)[], o: { profiles?: boolean } = {}): DualRateFit {
  const f = (u: number[]) => negLL(u, s, y);
  const r = minimize(f, STARTS.map(toFreeDR), { maxIterations: 4000 });
  const params = fromFreeDR(r.x);
  const empty = { lo: NaN, hi: NaN, open: true };
  const profiles = { Af: empty, As: empty, Bf: empty, Bs: empty };
  if (o.profiles !== false) {
    // Profile each rate on its NATURAL scale (grid in [0.001, 0.9999]) with the other free parameters re-optimised.
    // Natural-scale grid avoids the coupling of the ordered parameterisation (A_f = A_s·…).
    const thr = r.fx + CHI2_1_95 / 2;
    for (const key of ['Af', 'As', 'Bf', 'Bs'] as const) {
      const grid = Array.from({ length: 41 }, (_, i) => 0.001 + (0.9989 * i) / 40);
      const inside: number[] = [];
      for (const g of grid) {
        const h = (w: number[]) => {
          const q = fromFreeDR(w);
          // penalise distance of the profiled parameter from the grid value (equality constraint by penalty)
          const pen = 1e4 * ((q[key] - g) / 0.01) ** 2;
          return f(w) + pen;
        };
        const rr = minimize(h, [r.x], { maxIterations: 1500 });
        const q = fromFreeDR(rr.x);
        if (Math.abs(q[key] - g) < 0.005 && f(rr.x) <= thr) inside.push(g);
      }
      if (!inside.length) profiles[key] = { lo: params[key], hi: params[key], open: false };
      else {
        const lo = Math.min(...inside);
        const hi = Math.max(...inside);
        // "Open" when the accepted region reaches the edge of the admissible range or covers most of it
        profiles[key] = { lo, hi, open: lo <= grid[1]! || hi >= grid[grid.length - 2]! || hi - lo > 0.5 };
      }
    }
  }
  return { params, nll: r.fx, profiles };
}

/** The classic spontaneous-recovery paradigm: baseline, adaptation, brief reversal, error clamp. */
export function smithParadigm(o: { baseline?: number; adapt?: number; reverse?: number; clamp?: number } = {}): Omit<TrialSchedule, 'observed'> {
  const b = o.baseline ?? 20;
  const a = o.adapt ?? 150;
  const r = o.reverse ?? 15;
  const c = o.clamp ?? 50;
  const p = [...Array(b).fill(0), ...Array(a).fill(1), ...Array(r).fill(-1), ...Array(c).fill(0)];
  const clamp = [...Array(b + a + r).fill(false), ...Array(c).fill(true)];
  return { p, clamp };
}
