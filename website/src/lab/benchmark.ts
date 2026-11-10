// Benchmark record — the unit of NeuroMove's scientific regression suite. Every research algorithm added on
// 2026-11-10 has one or more records: what it is for, what was assumed, what the ground truth was, how it was scored,
// the criterion fixed BEFORE the run, the number of cases actually executed and the value actually obtained.
//
// A failed criterion is a finding to report (research/SCIENTIFIC_VALIDATION.md), never a reason to edit the criterion
// or the data. Records are produced by the `validation.ts` of each layer and collected by lab/scenario/benchmarks.ts.
// ALL benchmark data are SYNTHETIC: a passing benchmark shows that the implementation behaves as specified under
// the stated generative assumptions — it is not evidence about real participants.

import type { FrontierComponent } from './version';

export interface BenchmarkRecord {
  id: string;
  name: string;
  /** Scientific purpose: the question the benchmark answers. */
  purpose: string;
  /** Input assumptions of the generator and of the method. */
  assumptions: string;
  groundTruth: string;
  /** Evaluation metric. */
  metric: string;
  /** Pass rule fixed before the run; 'descriptive' when the benchmark only characterises behaviour. */
  criterion: string;
  /** Simulation runs / test cases actually executed for this record. */
  cases: number;
  /** Primary result (the number the criterion is applied to). */
  value: number | null;
  detail: Record<string, number | string>;
  /** null = descriptive (no criterion). */
  pass: boolean | null;
  knownFailureModes: string[];
  component: FrontierComponent;
  version: string;
  mode: 'quick' | 'full';
}

export const round = (x: number, digits = 3): number => {
  if (!Number.isFinite(x)) return x;
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};

/** Wilson score interval for a proportion (used for every reported rate: coverage, false alarms, power). */
export function wilson(successes: number, n: number, z = 1.959963984540054): [number, number] {
  if (!(n > 0)) return [NaN, NaN];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
