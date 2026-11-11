// Benchmark registry — the permanent scientific regression suite of the research-frontier engines. One call
// collects every benchmark record: measurement science (M, U, E, R), strategy layer (S), learning observatory
// (O, W), twin layer (T), the twenty ground-truth scenarios (G01–G20) and the statistical safeguards (D).
//
// The older suites keep their own runners and files and are listed in EXISTING_SUITES so the registry is complete:
//   learning models  E1–E8, R1   lab/experiments.ts        research/data/model-validation.json
//   coordination     V1–V11      lab/coord/validation.ts   research/data/mcse-validation.json
//
// Quick mode (npm test) runs few replicates and asserts only that every benchmark executes; rates are meaningful in
// full mode only (FRONTIER_FULL=1 → research/data/frontier-benchmarks.json and scenario/latest.ts).
// A benchmark with a criterion that fails is a FINDING: it is listed in `failed`, documented in
// research/SCIENTIFIC_VALIDATION.md, and stays failing until the engine (never the criterion) changes.

import { round, wilson, type BenchmarkRecord, type BenchmarkSummary } from '../benchmark';
import { strategyValidation } from '../coord/strategyValidation';
import { benjaminiHochberg, holm } from '../discovery/multiplicity';
import { createRng } from '../../lib/random';
import { measureValidation } from '../measure/validation';
import { normCdf } from '../numeric';
import { observatoryValidation } from '../observatory/validation';
import { twinValidation } from '../twin/validation';
import { FRONTIER_VERSIONS } from '../version';
import { SCENARIOS, monteCarlo } from './engine';

/** Share of runs in which the engine did what a correct analysis must do; fixed before the first full run. */
export const SCENARIO_CRITERION = 0.8;
/** Scenarios whose expected outcome is itself a statistical test at 5 %: the criterion is its nominal error rate. */
export const SCENARIO_NULL = ['no_change'] as const;

export function scenarioBenchmarks(full: boolean): BenchmarkRecord[] {
  const mode = full ? 'full' : 'quick';
  return SCENARIOS.map((sc) => {
    const runs = full ? (sc.cost === 'slow' ? 40 : 400) : sc.cost === 'slow' ? 1 : 4;
    const mc = monteCarlo(sc.id, runs, 80_000 + 1000 * sc.number);
    const judged = mc ? mc.asExpected + mc.notAsExpected : 0;
    const rate = mc && judged ? mc.asExpected / judged : null;
    const [lo, hi] = mc && judged ? wilson(mc.asExpected, judged) : [NaN, NaN];
    const descriptive = !judged;
    const tallies = mc ? Object.fromEntries(Object.entries(mc.tallies).map(([k, v]) => [k, Object.entries(v).map(([a, b]) => `${a}:${b}`).join(' ')])) : {};
    return {
      id: `G${String(sc.number).padStart(2, '0')}`,
      name: `Scenario ${sc.number}: ${sc.name}`,
      purpose: sc.expected,
      assumptions: `${sc.process}. Simplification: ${sc.simplification}`,
      groundTruth: Object.entries(sc.truth).map(([k, v]) => `${k} = ${v}`).join(', '),
      metric: descriptive ? 'tallies of the engine\'s outputs (no right answer: the scenario violates an assumption)' : 'share of runs in which the engine did what a correct analysis must do',
      criterion: descriptive ? 'descriptive' : `≥ ${SCENARIO_CRITERION}`,
      cases: mc?.runs ?? 0,
      value: rate === null ? null : round(rate),
      detail: { level: sc.level, ...(rate === null ? {} : { ci95: `[${round(lo)}, ${round(hi)}]` }), ...tallies, related: sc.related.join(' ') },
      pass: descriptive || rate === null ? null : rate >= SCENARIO_CRITERION,
      knownFailureModes: [sc.simplification],
      component: 'scenario' as const,
      version: FRONTIER_VERSIONS.scenario,
      mode,
    };
  });
}

/** D1–D2: error-rate control of the multiplicity procedures (simulation with known nulls). */
export function discoveryBenchmarks(full: boolean): BenchmarkRecord[] {
  const mode = full ? 'full' : 'quick';
  const R = full ? 20_000 : 500;
  const rng = createRng(90_001);
  const p2 = (z: number) => 2 * (1 - normCdf(Math.abs(z)));
  let anyRaw = 0;
  let anyHolm = 0;
  let fdp = 0;
  let fdpRaw = 0;
  let power = 0;
  for (let r = 0; r < R; r++) {
    // family of 10 true nulls
    const ps = Array.from({ length: 10 }, () => p2(rng.normal()));
    if (ps.some((p) => p < 0.05)) anyRaw++;
    if (holm(ps).some((a) => a.reject)) anyHolm++;
    // 20 tests, 5 real effects of 3 SE
    const eff = Array.from({ length: 20 }, (_, i) => p2(rng.normal() + (i < 5 ? 3 : 0)));
    const bh = benjaminiHochberg(eff);
    const rej = bh.filter((a) => a.reject).length;
    const falseRej = bh.filter((a, i) => a.reject && i >= 5).length;
    fdp += rej ? falseRej / rej : 0;
    const rawRej = eff.filter((p) => p < 0.05).length;
    fdpRaw += rawRej ? eff.filter((p, i) => p < 0.05 && i >= 5).length / rawRej : 0;
    power += bh.filter((a, i) => a.reject && i < 5).length / 5;
  }
  const rec = (r: Omit<BenchmarkRecord, 'component' | 'version'>): BenchmarkRecord => ({ ...r, component: 'discovery', version: FRONTIER_VERSIONS.discovery });
  return [
    rec({
      id: 'D1', name: 'Holm: family-wise error over ten true nulls', purpose: 'When ten features are tested and none has changed, how often is at least one called changed — with and without adjustment?',
      assumptions: 'Ten independent two-sided z-tests, all null', groundTruth: 'No effect anywhere', metric: 'probability of at least one rejection after Holm adjustment', criterion: '≤ 0.055',
      cases: R, value: round(anyHolm / R), detail: { unadjusted_any_rejection: round(anyRaw / R) }, pass: anyHolm / R <= 0.055, knownFailureModes: ['controls errors only within the declared family: features examined but not reported are outside it'], mode,
    }),
    rec({
      id: 'D2', name: 'Benjamini–Hochberg: false discovery rate with real effects present', purpose: 'When 5 of 20 features truly changed, what share of the reported changes is false?',
      assumptions: '20 independent z-tests, 5 with a 3 SE effect', groundTruth: '5 real, 15 null', metric: 'mean false discovery proportion at q = 0.05', criterion: '≤ 0.055',
      cases: R, value: round(fdp / R), detail: { unadjusted_false_discovery_proportion: round(fdpRaw / R), power_for_the_real_effects: round(power / R) }, pass: fdp / R <= 0.055, knownFailureModes: ['valid for independent or positively dependent tests'], mode,
    }),
  ];
}

export function collectBenchmarks(full: boolean): BenchmarkRecord[] {
  return [...measureValidation(full), ...strategyValidation(full), ...observatoryValidation(full), ...twinValidation(full), ...scenarioBenchmarks(full), ...discoveryBenchmarks(full)];
}

export function summarise(records: readonly BenchmarkRecord[], generatedAt: string): BenchmarkSummary {
  const judged = records.filter((r) => r.pass !== null);
  return {
    generatedAt,
    mode: records.some((r) => r.mode === 'quick') ? 'quick' : 'full',
    versions: FRONTIER_VERSIONS,
    total: records.length,
    withCriterion: judged.length,
    passed: judged.filter((r) => r.pass).length,
    failed: judged.filter((r) => !r.pass).map((r) => r.id),
    descriptive: records.length - judged.length,
    cases: records.reduce((a, r) => a + r.cases, 0),
    records: [...records],
  };
}

export { DOCUMENTED_FAILURES, EXISTING_SUITES, type BenchmarkSummary } from '../benchmark';
