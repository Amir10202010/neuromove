// The observatory summary a workspace shows for one series: assembled from the engine pieces, on series with a
// known answer.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../lib/random';
import type { LearningMetric, LearningSeries, SessionObservation } from '../dataset';
import { BASELINE_SESSIONS, observeSeries, participantTransfer } from './summary';

function seriesOf(means: number[], o: { reps?: number; metric?: LearningMetric; exercise?: LearningSeries['exercise']; seed?: number; sd?: number; within?: (i: number) => number } = {}): LearningSeries {
  const rng = createRng(o.seed ?? 77);
  const reps = o.reps ?? 3;
  const metric = o.metric ?? 'rom';
  const exercise = o.exercise ?? 'shoulder_flexion';
  const sessions: SessionObservation[] = means.map((m, k) => {
    const r = Array.from({ length: reps }, (_, i) => m + (o.within ? o.within(i) : 0) + (o.sd ?? 3) * rng.normal());
    const mean = r.reduce((a, b) => a + b, 0) / reps;
    return { sessionId: `s${k}`, date: new Date(Date.UTC(2026, 0, 1 + 7 * k)).toISOString(), day: 7 * k, reps: r, n: reps, mean, sd: reps > 1 ? 3 : null, included: true, exclusions: [], simulated: true, doseBefore: null, practiceCountBefore: null, signalPercent: 100, algorithmVersion: 'nm-core 0.2.0', appVersion: 'test' };
  });
  return { key: `SYN|${exercise}|right|${metric}`, participantId: 'SYN', exercise, side: 'right', metric, unit: '°', sessions, doseSource: 'unknown' };
}

describe('observatory summary', () => {
  it('a stable series: no signal, the latest session inside the envelope, nothing to explain or falsify', () => {
    const s = seriesOf(Array(9).fill(100) as number[], { seed: 5 });
    const o = observeSeries(s, { all: [s], sessions: [] });
    expect(o.included).toHaveLength(9);
    expect(o.detection.status).toBe('no_change_signalled');
    expect(o.baseline.sessions).toBe(BASELINE_SESSIONS);
    expect(o.baseline.envelope.status).toBe('usable');
    expect(o.baseline.latest!.outside).toBe(false);
    expect(o.explanations!.conclusion).toBe('explained_by_measurement');
    expect(o.falsification).toBeNull();
    expect(o.sitting).toBeNull(); // three repetitions per session: no within-session analysis
    expect(o.planning!.repetitions).toBe(3);
    expect(o.planning!.options.map((a) => a.repetitions)).toEqual([1, 3, 5, 10]);
  });

  it('a lasting step: signalled, the latest session outside the envelope, and the open alternatives are named', () => {
    const s = seriesOf([100, 100, 100, 100, 100, 100, 125, 125, 125, 125], { seed: 9 });
    const o = observeSeries(s, { all: [s], sessions: [] });
    expect(o.detection.status).toBe('change_signalled');
    expect(o.detection.cusum.direction).toBe('up');
    expect(o.baseline.latest!.outside).toBe(true);
    expect(o.baseline.latest!.direction).toBe('above');
    // sensor budget, placement and task set-up are not available from stored aggregates → measurement is NOT excluded
    expect(o.explanations!.conclusion).toBe('measurement_not_excluded');
    expect(o.explanations!.open).toEqual(expect.arrayContaining(['sensor_placement']));
    expect(o.falsification).not.toBeNull();
    expect(o.falsification!.untested).toEqual(expect.arrayContaining(['independent_measurement']));
  });

  it('too few sessions: says so instead of producing an envelope or a detection', () => {
    const s = seriesOf([100, 104], { seed: 3 });
    const o = observeSeries(s, { all: [s], sessions: [] });
    expect(o.detection.status).toBe('insufficient_data');
    expect(o.baseline.envelope.status).toBe('insufficient');
    expect(o.baseline.latest).toBeNull();
    expect(o.explanations).toBeNull();
  });

  it('a long sitting is analysed with the sibling metrics of the same task', () => {
    const rise = (i: number) => 1.2 * i;
    const rom = seriesOf(Array(6).fill(100) as number[], { reps: 14, seed: 21, within: rise, sd: 1.5 });
    const vel = seriesOf(Array(6).fill(80) as number[], { reps: 14, seed: 22, metric: 'peak_velocity', within: rise, sd: 1.5 });
    const other = seriesOf(Array(6).fill(60) as number[], { reps: 14, seed: 23, exercise: 'elbow_flexion', within: () => 0 });
    const o = observeSeries(rom, { all: [rom, vel, other], sessions: [] });
    expect(o.sitting!.sessionId).toBe('s5');
    expect(o.sitting!.dynamics.features.map((f) => f.feature).sort()).toEqual(['amplitude', 'peak_rate']);
    expect(o.sitting!.dynamics.pattern).toBe('practice_like');
  });

  it('the transfer matrix of stored data never claims transfer: no task is designated', () => {
    const a = seriesOf([100, 102, 105, 107, 110, 113, 115, 118], { seed: 31 });
    const b = seriesOf([60, 61, 64, 66, 67, 70, 72, 75], { seed: 32, exercise: 'elbow_flexion' });
    const m = participantTransfer([a, b], 'rom');
    expect(m.nodes).toHaveLength(2);
    expect(m.hasTransferTask).toBe(false);
    expect(m.edges.every((e) => e.status !== 'transfer_candidate')).toBe(true);
  });
});
