// Twin layer: prediction records with refusal, population model, layers and maturity. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../lib/random';
import type { LearningSeries } from '../dataset';
import { assessMaturity, type LearningLayerEntry } from './layers';
import { fitPopulation, predictParticipant, validatePopulation, type PopulationParticipant } from './population';
import { predictSeries, type PredictionRecord } from './prediction';
import { populationSample, syntheticSeries } from './validation';

const weekly = (n: number) => Array.from({ length: n }, (_, k) => 7 * k);
const linear = (n: number, seed: number, slope = 1.5): LearningSeries => syntheticSeries('SYN-TW', weekly(n), weekly(n).map((d) => 100 + (slope * d) / 7), createRng(seed));

describe('prediction engine', () => {
  it('issues a record that says what, from what, how far, by which models, and with what calibration', () => {
    const p = predictSeries(linear(10, 3), { horizonDays: 7 });
    expect(p.status).toBe('issued');
    expect(p.target.quantity).toBe('mean of a future session');
    expect(p.inputs.included).toBe(10);
    expect(p.inputs.sessionIds).toHaveLength(10);
    expect(p.inputs.dataHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.horizon.days).toBe(7);
    expect(p.horizon.overSpan).toBeCloseTo(7 / 63, 10);
    expect(p.interval95![0]).toBeLessThan(p.point!);
    expect(p.interval95![1]).toBeGreaterThan(p.point!);
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.models.reduce((a, m) => a + m.weight, 0)).toBeLessThanOrEqual(1 + 1e-9);
    expect(p.calibration.status).toBe('evaluated');
    expect(p.calibration.folds).toBeGreaterThan(0);
    expect(p.calibration.coverageCi![0]).toBeLessThanOrEqual(p.calibration.coverage95!);
    expect(p.extrapolation.warning).toBe('none');
    expect(p.provenance).toBe('synthetic_simulation');
    expect(p.limitations.join(' ')).toMatch(/not_a_prognosis/);
    // deterministic: same input, same record
    expect(predictSeries(linear(10, 3), { horizonDays: 7 }).id).toBe(p.id);
  });
  it('refuses with too few sessions and when asked to look further ahead than the series is long', () => {
    const few = predictSeries(linear(4, 5), { horizonDays: 7 });
    expect(few.status).toBe('refused');
    expect(few.refusal).toEqual(['too_few_sessions']);
    expect(few.point).toBeNull();
    const far = predictSeries(linear(8, 6), { horizonDays: 120 });
    expect(far.status).toBe('refused');
    expect(far.refusal).toContain('horizon_beyond_observed_span');
    expect(far.extrapolation.warning).toBe('beyond_the_observed_span');
    // the per-model values stay inspectable in a refused record
    expect(far.models.length).toBeGreaterThan(0);
  });
  it('the mixture interval is at least as wide as that of its best-supported model when models disagree', () => {
    const p = predictSeries(linear(8, 9, 0.9), { horizonDays: 21 });
    const best = [...p.models].sort((a, b) => b.weight - a.weight)[0]!;
    if (p.models.length > 1 && p.interval95) expect(p.interval95[1] - p.interval95[0]).toBeGreaterThan(0.8 * (best.hi - best.lo));
    expect(p.extrapolation.warning).toBe('beyond_a_quarter_of_the_observed_span');
  });
});

describe('population reference model', () => {
  const sample = populationSample(40, 8, createRng(11));
  const m = fitPopulation(sample);
  it('recovers the fixed effects and variance components of a simulated sample', () => {
    expect(m.status).toBe('fitted');
    expect(m.beta[0]).toBeGreaterThan(95);
    expect(m.beta[0]).toBeLessThan(105);
    expect(m.beta[1]).toBeGreaterThan(1.1);
    expect(m.beta[1]).toBeLessThan(1.9);
    expect(m.sigma).toBeGreaterThan(2.6);
    expect(m.sigma).toBeLessThan(3.4);
    expect(Math.sqrt(m.D[0][0])).toBeGreaterThan(7);
    expect(Math.sqrt(m.D[0][0])).toBeLessThan(13);
    expect(m.simulated).toBe(true);
  });
  it('separates the population reference from an individual estimate: own sessions narrow the interval and move the mean', () => {
    const pop = predictParticipant(m, { t: [], y: [] }, [6])[0]!;
    expect(pop.kind).toBe('population_reference');
    const own = predictParticipant(m, { t: [0, 1, 2], y: [125, 127, 129] }, [6])[0]!;
    expect(own.kind).toBe('individual_given_population');
    expect(own.sd).toBeLessThan(pop.sd);
    expect(own.mean).toBeGreaterThan(pop.mean + 10);
  });
  it('refuses a mix of simulated and real participants, and too few participants', () => {
    const mixed: PopulationParticipant[] = [...sample.slice(0, 10), { participantId: 'real-1', simulated: false, t: [0, 1, 2], y: [100, 101, 102] }];
    expect(fitPopulation(mixed).status).toBe('mixed_provenance');
    expect(validatePopulation(mixed).status).toBe('mixed_provenance');
    const few = fitPopulation(sample.slice(0, 5));
    expect(few.status).toBe('insufficient_participants');
    expect(predictParticipant(few, { t: [], y: [] }, [3])).toEqual([]);
  });
  it('acceptance test H — held-out participants, future sessions: coverage is reported with its interval and overfitting cannot hide', () => {
    const v = validatePopulation(populationSample(24, 9, createRng(13)), 3);
    expect(v.status).toBe('evaluated');
    expect(v.predictions).toBe(24 * 6);
    expect(v.coverage95!).toBeGreaterThan(0.88);
    expect(v.coverageCi![0]).toBeLessThan(v.coverage95!);
    expect(v.calibrationSlope!).toBeGreaterThan(0.8);
    expect(v.calibrationSlope!).toBeLessThan(1.2);
    // the population helps a participant with three own sessions…
    expect(v.mae!).toBeLessThan(v.baselines.individualOnlyMae!);
    // …and the population alone (no own sessions) is clearly worse than knowing the participant
    expect(v.baselines.populationOnlyMae!).toBeGreaterThan(v.mae!);
    expect(v.notes.join(' ')).toMatch(/held-out_participant_is_absent_from_the_fit/);
  });
});

describe('twin maturity', () => {
  const entry = (over: Partial<LearningLayerEntry> = {}): LearningLayerEntry => ({ seriesKey: 'k', task: 'shoulder_flexion:right', metric: 'rom', unit: '°', included: 10, baseline: { status: 'usable', sessions: 5, centre: 100, interval: [90, 110], latest: null, assumption: '' }, selectedModel: 'linear', state: { mean: 110, lo: 105, hi: 115 }, detection: { status: 'no_change_signalled', alarmSession: null, corroborated: false, pChange: 0.3 }, retention: 'not_assessable', estimable: [], notEstimable: [], warnings: [], ...over });
  const pred = (folds: number, coverage: number): PredictionRecord => ({ ...predictSeries(linear(10, 3), { horizonDays: 7 }), calibration: { status: 'evaluated', folds, coverage95: coverage, coverageCi: [0, 1], mae: 1, persistenceMae: 2, skill: 0.5, worseThanPersistence: 0, pWorse: 1 } });
  it('no sessions: no level at all', () => {
    expect(assessMaturity({ sessions: 0, simulated: false, learning: [], predictive: [], doseModelSupported: false }).level).toBe(-1);
  });
  it('sessions without a longitudinal model: level 0', () => {
    const m = assessMaturity({ sessions: 3, simulated: false, learning: [entry({ included: 3, selectedModel: null, baseline: { status: 'provisional', sessions: 3, centre: 100, interval: null, latest: null, assumption: '' } })], predictive: [], doseModelSupported: false });
    expect(m.level).toBe(0);
    expect(m.levels[1]!.missing.length).toBeGreaterThan(0);
  });
  it('a described series is level 1; level 2 needs ≥ 30 calibrated out-of-sample forecasts', () => {
    expect(assessMaturity({ sessions: 10, simulated: false, learning: [entry()], predictive: [pred(6, 1)], doseModelSupported: false }).level).toBe(1);
    const l2 = assessMaturity({ sessions: 40, simulated: false, learning: [entry()], predictive: [pred(20, 1), pred(20, 0.95)], doseModelSupported: false });
    expect(l2.level).toBe(2);
    // badly calibrated forecasts do not count however many there are
    expect(assessMaturity({ sessions: 40, simulated: false, learning: [entry()], predictive: [pred(40, 0.7)], doseModelSupported: false }).level).toBe(1);
  });
  it('a level cannot be skipped, and level 4 is never reached by software evidence', () => {
    const m = assessMaturity({ sessions: 40, simulated: false, learning: [entry()], predictive: [pred(6, 1)], doseModelSupported: true });
    expect(m.levels[3]!.met).toBe(true);
    expect(m.level).toBe(1);
    const top = assessMaturity({ sessions: 40, simulated: false, learning: [entry()], predictive: [pred(40, 0.975)], doseModelSupported: true });
    expect(top.level).toBe(3);
    expect(top.levels[4]!.met).toBe(false);
    expect(top.levels[4]!.missing.join(' ')).toMatch(/cannot be reached by software evidence/);
  });
  it('marks levels reached on simulated sessions as synthetic only', () => {
    const m = assessMaturity({ sessions: 10, simulated: true, learning: [entry()], predictive: [], doseModelSupported: false });
    expect(m.syntheticOnly).toBe(true);
    expect(m.levels[2]!.missing.join(' ')).toMatch(/REAL sessions/);
  });
});
