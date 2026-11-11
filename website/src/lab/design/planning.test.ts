// Measurement planning: repetitions vs sessions, feature sensitivity, schedule information, model discrimination.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../lib/random';
import { fitModel } from '../fit';
import type { ModelData } from '../dataset';
import { allocation, compareNextSessions, discriminationDesign, powerForDifference, rankFeatureSensitivity, repetitionsWorthAdding, scheduleInformation, sessionsForDifference } from './planning';

const weekly = (n: number) => Array.from({ length: n }, (_, i) => 7 * i);
function synth(z: (d: number) => number, n: number, seed: number): ModelData {
  const rng = createRng(seed);
  const t = weekly(n);
  const y: number[] = [];
  const ss: number[] = [];
  for (const d of t) {
    const eta = rng.normal(0, 2.5);
    const r = [0, 1, 2].map(() => z(d) + eta + rng.normal(0, 4));
    const m = r.reduce((a, b) => a + b, 0) / 3;
    y.push(m);
    ss.push(r.reduce((a, v) => a + (v - m) ** 2, 0));
  }
  return { t, y, n: t.map(() => 3), dose: t.map(() => 0), ss, sessionIds: t.map((_, i) => `s${i}`) };
}

describe('repetitions versus sessions', () => {
  it('the SE of a level and of a slope follow the measurement model', () => {
    const a = allocation(4, 2.5, 3, 8);
    const v = 2.5 ** 2 + 16 / 3;
    expect(a.seLevel).toBeCloseTo(Math.sqrt(v / 8), 12);
    // sum of (t − mean)² for 8 weekly sessions = 42 weeks²
    expect(a.seSlopePerWeek!).toBeCloseTo(Math.sqrt(v / 42), 12);
    expect(a.mdcSession).toBeCloseTo(1.959963984540054 * Math.SQRT2 * Math.sqrt(v), 12);
    expect(allocation(4, 2.5, 3, 2).seSlopePerWeek).toBeNull();
  });
  it('more repetitions cannot go below the day-to-day floor', () => {
    expect(allocation(4, 2.5, 1000, 1).mdcSession).toBeGreaterThan(1.959963984540054 * Math.SQRT2 * 2.5);
    const few = repetitionsWorthAdding(4, 2.5, 3, 8);
    expect(few.removableShare).toBeCloseTo((16 / 3) / (6.25 + 16 / 3), 12);
    expect(few.floor).toBeCloseTo(6.25, 12);
    // repetition noise below 10 % of the variance of a session mean needs 9·σε²/σs² = 23.04 → 24 repetitions
    expect(few.enoughAt).toBe(24);
    const many = repetitionsWorthAdding(4, 2.5, 30, 8);
    expect(many.removableShare).toBeLessThan(0.1);
    expect(many.better).toBe('more_sessions');
    expect(many.explanation).toMatch(/only more sessions can/);
    // with almost no day-to-day variation and one repetition, another repetition is worth more than another session
    expect(repetitionsWorthAdding(4, 0.1, 1, 10).better).toBe('more_repetitions');
  });
  it('sample size and power for a difference of level are consistent', () => {
    const K = sessionsForDifference(4, 2.5, 3, 5)!;
    expect(powerForDifference(4, 2.5, 3, K, 5)).toBeGreaterThanOrEqual(0.8);
    expect(powerForDifference(4, 2.5, 3, K - 1, 5)).toBeLessThan(0.8);
    expect(sessionsForDifference(4, 2.5, 3, 0)).toBeNull();
  });
  it('ranks features by the relative change they could show', () => {
    const r = rankFeatureSensitivity([
      { feature: 'rom', unit: '°', mean: 120, sigmaE: 4, sigmaS: 2.5, repetitions: 3 },
      { feature: 'sparc', unit: '', mean: -1.6, sigmaE: 0.15, sigmaS: 0.1, repetitions: 3 },
    ]);
    expect(r[0]!.feature).toBe('rom');
    expect(r[0]!.mdcRelative!).toBeLessThan(r[1]!.mdcRelative!);
    expect(r[1]!.sessionsFor!).toBeGreaterThan(r[0]!.sessionsFor!);
  });
});

describe('information in a schedule', () => {
  const data = synth((d) => 100 + (1.5 * d) / 7, 8, 5);
  const { fit, prepared } = fitModel('linear', data, { doseMode: 'per_visit', profiles: false });
  it('the asymptotic SE of the slope from the information matches the closed form', () => {
    const info = scheduleInformation(fit, prepared, { t: prepared.t, dose: prepared.dose, n: prepared.n })!;
    const sS = fit.params[2] as number;
    const v = sS * sS + prepared.sigmaE2 / 3;
    expect(info.se.slope_per_week!).toBeCloseTo(Math.sqrt(v / 42), 4);
    expect(info.singular).toBe(false);
  });
  it('a later session adds more information about a slope than an immediate one (D and A criteria agree)', () => {
    const o = compareNextSessions(fit, prepared, [{ afterDays: 1, dose: 1 }, { afterDays: 28, dose: 1 }]);
    expect(o[1]!.dGain!).toBeGreaterThan(o[0]!.dGain!);
    expect(o[1]!.aRatio!).toBeLessThan(o[0]!.aRatio!);
    expect(o[0]!.aRatio!).toBeLessThan(1);
  });
  it('is not offered for the random-walk model (no deterministic mean structure)', () => {
    const ll = fitModel('local_level', data, { doseMode: 'per_visit', profiles: false });
    expect(scheduleInformation(ll.fit, ll.prepared, { t: prepared.t, dose: prepared.dose, n: prepared.n })).toBeNull();
  });
  it('two rival models are told apart better the further ahead a linear and a constant description diverge', () => {
    const st = fitModel('stationary', data, { doseMode: 'per_visit', profiles: false });
    const d = discriminationDesign(fit, st.fit, prepared, [7, 28, 56]);
    expect(d).toHaveLength(3);
    expect(d[2]!.separation).toBeGreaterThan(d[0]!.separation);
    expect(d[2]!.pCorrect).toBeGreaterThan(d[0]!.pCorrect);
    expect(d[0]!.pCorrect).toBeGreaterThanOrEqual(0.5);
  });
});
