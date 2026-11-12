// Learning observatory: change detection, within-session patterns, estimability, transfer matrix.
import { describe, expect, it } from 'vitest';
import { createRng } from '../../lib/random';
import { analyzeSeries, DEFAULT_ANALYSIS_CONFIG } from '../analysis';
import type { LearningSeries, SessionObservation } from '../dataset';
import type { ChangeEstimate } from '../learning';
import { CALIBRATION, bayesChangePoint, detectChange, recursiveResiduals } from './changeDetection';
import { assessEstimability, type EstimabilityInput } from './estimability';
import { transferMatrix, type TransferNode } from './transfer';
import { featureDynamics, sittingDynamics } from './withinSession';

const noise = (n: number, seed: number, mu = 100, sd = 5) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => mu + sd * rng.normal());
};

describe('self-starting residuals', () => {
  it('are undefined for the first two sessions and standard normal afterwards (reference calculation)', () => {
    const u = recursiveResiduals([10, 12, 11, 15]);
    expect(u[0]).toBeNull();
    expect(u[1]).toBeNull();
    // third session: mean 11, SD √2, T = √(2/3)·(11 − 11)/√2 = 0 → U = 0
    expect(u[2]!).toBeCloseTo(0, 10);
    // fourth: mean 11, SD 1, T = √(3/4)·4 = 3.4641 ~ t(2) → P = ½ + T/(2√(2 + T²)) = 0.962912, U = Φ⁻¹(P) = 1.7856
    expect(u[3]!).toBeCloseTo(1.7856, 3);
  });
  it('have mean ≈ 0 and SD ≈ 1 under no change (20 000 residuals)', () => {
    const all: number[] = [];
    for (let s = 0; s < 1200; s++) for (const v of recursiveResiduals(noise(20, 1000 + s)).slice(2)) if (v !== null) all.push(v);
    const m = all.reduce((a, b) => a + b, 0) / all.length;
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / (all.length - 1));
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(sd).toBeGreaterThan(0.97);
    expect(sd).toBeLessThan(1.03);
  });
  it('do not depend on the unit or level of the metric', () => {
    const y = noise(12, 5);
    const a = recursiveResiduals(y);
    const b = recursiveResiduals(y.map((v) => 3 * v + 40));
    a.forEach((v, i) => (v === null ? expect(b[i]).toBeNull() : expect(b[i]!).toBeCloseTo(v, 9)));
  });
});

describe('change detection', () => {
  it('thresholds are calibrated for every horizon and grow with the horizon and with stricter α', () => {
    for (const h of [10, 20, 40] as const) expect(CALIBRATION[h].length).toBeGreaterThanOrEqual(5);
    expect(CALIBRATION[20][0]!.cusumH).toBeGreaterThan(CALIBRATION[10][0]!.cusumH);
    expect(CALIBRATION[20][4]!.cusumH).toBeGreaterThan(CALIBRATION[20][0]!.cusumH);
  });
  it('needs four sessions', () => {
    const d = detectChange([100, 104, 99]);
    expect(d.status).toBe('insufficient_data');
    expect(d.bayes).toBeNull();
  });
  it('signals a clear, lasting step and reports its direction and position', () => {
    const y = [...noise(8, 3), ...noise(8, 4, 118)];
    const d = detectChange(y);
    expect(d.status).toBe('change_signalled');
    expect(d.cusum.direction).toBe('up');
    expect(d.cusum.alarmAt!).toBeGreaterThanOrEqual(8);
    expect(d.cusum.alarmAt!).toBeLessThanOrEqual(11);
    expect(d.bayes!.pChange).toBeGreaterThan(0.95);
    expect(Math.abs(d.bayes!.mostLikelyAfter - 8)).toBeLessThanOrEqual(1);
    expect(d.bayes!.shift).toBeGreaterThan(12);
    expect(d.corroborated).toBe(true);
  });
  it('does not signal on a stable series and says that no signal is not evidence of stability when the series is short', () => {
    const d = detectChange(noise(6, 11));
    expect(d.status).toBe('no_change_signalled');
    expect(d.notes.join(' ')).toMatch(/no_signal_is_not_evidence_of_stability/);
  });
  it('the Bayesian posterior is reported at three prior scales', () => {
    const b = bayesChangePoint([...noise(8, 3), ...noise(8, 4, 108)])!;
    expect(b.sensitivity.map((s) => s.scale)).toEqual([0.5, 1, 2]);
    expect(b.tau.reduce((a, t) => a + t.p, 0)).toBeCloseTo(1, 9);
    expect(bayesChangePoint([1, 2, 3, 4])).toBeNull();
  });
  it('monitoring a family of features uses stricter thresholds', () => {
    const y = noise(20, 9);
    expect(detectChange(y, { family: 5 }).cusum.h).toBeGreaterThan(detectChange(y).cusum.h);
    expect(detectChange(y, { family: 5 }).alpha).toBeCloseTo(0.01, 10);
  });
  it('acceptance test F — missing sessions are not interpolated; the evidence weakens accordingly', () => {
    const y = [...noise(8, 3), ...noise(8, 4, 112)];
    const all = detectChange(y);
    // sessions 9, 11, 13 and 15 were not held
    const observed = y.filter((_, i) => ![9, 11, 13, 15].includes(i));
    const part = detectChange(observed);
    expect(part.sessions).toBe(12);
    expect(part.u.length).toBe(12);
    expect(part.cusum.pos.length).toBe(12);
    // fewer observations after the change → less accumulated evidence
    expect(Math.max(...part.cusum.pos)).toBeLessThan(Math.max(...all.cusum.pos));
    expect(part.bayes!.pChange).toBeLessThanOrEqual(all.bayes!.pChange + 1e-9);
  });
});

describe('within-session dynamics', () => {
  const rng = createRng(21);
  const run = (n: number, f: (i: number) => number, sd = 1) => Array.from({ length: n }, (_, i) => f(i) + sd * rng.normal());
  it('needs 8 repetitions: an assessment step of 3 is always insufficient', () => {
    expect(sittingDynamics({ amplitude: [100, 104, 99], duration: [1.2, 1.1, 1.3] }).pattern).toBe('insufficient_repetitions');
    expect(featureDynamics('amplitude', [1, 2, 3, 4, 5]).p).toBeNull();
    expect(featureDynamics('amplitude', [1, 2, 3, 4, 5]).pLinear).toBeNull();
  });
  it('recognises a practice-like and a decline-like pattern across features, on the performance-up convention', () => {
    const up = sittingDynamics({ amplitude: run(24, (i) => 100 + 0.6 * i, 3), peak_rate: run(24, (i) => 200 + 2 * i, 10), duration: run(24, (i) => 1.4 - 0.012 * i, 0.05) });
    expect(up.pattern).toBe('practice_like');
    expect(up.features.find((f) => f.feature === 'duration')!.direction).toBe('up');
    const down = sittingDynamics({ amplitude: run(24, (i) => 115 - 0.6 * i, 3), duration: run(24, (i) => 1.1 + 0.012 * i, 0.05) });
    expect(down.pattern).toBe('decline_like');
    expect(JSON.stringify(down.pattern)).not.toMatch(/fatigue/);
    expect(down.notes.join(' ')).toMatch(/not_a_diagnosis/);
  });
  it('recognises a rise followed by a decline, and reports disagreement between features as mixed', () => {
    const hump = (i: number) => (i < 15 ? i : 30 - i);
    const r = sittingDynamics({ amplitude: run(30, (i) => 100 + 1.2 * hump(i), 3), peak_rate: run(30, (i) => 200 + 4 * hump(i), 10) });
    expect(r.pattern).toBe('rise_then_decline');
    const a = r.features.find((f) => f.feature === 'amplitude')!;
    expect(a.shape).toBe('broken_stick');
    expect(Math.abs(a.breakAt! - 15)).toBeLessThanOrEqual(3);
    const mixed = sittingDynamics({ amplitude: run(24, (i) => 100 + 0.8 * i, 3), peak_rate: run(24, (i) => 260 - 3 * i, 10) });
    expect(mixed.pattern).toBe('mixed');
  });
  it('reports no trend for a flat sitting', () => {
    expect(sittingDynamics({ amplitude: run(24, () => 100, 3), duration: run(24, () => 1.2, 0.05) }).pattern).toBe('no_trend_detected');
  });
});

// ── estimability ────────────────────────────────────────────────────────────────────────────────────────

function seriesOf(means: number[], o: { reps?: number; gapDays?: number; dose?: (number | null)[] } = {}): LearningSeries {
  const rng = createRng(77);
  const reps = o.reps ?? 3;
  const sessions: SessionObservation[] = means.map((m, k) => {
    const r = Array.from({ length: reps }, () => m + 3 * rng.normal());
    const mean = r.reduce((a, b) => a + b, 0) / reps;
    return { sessionId: `s${k}`, date: new Date(Date.UTC(2026, 0, 1 + (o.gapDays ?? 7) * k)).toISOString(), day: (o.gapDays ?? 7) * k, reps: r, n: reps, mean, sd: reps > 1 ? 3 : null, included: true, exclusions: [], simulated: true, doseBefore: o.dose ? (o.dose[k] ?? null) : null, practiceCountBefore: o.dose ? ((o.dose[k] ?? 0) > 0 ? 1 : 0) : null, signalPercent: 100, algorithmVersion: 'nm-core 0.2.0', appVersion: 'test' };
  });
  return { key: 'SYN|shoulder_flexion|right|rom', participantId: 'SYN', exercise: 'shoulder_flexion', side: 'right', metric: 'rom', unit: '°', sessions, doseSource: o.dose ? 'practice_records' : 'unknown' };
}
const base = (series: LearningSeries, over: Partial<EstimabilityInput> = {}): EstimabilityInput => ({ series, analysis: null, practiceSittings: [], practiceLog: false, transferTasks: [], retentionSessionIds: [], sessionsWithSeveralConditions: 0, externalMdc: false, rawAvailable: false, ...over });

describe('estimability of the learning decomposition', () => {
  it('a single session supports almost nothing — and says what is missing', () => {
    const e = assessEstimability(base(seriesOf([100])));
    const by = Object.fromEntries(e.map((t) => [t.term, t]));
    expect(by.baseline_state!.status).toBe('not_estimable');
    expect(by.between_session_change!.status).toBe('not_estimable');
    expect(by.retained_learning!.status).toBe('not_estimable');
    expect(by.retained_learning!.missing.join(' ')).toMatch(/retention test/);
    expect(by.transfer!.status).toBe('not_estimable');
    expect(by.practice_response!.missing.join(' ')).toMatch(/practice sittings/);
    expect(by.measurement_error!.status).toBe('partly_estimable');
    for (const t of e) expect(t.falsifiedBy.length).toBeGreaterThan(10);
  });
  it('eight weekly assessment sessions: change is estimable, practice response and retention are not', () => {
    const s = seriesOf([100, 101, 103, 104, 107, 108, 110, 111]);
    const e = assessEstimability(base(s, { analysis: analyzeSeries(s, { ...DEFAULT_ANALYSIS_CONFIG, bootstrap: 0 }) }));
    const by = Object.fromEntries(e.map((t) => [t.term, t]));
    expect(by.between_session_change!.status).toBe('estimable');
    expect(by.practice_response!.status).toBe('not_estimable');
    expect(by.retained_learning!.status).toBe('not_estimable');
    // regular weekly schedule: forgetting cannot be told from saturation
    expect(by.forgetting!.status).toBe('not_estimable');
    expect(by.task_effect!.status).toBe('not_estimable');
  });
  it('fatigue is never more than partly estimable: perceived fatigue is not recorded', () => {
    const e = assessEstimability(base(seriesOf([100, 101, 102]), { practiceSittings: [30] }));
    const f = e.find((t) => t.term === 'fatigue_like_effect')!;
    expect(f.status).toBe('partly_estimable');
    expect(f.missing.join(' ')).toMatch(/perceived fatigue/);
    expect(e.find((t) => t.term === 'practice_response')!.status).toBe('estimable');
  });
  it('transfer needs a designated untrained task', () => {
    const s = seriesOf([100, 104, 108]);
    expect(assessEstimability(base(s, { transferTasks: ['elbow_flexion:right'] })).find((t) => t.term === 'transfer')!.missing.join(' ')).toMatch(/trained task/);
    expect(assessEstimability(base(s, { transferTasks: ['shoulder_flexion:right'] })).find((t) => t.term === 'transfer')!.status).toBe('estimable');
  });
});

describe('task transfer matrix', () => {
  const ch = (delta: number, se: number): ChangeEstimate => ({ fromSessionId: 'a', toSessionId: 'b', days: 56, delta, se, exceedsNoise: Math.abs(delta) > 1.96 * se, exceedsExternalMdc: null });
  const node = (task: string, role: TransferNode['role'], change: ChangeEstimate | null, sessions = 8): TransferNode => ({ task, role, sessions, change, up: 1 });
  it('calls transfer a candidate only for a designated untrained task that changed with the trained one', () => {
    const m = transferMatrix([node('flexion:right', 'trained', ch(15, 3)), node('abduction:right', 'transfer', ch(9, 3)), node('elbow:right', 'transfer', ch(1, 3)), node('flexion:left', 'undesignated', ch(8, 3))]);
    const e = (to: string) => m.edges.find((x) => x.from === 'flexion:right' && x.to === to)!;
    expect(e('abduction:right').status).toBe('transfer_candidate');
    expect(e('abduction:right').ratio!).toBeCloseTo(0.6, 10);
    expect(e('abduction:right').reason).toMatch(/not excluded/);
    expect(e('elbow:right').status).toBe('no_change_in_untrained_task');
    expect(e('flexion:left').status).toBe('not_assessable');
    expect(m.hasTransferTask).toBe(true);
  });
  it('without a designated transfer task nothing is called transfer, and unmeasured tasks get no edge', () => {
    const m = transferMatrix([node('flexion:right', 'trained', ch(15, 3)), node('abduction:right', 'trained', ch(9, 3)), node('elbow:right', 'undesignated', null, 1)]);
    expect(m.hasTransferTask).toBe(false);
    expect(m.edges.every((x) => x.status !== 'transfer_candidate')).toBe(true);
    expect(m.edges.find((x) => x.to === 'abduction:right' && x.from === 'flexion:right')!.status).toBe('co_change_only');
    expect(m.edges.find((x) => x.to === 'elbow:right')!.status).toBe('not_assessable');
    expect(m.notes.join(' ')).toMatch(/no_task_is_designated_as_untrained/);
  });
  it('a trained task that did not change has nothing to transfer', () => {
    const m = transferMatrix([node('flexion:right', 'trained', ch(2, 3)), node('abduction:right', 'transfer', ch(9, 3))]);
    expect(m.edges[0]!.status).toBe('trained_task_did_not_change');
  });
});
