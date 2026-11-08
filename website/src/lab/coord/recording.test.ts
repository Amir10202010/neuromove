// Integration through the REAL recording path: SessionEngine (as in the app) + virtual patient + MPU-6050 simulator
// → engine.rawFrames and session events → raw manifest → session adapter → MCSE. Checks that event times line up
// with stored frames (calibration window, step spans) and that MCSE finds the repetitions the clinical counter found.
// Simulated data only.
import { describe, expect, it } from 'vitest';
import { PROTOCOLS, resolveSteps } from '../../core/protocols';
import type { Session } from '../../data/models';
import { SessionEngine } from '../../session/SessionEngine';
import { ImuSimulator } from '../../simulation/imuModel';
import { buildProfile } from '../../simulation/profiles';
import { VirtualPatient } from '../../simulation/VirtualPatient';
import { runMcse } from './engine';
import { sessionInput } from './inputs';
import { buildManifest, timelineFromEvents, verifyManifest } from './provenance';

function recordSession(seed: number) {
  const rate = 100;
  const imu = new ImuSimulator(seed, rate);
  const patient = new VirtualPatient(buildProfile({ left: 0.05, right: 0.3 }, 0.5), seed ^ 0x5bd1e995);
  const steps = resolveSteps(PROTOCOLS.upper_standard, 'right').filter((s) => s.side === 'right');
  const engine = new SessionEngine({ steps, rateHz: rate, autoAdvance: true, recordRaw: true });
  engine.onInstruction((ins, t) => patient.instruct(ins, t));
  engine.start();
  for (let seq = 0; seq < 600 * rate && !engine.isFinished; seq++) engine.process([imu.frame(patient.poseAt(seq / rate), seq)]);
  if (!engine.isFinished) engine.stop();
  return { engine, steps, result: engine.result() };
}

describe('MCSE on frames recorded by the live SessionEngine', () => {
  it('manifest, calibration window, step spans and repetition counts agree with the session', () => {
    const { engine, steps, result } = recordSession(77);
    const frames = engine.rawFrames;
    const timeline = timelineFromEvents(result.events, steps);
    const manifest = buildManifest(frames, { rateHz: 100, sync: 'simulated', accCalibrated: false, timeline, algorithm: 'x', app: 'y' })!;
    expect(verifyManifest(frames, manifest)).toBe('verified');
    expect(timeline.calibrationEnd).not.toBeNull();
    expect(timeline.steps.map((s) => s.exercise)).toContain('shoulder_flexion');
    const session = {
      id: 'sim-1',
      patientId: 'SYN-REC',
      startedAt: '2026-11-01T10:00:00Z',
      device: { kind: 'simulator', name: 'sim', firmware: '-', format: 'imu-csv v1', rateHz: 100, simulated: true },
      demo: true,
      hasRaw: true,
      events: result.events,
      steps: result.steps,
      rawManifest: manifest,
    } as unknown as Session;
    for (const ex of ['shoulder_flexion', 'shoulder_abduction', 'elbow_flexion'] as const) {
      const res = runMcse([sessionInput(session, frames, 'right')], { exercise: ex });
      const rec = res.recordings[0]!;
      expect(rec.manifest).toBe('verified');
      expect(rec.calibration).toBe('session_calibration');
      const counted = result.steps.find((s) => s.summary.exercise === ex)!.summary.reps.length;
      // MCSE segments the same step independently (velocity-defined phases); it must find the clinical repetitions
      expect(rec.repetitions).toBeGreaterThanOrEqual(counted - 1);
      expect(rec.repetitions).toBeLessThanOrEqual(counted + 1);
      // 3 repetitions per movement: strategy discovery must refuse
      expect(res.strategies?.verdict ?? 'insufficient_data').toBe('insufficient_data');
    }
  }, 120_000);
});
