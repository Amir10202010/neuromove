// Ground-truth scenario engine: the registry is complete, runs are deterministic, and the scenarios do what a
// correct analysis must do on a fixed seed. Rates over many seeds are the business of the benchmark runner.
import { describe, expect, it } from 'vitest';
import { SCENARIOS, monteCarlo, scenario } from './engine';
import { DOCUMENTED_FAILURES, EXISTING_SUITES, discoveryBenchmarks, summarise } from './benchmarks';

describe('scenario registry', () => {
  it('has the twenty scenarios, numbered, each with its process, hidden truth, expectation and simplification', () => {
    expect(SCENARIOS).toHaveLength(20);
    expect(SCENARIOS.map((s) => s.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(20);
    for (const s of SCENARIOS) {
      expect(s.process.length, s.id).toBeGreaterThan(20);
      expect(Object.keys(s.truth).length, s.id).toBeGreaterThan(0);
      expect(s.expected.length, s.id).toBeGreaterThan(15);
      expect(s.simplification.length, s.id).toBeGreaterThan(5);
    }
    // more than one kind of generative process
    expect(new Set(SCENARIOS.map((s) => s.level))).toEqual(new Set(['raw', 'series', 'within_session', 'population', 'labels']));
  });
  it('a run is reproducible from its seed', () => {
    for (const id of ['no_change', 'strategy_transition', 'practice_like', 'forgetting']) {
      const a = scenario(id)!.run(11);
      const b = scenario(id)!.run(11);
      expect(a).toEqual(b);
    }
    expect(scenario('nope')).toBeNull();
    expect(monteCarlo('nope', 3, 1)).toBeNull();
  });
  it('Monte Carlo reports the runs it actually executed and tallies the outputs', () => {
    const m = monteCarlo('practice_like', 6, 500)!;
    expect(m.runs).toBe(6);
    expect(m.asExpected + m.notAsExpected + m.descriptive).toBe(6);
    expect(Object.values(m.tallies.pattern!).reduce((a, b) => a + b, 0)).toBe(6);
  });
  it('descriptive scenarios never claim a right answer', () => {
    for (const id of ['measurement_variance', 'model_misspecification']) expect(scenario(id)!.run(3).verdict).toBe('descriptive');
  });
  it('raw-level scenarios: a missing trunk sensor produces no trunk value; re-attachment is not called a change', () => {
    const drop = scenario('sensor_dropout')!.run(7);
    expect(drop.observed.trunk_value_produced).toBe(false);
    expect(drop.observed.trunk_channel_unavailable).toBe(true);
    expect(drop.verdict).toBe('as_expected');
    const re = scenario('sensor_reattachment')!.run(7);
    expect(re.observed.outcome_verdict).not.toBe('beyond_noise');
  }, 60_000);
});

describe('benchmark registry', () => {
  it('summarises records: criteria, passes, failures, descriptive, cases', () => {
    const recs = discoveryBenchmarks(false);
    const s = summarise(recs, '2026-11-10T00:00:00.000Z');
    expect(s.total).toBe(2);
    expect(s.withCriterion).toBe(2);
    expect(s.passed + s.failed.length).toBe(2);
    expect(s.cases).toBe(recs.reduce((a, r) => a + r.cases, 0));
    expect(s.mode).toBe('quick');
    for (const r of recs) {
      expect(r.component).toBe('discovery');
      expect(r.knownFailureModes.length).toBeGreaterThan(0);
    }
  });
  it('lists the earlier suites and the documented failures', () => {
    expect(EXISTING_SUITES.map((s) => s.ids)).toEqual(['E1–E8, R1', 'V1–V11']);
    expect(DOCUMENTED_FAILURES).toEqual(['M2a', 'O2']);
  });
});
