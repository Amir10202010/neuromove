// Test–retest reliability on synthetic ground truth: true between-participant SD 15, measurement SD 3 per session
// mean ⇒ ICC ≈ 225 / (225 + 9) ≈ 0.96, SEM ≈ 3, MDC95 ≈ 8.3.

import { describe, expect, it } from 'vitest';
import { createRng } from '../lib/random';
import type { LearningSeries, SessionObservation } from './dataset';
import { retestPairs, retestReliability } from './reliability';

function participant(id: string, truth: number, rng: ReturnType<typeof createRng>, o: { days?: number; dose?: number | null } = {}): LearningSeries {
  const days = o.days ?? 5;
  const mk = (k: number, day: number): SessionObservation => {
    const m = truth + rng.normal(0, 3);
    return { sessionId: `${id}-s${k}`, date: new Date(Date.UTC(2026, 9, 1 + day)).toISOString(), day, reps: [m], n: 1, mean: m, sd: null, included: true, exclusions: [], simulated: true, doseBefore: k === 0 ? 0 : (o.dose === undefined ? 0 : o.dose), practiceCountBefore: k === 0 ? 0 : o.dose === null ? null : o.dose ? 1 : 0, signalPercent: 100, algorithmVersion: 'x', appVersion: 'x' };
  };
  return { key: `${id}|shoulder_flexion|right|rom`, participantId: id, exercise: 'shoulder_flexion', side: 'right', metric: 'rom', unit: '°', sessions: [mk(0, 0), mk(1, days)], doseSource: o.dose === null ? 'unknown' : 'practice_records' };
}

describe('test–retest reliability', () => {
  it('recovers ICC, SEM and MDC95 from 40 synthetic participants', () => {
    const rng = createRng(11);
    const series = Array.from({ length: 40 }, (_, i) => participant(`p${i}`, 120 + rng.normal(0, 15), rng));
    const [r] = retestReliability(series);
    expect(r!.pairs.length).toBe(40);
    expect(r!.sufficiency).toBe('adequate');
    expect(r!.icc!.agreement).toBeGreaterThan(0.9);
    expect(r!.icc!.agreement).toBeLessThan(0.99);
    expect(r!.icc!.semAgreement).toBeGreaterThan(2.2);
    expect(r!.icc!.semAgreement).toBeLessThan(4);
    expect(r!.icc!.mdc95).toBeCloseTo(1.959963984540054 * Math.SQRT2 * r!.icc!.semAgreement, 10);
  });

  it('excludes pairs with practice in between, too far apart, or (by default) unknown practice', () => {
    const rng = createRng(12);
    expect(retestPairs(participant('a', 100, rng, { dose: 20 })).reason).toBe('practice_recorded');
    expect(retestPairs(participant('b', 100, rng, { days: 14 })).reason).toBe('too_far_apart');
    expect(retestPairs(participant('c', 100, rng, { dose: null })).reason).toBe('practice_unknown');
    expect(retestPairs(participant('c2', 100, rng, { dose: null }), { maxDays: 7, includeUnknownPractice: true }).pair?.practice).toBe('unknown');
    const [r] = retestReliability([participant('d', 100, rng, { dose: 20 }), participant('e', 110, rng, { dose: null })]);
    expect(r!.pairs).toEqual([]);
    expect(r!.skipped).toEqual({ practiceRecorded: 1, practiceUnknown: 1, tooFarApart: 0 });
    expect(r!.icc).toBeNull();
    expect(r!.sufficiency).toBe('none');
  });
});
