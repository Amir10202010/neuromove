// Measurement-science layer: observability registry, placement, uncertainty propagation, personal envelope,
// test–retest. Synthetic data only (generator: coord/synthetic.ts, participants "SYN-*").
import { describe, expect, it } from 'vitest';
import { CHANNEL_IDS } from '../coord/channels';
import { STRATEGIES, generateSession, type Perturbations, type StrategySpec } from '../coord/synthetic';
import { FEATURES } from '../features';
import { METRICS } from '../../rehab/movement';
import { createRng } from '../../lib/random';
import { DEG, rotAxis } from '../../lib/vec3';
import { CHI2_1_95 } from '../numeric';
import { tQuantile } from '../../research/stats';
import { assessAgainstEnvelope, buildEnvelope, envelopeInterval, envelopePlanning, type EnvelopeSession } from './envelope';
import { comparePlacement, elbowErrorBound, mountDiagnostics, virtualRemount } from './placement';
import { reattachmentStudy, rotationSummary, sensitivity } from './reattachment';
import { MEASUREMENT_STATUSES, REGISTRY, displayDecimals, entriesByStatus, observableWith, provenanceOf, registryEntry } from './registry';
import { REP_FEATURE_IDS, REP_FEATURE_REGISTRY, recordingFeatures } from './repFeatures';
import { reliabilityAt, retestReport, varianceComponents, type RetestParticipant } from './retest';
import { chi2Quantile, kendallTau, sdInterval } from './stats';
import { MPU6050_UNCERTAINTY, changeUncertainty, perturbFrames, propagateUncertainty } from './uncertainty';

const SEQ: StrategySpec[] = [STRATEGIES.armDominant, STRATEGIES.trunkAssisted, STRATEGIES.elbowFlexed, STRATEGIES.trunkLeading];
const session = (seed: number, perturb?: Perturbations, n = 8) =>
  generateSession({ participantId: 'SYN-MT', sessionIndex: 0, exercise: 'shoulder_flexion', side: 'right', sequence: Array.from({ length: n }, (_, i) => SEQ[i % 4] as StrategySpec), duration: { mean: 1.2, cv: 0.1 }, amplitudeCv: 0.04, jitterDeg: 3, delayJitterSec: 0.03, seed, ...(perturb ? { perturb } : {}) });

describe('measurement observability registry', () => {
  it('has exactly one entry for every channel, repetition metric and movement feature that exists in the code', () => {
    for (const id of CHANNEL_IDS) expect(registryEntry(`channel.${id}`), `channel.${id}`).not.toBeNull();
    for (const id of Object.keys(METRICS)) expect(registryEntry(`metric.${id}`), `metric.${id}`).not.toBeNull();
    for (const id of Object.keys(FEATURES)) expect(registryEntry(`feature.${id}`), `feature.${id}`).not.toBeNull();
    expect(new Set(REGISTRY.map((e) => e.id)).size).toBe(REGISTRY.length);
  });
  it('every entry states its status, method, error model and interpretation limits', () => {
    for (const e of REGISTRY) {
      expect(MEASUREMENT_STATUSES).toContain(e.status);
      for (const k of ['physicalMeaning', 'method', 'errorModel', 'confidence', 'coordinateFrame', 'source'] as const) expect(e[k].length, `${e.id}.${k}`).toBeGreaterThan(0);
      expect(e.interpretationLimits.length, e.id).toBeGreaterThan(0);
    }
  });
  it('lists what three six-axis IMUs cannot observe, and never gives those a method or sensors', () => {
    const no = entriesByStatus('not_observable');
    for (const id of ['brain_activity', 'corticospinal_integrity', 'neural_activation', 'muscle_activity', 'muscle_force', 'spasticity', 'hand_trajectory', 'contact_force', 'scapular_motion', 'glenohumeral', 'heading']) {
      const e = no.find((x) => x.id === `unobservable.${id}`);
      expect(e, id).toBeDefined();
      expect(e!.sensors).toEqual([]);
      expect(e!.method).toMatch(/no estimate/);
    }
  });
  it('the only model-dependent kinematic channel is the humerothoracic estimate; raw rates are directly measured', () => {
    expect(registryEntry('channel.humerothoracic')!.status).toBe('model_estimated');
    expect(registryEntry('channel.upper_rate')!.status).toBe('directly_measured');
    expect(registryEntry('channel.upper_elev')!.status).toBe('derived');
    expect(registryEntry('prediction.next_session')!.status).toBe('predicted');
  });
  it('every repetition feature traces to a registry entry', () => {
    for (const f of REP_FEATURE_IDS) expect(registryEntry(REP_FEATURE_REGISTRY[f]), f).not.toBeNull();
  });
  it('logical sensor ablation: without the trunk sensor the trunk channels and the trunk contribution are lost, arm inclination stays', () => {
    const r = observableWith(['upper', 'fore']);
    const lost = r.lost.map((e) => e.id);
    expect(lost).toEqual(expect.arrayContaining(['channel.trunk_pitch', 'channel.humerothoracic', 'coordination.trunk_contribution', 'metric.trunk']));
    expect(r.available.map((e) => e.id)).toEqual(expect.arrayContaining(['channel.upper_elev', 'channel.elbow_flex', 'metric.rom']));
    expect(observableWith(['upper']).lost.map((e) => e.id)).toContain('channel.elbow_flex');
  });
  it('provenance labels: simulation always wins; predictions and estimates are never labelled as measurements', () => {
    expect(provenanceOf('derived', { simulated: true })).toBe('synthetic_simulation');
    expect(provenanceOf('predicted', { simulated: false })).toBe('model_prediction');
    expect(provenanceOf('model_estimated', { simulated: false })).toBe('model_estimate');
    expect(provenanceOf('derived', { simulated: false })).toBe('real_measurement');
    expect(provenanceOf('not_observable', { simulated: false, manual: true })).toBe('external_assessment');
    expect(provenanceOf('derived', { simulated: false, hypothetical: true })).toBe('hypothetical_scenario');
  });
  it('display precision follows the uncertainty', () => {
    expect(displayDecimals(0.73)).toBe(1);
    expect(displayDecimals(3.2)).toBe(0);
    expect(displayDecimals(0.04)).toBe(2);
    expect(displayDecimals(null)).toBe(1);
  });
});

describe('distribution helpers', () => {
  it('χ² quantiles match reference values', () => {
    expect(chi2Quantile(0.95, 1)).toBeCloseTo(CHI2_1_95, 8);
    expect(chi2Quantile(0.975, 10)).toBeCloseTo(20.483177350807, 6);
    expect(chi2Quantile(0.025, 10)).toBeCloseTo(3.246972780236, 6);
  });
  it('CI of an SD with 9 df (reference: √(9/19.0228), √(9/2.70039))', () => {
    const ci = sdInterval(1, 9)!;
    expect(ci[0]).toBeCloseTo(0.68784, 4);
    expect(ci[1]).toBeCloseTo(1.82561, 4);
  });
  it("Kendall's τ: perfect agreement 1, reversal −1, and a significant monotone trend", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(kendallTau(x, x).tau).toBeCloseTo(1, 12);
    expect(kendallTau(x, [...x].reverse()).tau).toBeCloseTo(-1, 12);
    const k = kendallTau(x, [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]);
    expect(k.tau).toBeCloseTo(35 / 45, 10);
    expect(k.p!).toBeLessThan(0.01);
    expect(kendallTau([1, 2, 3], [1, 2, 3]).p).toBeNull();
  });
});

describe('sensor placement', () => {
  const base = session(11);
  const fb = recordingFeatures(base.frames, base.meta, 'shoulder_flexion');
  const mount = mountDiagnostics(base.frames, fb.cs, fb.reps, 'shoulder_flexion');

  it('re-attachment study (quick): calibration-referenced features are invariant to sensor rotation; the elbow hinge and the trunk pitch/roll split are not', () => {
    const s = reattachmentStudy({ exercises: ['shoulder_flexion'], rotations: [10], postures: [5], shiftsCm: [4] });
    const row = (sensor: 'trunk' | 'upper' | 'fore', kind: string, feature: string, experiment = 'M2_rotation') => s.rows.find((r) => r.experiment === experiment && r.sensor === sensor && r.kind === kind && r.feature === feature)!;
    for (const f of ['outcome', 'exc_upper_elev', 'dur_outbound', 'peak_rate'])
      for (const kind of ['about_bone_axis', 'about_Y', 'about_Z']) expect(row('upper', kind, f).maxAbs, `${f} ${kind}`).toBeLessThan(0.02);
    expect(row('upper', 'about_bone_axis', 'exc_elbow_flex').maxAbs).toBeGreaterThan(0.5);
    expect(row('trunk', 'about_bone_axis', 'exc_trunk_roll').meanAbs).toBeGreaterThan(1);
    // M3: an arm held 5° forward in calibration shifts the task outcome by about −5°
    const post = row('upper', 'arm_forward', 'outcome', 'M3_calibration_posture');
    expect(post.meanSigned).toBeLessThan(-4);
    expect(post.meanSigned).toBeGreaterThan(-7);
    // M4: 4 cm along the bone changes the outcome by well under a degree
    expect(row('upper', 'along_bone', 'outcome', 'M4_translation').maxAbs).toBeLessThan(0.6);
    expect(sensitivity(s.rows, { experiment: 'M2_rotation', exercise: 'shoulder_flexion', sensor: 'upper', kind: 'about_Y', feature: 'outcome' })).toBeLessThan(0.01);
    const sum = rotationSummary(s, 'shoulder_flexion');
    expect(sum.find((x) => x.feature === 'outcome')!.invariant).toBe(true);
    expect(sum.find((x) => x.feature === 'exc_trunk_roll')!.invariant).toBe(false);
  });

  it('mount diagnostics: calibration tilt within the simulated 2–5° strap misalignment; functional axis near the mount-rule axis', () => {
    const upper = mount.sensors.find((s) => s.role === 'upper')!;
    expect(upper.tiltDeg).toBeLessThan(6);
    expect(upper.functionalAxis).not.toBeNull();
    expect(upper.functionalAxis!.deviationDeg).toBeLessThan(8);
    expect(upper.functionalAxis!.planarity).toBeGreaterThan(0.9);
    expect(mount.notes).toContain('trunk_sensor_rotation_about_the_vertical_is_not_observable');
  });

  it('placement confidence is unknown without a reference, high for the same mount, low after a tilted re-mount', () => {
    expect(comparePlacement(null, mount).level).toBe('unknown');
    expect(comparePlacement(mount, mount).level).toBe('high');
    // strap tilted by 8° about the sensor Y axis → calibration "up" moves 8° → worst-case angle bias 11°
    const tilted = virtualRemount(base.frames, 'upper_r', rotAxis([0, 1, 0], 8 * DEG));
    // a separate recording (its own id): within ONE recording there is no re-attachment to allow for
    const ft = recordingFeatures(tilted, { ...base.meta, id: 'syn-remounted' }, 'shoulder_flexion');
    const c = comparePlacement(mount, mountDiagnostics(tilted, ft.cs, ft.reps, 'shoulder_flexion'));
    const up = c.sensors.find((s) => s.role === 'upper')!;
    expect(up.deltaTiltDeg!).toBeGreaterThan(7);
    expect(up.deltaTiltDeg!).toBeLessThan(9);
    expect(c.level).toBe('low');
    const bias = c.expectedBias.find((b) => b.quantity.startsWith('upper-arm'))!;
    expect(bias.value).toBeGreaterThan(9);
    // the attribution bound adds the strap-tilt allowance (tilt and posture can cancel)
    expect(bias.attributionBound).toBeCloseTo(bias.value + 1.4 * 5, 6);
    // …and yet the measured outcome did not change at all (rotation-invariant): the bound is about POSTURE, which
    // the sensors cannot tell from tilt — the confidence is honest about not knowing which it was.
    expect(Math.abs(ft.reps[0]!.values.outcome! - fb.reps[0]!.values.outcome!)).toBeLessThan(0.05);
  });

  it('a rotation about the bone moves the functional axis, not the calibration tilt', () => {
    const turned = virtualRemount(base.frames, 'upper_r', rotAxis([1, 0, 0], 10 * DEG));
    const ft = recordingFeatures(turned, base.meta, 'shoulder_flexion');
    const c = comparePlacement(mount, mountDiagnostics(turned, ft.cs, ft.reps, 'shoulder_flexion'));
    const up = c.sensors.find((s) => s.role === 'upper')!;
    expect(up.deltaTiltDeg!).toBeLessThan(1.5);
    expect(up.deltaAxisDeg!).toBeGreaterThan(8.5);
    expect(up.deltaAxisDeg!).toBeLessThan(11.5);
    expect(c.expectedBias.some((b) => b.quantity === 'elbow flexion excursion')).toBe(true);
  });

  it('elbow error bound interpolates the measured table and grows beyond it', () => {
    expect(elbowErrorBound(0)).toBe(0);
    expect(elbowErrorBound(10)).toBeCloseTo(4.05, 6);
    expect(elbowErrorBound(7.5)).toBeGreaterThan(1.04);
    expect(elbowErrorBound(7.5)).toBeLessThan(4.05);
    expect(elbowErrorBound(30)).toBeGreaterThan(13);
  });
});

describe('uncertainty propagation', () => {
  const rec = session(21, undefined, 6);
  it('perturbed frames are reproducible for a seed and differ between seeds', () => {
    const a = perturbFrames(rec.frames.slice(0, 50), createRng(1), MPU6050_UNCERTAINTY, 'both', 4);
    const b = perturbFrames(rec.frames.slice(0, 50), createRng(1), MPU6050_UNCERTAINTY, 'both', 4);
    const c = perturbFrames(rec.frames.slice(0, 50), createRng(2), MPU6050_UNCERTAINTY, 'both', 4);
    expect(Array.from(a[10]!.data.upper_r!)).toEqual(Array.from(b[10]!.data.upper_r!));
    expect(Array.from(a[10]!.data.upper_r!)).not.toEqual(Array.from(c[10]!.data.upper_r!));
  });
  const budget = propagateUncertainty(rec.frames, rec.meta, 'shoulder_flexion', { draws: 8 });
  it('gives every feature a random and a systematic component and combines them for the session mean', () => {
    const o = budget.features.find((f) => f.feature === 'outcome')!;
    expect(o.uRandom).toBeGreaterThan(0.01);
    expect(o.uRandom).toBeLessThan(0.2);
    // accelerometer zero offset (0.01 g ≈ 0.6° of tilt) dominates and does not average out over repetitions
    expect(o.uSystematic).toBeGreaterThan(0.2);
    expect(o.uSystematic).toBeLessThan(2);
    expect(o.uSessionMean).toBeCloseTo(Math.sqrt(o.uRandom ** 2 / o.repetitions + o.uSystematic ** 2), 10);
    expect(o.decimals).toBeLessThanOrEqual(1);
    expect(budget.repetitionsRetained).toBeGreaterThan(0.95);
    expect(budget.notes[0]).toMatch(/lower_bound/);
  });
  it('random sensor noise explains a negligible share of the repetition-to-repetition variability of the outcome', () => {
    const o = budget.features.find((f) => f.feature === 'outcome')!;
    expect(o.measurementShare!).toBeLessThan(0.01);
  });
  it('the uncertainty of a change between two sessions combines both session uncertainties', () => {
    const o = budget.features.find((f) => f.feature === 'outcome')!;
    const c = changeUncertainty(o, o);
    expect(c.u).toBeCloseTo(Math.SQRT2 * o.uSessionMean, 10);
    expect(c.expanded).toBeCloseTo(1.959963984540054 * c.u, 10);
  });
  it('reports no features for a recording without repetitions', () => {
    const empty = propagateUncertainty(rec.frames.slice(0, 300), rec.meta, 'shoulder_flexion', { draws: 2 });
    expect(empty.features).toEqual([]);
    expect(empty.notes).toContain('no_complete_repetitions');
  });
});

describe('personal measurement envelope', () => {
  const mk = (means: number[], n = 3, sd = 4): EnvelopeSession[] => means.map((m, k) => ({ sessionId: `s${k}`, day: 7 * k, mean: m, n, ss: (n - 1) * sd * sd }));
  it('needs three baseline sessions', () => {
    const e = buildEnvelope(mk([100, 104]));
    expect(e.status).toBe('insufficient');
    expect(envelopeInterval(e, 3)).toBeNull();
    expect(assessAgainstEnvelope(e, 130, 3)).toBeNull();
  });
  it('for equal session lengths the interval is exactly the Student-t prediction interval of the session means', () => {
    const means = [100, 104, 97, 102, 99];
    const e = buildEnvelope(mk(means));
    const m = means.reduce((a, b) => a + b, 0) / 5;
    const s = Math.sqrt(means.reduce((a, x) => a + (x - m) ** 2, 0) / 4);
    const iv = envelopeInterval(e, 3)!;
    expect(iv.df).toBeCloseTo(4, 8);
    expect(iv.halfWidth).toBeCloseTo(tQuantile(0.975, 4) * s * Math.sqrt(1 + 1 / 5), 8);
    expect(e.status).toBe('usable');
  });
  it('is provisional with 3–4 sessions and flags a baseline that is trending', () => {
    expect(buildEnvelope(mk([100, 104, 97])).status).toBe('provisional');
    const trending = buildEnvelope(mk([100, 104, 108.5, 112, 116.2, 120]));
    expect(trending.status).toBe('baseline_not_stable');
    expect(trending.trend!.slopePerWeek).toBeGreaterThan(3.5);
  });
  it('a longer new session narrows the interval; more baseline sessions narrow it further', () => {
    const e = buildEnvelope(mk([100, 104, 97, 102, 99]));
    expect(envelopeInterval(e, 10)!.halfWidth).toBeLessThan(envelopeInterval(e, 3)!.halfWidth);
    const plan = envelopePlanning(e, [3], [0, 5]);
    expect(plan[1]!.halfWidth).toBeLessThan(plan[0]!.halfWidth);
  });
  it('marks a baseline from one sitting as excluding re-attachment', () => {
    const e = buildEnvelope(mk([100, 101, 99, 100]), { includesReattachment: false });
    expect(e.reasons.join(' ')).toMatch(/excludes_day-to-day/);
  });
  it('covers a new unchanged session ≈ 95 % of the time and flags a real shift (Monte Carlo, 3000 runs)', () => {
    const rng = createRng(7);
    const sigmaS = 2.5;
    const sigmaE = 4;
    const sim = (K: number, n: number, m: number, shift: number) => {
      const sess = (reps: number, mu: number) => {
        const eta = rng.normal(0, sigmaS);
        const y = Array.from({ length: reps }, () => mu + eta + rng.normal(0, sigmaE));
        const mean = y.reduce((a, b) => a + b, 0) / reps;
        return { mean, n: reps, ss: y.reduce((a, v) => a + (v - mean) ** 2, 0) };
      };
      const base = Array.from({ length: K }, (_, k) => ({ sessionId: `b${k}`, day: 7 * k, ...sess(n, 100) }));
      const e = buildEnvelope(base);
      const nw = sess(m, 100 + shift);
      return assessAgainstEnvelope(e, nw.mean, m);
    };
    const cover = (K: number, n: number, m: number, shift = 0, runs = 3000) => {
      let inside = 0;
      let total = 0;
      for (let r = 0; r < runs; r++) {
        const a = sim(K, n, m, shift);
        if (!a) continue;
        total++;
        if (!a.outside) inside++;
      }
      return inside / total;
    };
    // a trending baseline is itself a 5 % false alarm of the stability check, so intervals exist in all runs here
    expect(cover(4, 3, 3)).toBeGreaterThan(0.935);
    expect(cover(4, 3, 3)).toBeLessThan(0.965);
    for (const [n, m] of [[3, 8], [6, 2]] as const) {
      const unequal = cover(5, n, m);
      expect(unequal, `baseline ${n} reps, new session ${m} reps`).toBeGreaterThan(0.925);
      expect(unequal, `baseline ${n} reps, new session ${m} reps`).toBeLessThan(0.975);
    }
    // a 15-unit shift (≈ 4 SD of a session mean) is outside in most runs even with 5 baseline sessions
    expect(1 - cover(5, 3, 3, 15, 1000)).toBeGreaterThan(0.8);
  });
});

describe('test–retest measurement science', () => {
  const gen = (I: number, seed: number, o: { sigmaP: number; sigmaS: number; sigmaE: number; n?: number; shift?: number; proportional?: boolean }): RetestParticipant[] => {
    const rng = createRng(seed);
    return Array.from({ length: I }, (_, i) => {
      const p = 100 + rng.normal(0, o.sigmaP);
      const k = o.proportional ? p / 100 : 1;
      return {
        participantId: `SYN-R${i}`,
        sessions: [0, 1].map((j) => {
          const s = rng.normal(0, o.sigmaS * k) + (j === 1 ? (o.shift ?? 0) : 0);
          return Array.from({ length: o.n ?? 3 }, () => p + s + rng.normal(0, o.sigmaE * k));
        }),
      };
    });
  };
  it('recovers the three variance components from a balanced nested design (400 synthetic participants)', () => {
    const vc = varianceComponents(gen(400, 3, { sigmaP: 10, sigmaS: 2.5, sigmaE: 4 }))!;
    expect(vc.sigmaE).toBeGreaterThan(3.8);
    expect(vc.sigmaE).toBeLessThan(4.2);
    expect(vc.sigmaS).toBeGreaterThan(2.1);
    expect(vc.sigmaS).toBeLessThan(2.9);
    expect(vc.sigmaP).toBeGreaterThan(9.2);
    expect(vc.sigmaP).toBeLessThan(10.8);
    expect(vc.repsTypical).toBeCloseTo(3, 10);
    const r = reliabilityAt(vc, 3);
    expect(r.sem).toBeCloseTo(Math.sqrt(vc.sigmaS ** 2 + vc.sigmaE ** 2 / 3), 10);
    expect(r.mdc95).toBeCloseTo(1.959963984540054 * Math.SQRT2 * r.sem, 10);
    // more repetitions reduce the repetition part of the error only
    expect(reliabilityAt(vc, 30).sem).toBeGreaterThan(vc.sigmaS);
    expect(reliabilityAt(vc, 30).sem).toBeLessThan(r.sem);
  });
  it('reports reliability and measurement error as different things: a heterogeneous sample has a high ICC and the same MDC', () => {
    const narrow = retestReport(gen(60, 5, { sigmaP: 3, sigmaS: 2.5, sigmaE: 4 }));
    const wide = retestReport(gen(60, 5, { sigmaP: 30, sigmaS: 2.5, sigmaE: 4 }));
    expect(wide.iccSessionMean!).toBeGreaterThan(0.95);
    expect(narrow.iccSessionMean!).toBeLessThan(0.6);
    expect(Math.abs(wide.mdc95! - narrow.mdc95!)).toBeLessThan(0.35 * narrow.mdc95!);
    expect(narrow.mdcOverBetweenSd!).toBeGreaterThan(1);
    expect(wide.notes.join(' ')).toMatch(/MDC,_not_by_the_ICC/);
    expect(wide.semCi![0]).toBeLessThan(wide.sem!);
    expect(wide.semCi![1]).toBeGreaterThan(wide.sem!);
  });
  it('detects a systematic change between occasions and heteroscedastic error', () => {
    const shifted = retestReport(gen(40, 8, { sigmaP: 10, sigmaS: 2.5, sigmaE: 4, shift: 5 }));
    expect(shifted.systematic!.p).toBeLessThan(0.01);
    expect(shifted.systematic!.mean).toBeGreaterThan(3);
    expect(shifted.notes.join(' ')).toMatch(/occasions_differ_on_average/);
    const stable = retestReport(gen(40, 9, { sigmaP: 10, sigmaS: 2.5, sigmaE: 4 }));
    expect(stable.systematic!.ci[0]).toBeLessThan(0);
    expect(stable.systematic!.ci[1]).toBeGreaterThan(0);
    const het = retestReport(gen(120, 10, { sigmaP: 40, sigmaS: 6, sigmaE: 8, proportional: true }));
    expect(het.heteroscedasticity.present).toBe(true);
    expect(stable.agreement!.method).toBe('standard');
  });
  it('says insufficient and gives no components with one participant', () => {
    const r = retestReport(gen(1, 2, { sigmaP: 10, sigmaS: 2, sigmaE: 4 }));
    expect(r.components).toBeNull();
    expect(r.sufficiency).toBe('insufficient');
    expect(r.icc).toBeNull();
  });
  it('sets a session component the data cannot bound away from 0 to 0 and says so', () => {
    // identical session means within every participant → the between-session mean square is 0
    const data: RetestParticipant[] = [90, 100, 110, 120].map((a, i) => ({ participantId: `SYN-Z${i}`, sessions: [[a - 4, a, a + 4], [a - 4, a, a + 4]] }));
    const r = retestReport(data);
    expect(r.components!.truncated.session).toBe(true);
    expect(r.components!.sigmaS).toBe(0);
    expect(r.notes.join(' ')).toMatch(/session_component_estimated_as_0/);
    expect(r.components!.sigmaE).toBeCloseTo(4, 10);
  });
});
