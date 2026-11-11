// The jobs behind the research-frontier workspaces: the strategy atlas on a synthetic participant with a known
// answer, and the request dispatcher.
import { describe, expect, it } from 'vitest';
import { ATLAS_PARTITION_FEATURES, MAX_INTERACTIVE_RUNS, runFrontierJob, syntheticAtlas } from './frontierJobs';

describe('strategy atlas', () => {
  const atlas = syntheticAtlas(4100, 0);
  const diff = (i: number, id: string) => atlas.comparisons[i]!.differences.find((d) => d.id === id)!;

  it('builds one profile per recording, in time order, each compared with the first', () => {
    expect(atlas.profiles.map((p) => p.repetitions)).toEqual([12, 12, 12]);
    expect(atlas.profiles[0]!.placement).toBeNull();
    expect(atlas.profiles[1]!.placement!.reference).toBe(atlas.profiles[0]!.recordingId);
    expect(atlas.comparisons.map((c) => [c.a, c.b])).toEqual([
      [atlas.profiles[0]!.recordingId, atlas.profiles[1]!.recordingId],
      [atlas.profiles[0]!.recordingId, atlas.profiles[2]!.recordingId],
    ]);
    expect(atlas.partitions.map((p) => p.feature)).toEqual([...ATLAS_PARTITION_FEATURES]);
    expect(atlas.tradeoffs).toHaveLength(3);
    expect(atlas.synthetic).toBe(true);
    for (const p of atlas.profiles) expect(p.provenance.label).toBe('synthetic_simulation');
  });

  it('does not call a re-attachment a change of the movement (recording 2 = same plan, sensors put on again)', () => {
    // the outcome shifts by the calibration-posture error (≈ 6° × 1.4) but stays inside the placement bound
    expect(diff(0, 'outcome').verdict).not.toBe('beyond_noise');
    expect(diff(0, 'exc_trunk_pitch').verdict).not.toBe('beyond_noise');
  });

  it('finds the change of trunk involvement in recording 3 and does not report a change of the outcome', () => {
    expect(diff(1, 'exc_trunk_pitch').verdict).toBe('beyond_noise');
    expect(Math.abs(diff(1, 'exc_trunk_pitch').delta)).toBeGreaterThan(10);
    expect(diff(1, 'outcome').verdict).not.toBe('beyond_noise');
  });

  it('is a plain JSON value (crosses the worker boundary, can be sealed as evidence)', () => {
    expect(JSON.parse(JSON.stringify(atlas))).toEqual(atlas);
  });
});

describe('job dispatcher', () => {
  it('runs a scenario and a bounded Monte Carlo, and returns null for an unknown scenario', () => {
    const one = runFrontierJob({ kind: 'scenario', id: 'no_change', seed: 3 });
    expect(one.kind === 'scenario' && one.run?.scenario).toBe('no_change');
    const mc = runFrontierJob({ kind: 'montecarlo', id: 'practice_like', runs: 5, seed: 10 });
    expect(mc.kind === 'montecarlo' && mc.result?.runs).toBe(5);
    const capped = runFrontierJob({ kind: 'montecarlo', id: 'strategy_transition', runs: 10 * MAX_INTERACTIVE_RUNS, seed: 10 });
    expect(capped.kind === 'montecarlo' && capped.result?.runs).toBe(MAX_INTERACTIVE_RUNS);
    const none = runFrontierJob({ kind: 'scenario', id: 'nope', seed: 1 });
    expect(none.kind === 'scenario' && none.run).toBeNull();
  });
});
