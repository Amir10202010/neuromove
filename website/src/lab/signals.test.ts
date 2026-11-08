// Tests of the raw-signal layer: analytic properties of the filter and peak counting, quality checks against
// injected defects, and the full chain against a simulated recording whose movements are known.

import { describe, expect, it } from 'vitest';
import { PROTOCOLS, resolveSteps } from '../core/protocols';
import type { RawFrame } from '../devices/types';
import { SessionEngine } from '../session/SessionEngine';
import { ImuSimulator } from '../simulation/imuModel';
import { buildProfile } from '../simulation/profiles';
import { VirtualPatient } from '../simulation/VirtualPatient';
import { detectMovements, pairRepetitions } from './events';
import { movementFeatures, speedPeaks } from './features';
import { assessRecording } from './quality';
import { lowpassZeroPhase, sensorSignals } from './signals';

/** Same loop as simulation/runVirtualSession.ts, but returns the raw frames the engine recorded. */
function simulatedRecording(seed: number, severity = 0.3) {
  const rate = 100;
  const imu = new ImuSimulator(seed, rate);
  const patient = new VirtualPatient(buildProfile({ left: 0.05, right: severity }), seed ^ 0x5bd1e995);
  const steps = resolveSteps({ ...PROTOCOLS.upper_quick, exercises: ['shoulder_flexion'] }, 'right').filter((s) => s.side === 'right');
  const engine = new SessionEngine({ steps, rateHz: rate, autoAdvance: true, recordRaw: true });
  engine.onInstruction((ins, t) => patient.instruct(ins, t));
  engine.start();
  for (let seq = 0; seq < 300 * rate && !engine.isFinished; seq++) engine.process([imu.frame(patient.poseAt(seq / rate), seq)]);
  if (!engine.isFinished) engine.stop();
  return { result: engine.result(), raw: engine.rawFrames };
}

describe('filter and peak counting (analytic)', () => {
  it('zero-phase Butterworth: unit gain at DC, −6 dB (×0.5) at the cut-off, no phase shift', () => {
    const fs = 100;
    const n = 2000;
    const dc = lowpassZeroPhase(new Array(n).fill(3), 6, fs);
    expect(dc[n / 2]).toBeCloseTo(3, 6);
    const x = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 6 * i) / fs));
    const y = lowpassZeroPhase(x, 6, fs);
    const mid = y.slice(500, 1500);
    const amp = Math.max(...mid);
    expect(amp).toBeGreaterThan(0.47);
    expect(amp).toBeLessThan(0.53);
    // zero phase: peaks at the same samples as the input
    const iy = 500 + mid.indexOf(amp);
    expect(Math.abs(Math.sin((2 * Math.PI * 6 * iy) / fs))).toBeGreaterThan(0.99);
  });
  it('counts one peak for a bell-shaped profile and three for a three-hump profile', () => {
    const bell = Array.from({ length: 101 }, (_, i) => Math.sin((Math.PI * i) / 100) ** 2);
    expect(speedPeaks(bell)).toBe(1);
    const three = Array.from({ length: 301 }, (_, i) => Math.sin((Math.PI * i) / 100) ** 2);
    expect(speedPeaks(three)).toBe(3);
  });
});

describe('still-period detection', () => {
  it('a slow steady rotation is not mistaken for stillness (its rate would be read as gyro bias)', async () => {
    const { findStill } = await import('./signals');
    const n = 300;
    const rate = 3; // °/s about x — constant, so the per-axis range test alone would pass
    const gyro = Array.from({ length: n }, () => [rate, 0, 0] as [number, number, number]);
    const acc = Array.from({ length: n }, (_, i) => {
      const a = ((rate * i) / 100) * (Math.PI / 180);
      return [0, Math.sin(a), Math.cos(a)] as [number, number, number];
    });
    expect(findStill(gyro, acc, 100)).toBeNull();
    const still = Array.from({ length: n }, () => [0, 0, 1] as [number, number, number]);
    expect(findStill(gyro, still, 100)).not.toBeNull();
  });
});

describe('quality assessment (injected defects)', () => {
  const still = (n: number, drop: (i: number) => boolean = () => false, sat = false): RawFrame[] => {
    const out: RawFrame[] = [];
    for (let i = 0; i < n; i++) {
      if (drop(i)) continue;
      out.push({ seq: i, t: i / 100, data: { trunk: Int16Array.from([(i % 3) - 1, (i % 5) - 2, 8192 + (i % 7) - 3, sat && i % 50 === 0 ? 32767 : 3 + (i % 3), -2 + (i % 2), 1 - (i % 4)]) } });
    }
    return out;
  };
  it('a clean still recording is high confidence with ~1 g at rest', () => {
    const q = assessRecording(still(1000), 100);
    expect(q.confidence).toBe('high');
    expect(q.sensors[0]!.restAccNorm).toBeCloseTo(1, 3);
    expect(q.seqMissing).toBe(0);
  });
  it('15 % missing samples and a 0.8 s gap are detected and lower confidence', () => {
    const q = assessRecording(still(1000, (i) => (i > 400 && i < 480) || i % 10 === 0), 100);
    const s = q.sensors[0]!;
    expect(s.completeness).toBeLessThan(0.9);
    expect(s.longestGapSec).toBeGreaterThan(0.75);
    expect(q.confidence).toBe('low');
    expect(s.reasons).toContain('completeness_below_90');
  });
  it('saturation is counted per axis', () => {
    const q = assessRecording(still(1000, () => false, true), 100);
    const s = q.sensors[0]!;
    expect(s.saturatedAxes[3]).toBe(true);
    expect(s.saturatedFraction).toBeCloseTo(0.02, 3);
  });
  it('a stuck axis is flagged', () => {
    const frames = still(500).map((f) => ({ ...f, data: { trunk: Int16Array.from([f.seq % 3, 0, 8192, 3, -2, 1]) } }));
    const q = assessRecording(frames, 100);
    expect(q.sensors[0]!.flatAxes.some(Boolean)).toBe(true); // ay, gx, gy, gz never change
  });
});

describe('movement events and features on a simulated recording (known movements)', () => {
  const { result, raw } = simulatedRecording(11);
  const arm = sensorSignals(raw, 'upper_r', 100)!;
  const trunk = sensorSignals(raw, 'trunk', 100);
  const ev = detectMovements(arm, 100);
  const reps = pairRepetitions(ev.events);
  const engineReps = result.steps[0]!.summary.reps;

  it('raw recording passes quality checks; no false gyro-bias drift on moving segments', () => {
    const q = assessRecording(raw, 100);
    expect(q.confidence === 'high' || q.confidence === 'medium').toBe(true);
    for (const s of q.sensors) expect(s.reasons, s.placement).not.toContain('gyro_bias_drift');
    expect(q.syncFraction).toBe(1);
  });
  it('finds one raise and one lower per repetition of the engine', () => {
    expect(engineReps.length).toBeGreaterThanOrEqual(3);
    expect(reps.length).toBe(engineReps.length);
    expect(reps.every((r) => r.lower !== null)).toBe(true);
  });
  it('raw time base aligns with engine repetition windows (offset = first raw frame)', () => {
    const t0 = raw[0]!.t;
    for (let i = 0; i < engineReps.length; i++) {
      const r = engineReps[i]!;
      const raise = reps[i]!.raise;
      // the velocity onset precedes the angle-threshold start window end, and the raise peak lies inside the window
      expect(raise.peak + t0).toBeGreaterThan(r.tStart - 2);
      expect(raise.peak + t0).toBeLessThan(r.tEnd);
    }
  });
  it('inclination change of each raise ≈ engine ROM of the repetition (same gravity-based angle)', () => {
    for (let i = 0; i < engineReps.length; i++) {
      const f = movementFeatures(reps[i]!.raise, arm, ev.speedFiltered, 100, trunk);
      expect(Math.abs((f.values.inclination_change as number) - engineReps[i]!.rom)).toBeLessThan(15);
      expect(f.values.peak_speed).toBeGreaterThan(30);
      expect(f.values.sparc).toBeLessThan(0);
      expect(f.values.trunk_tilt).toBeGreaterThanOrEqual(0);
    }
  });
});
