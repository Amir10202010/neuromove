// Synthetic fixtures for tests only (never imported by the app). Values are made up and labelled so.

import type { RepMetrics } from '../core/metrics';
import type { Session } from '../data/models';
import type { ExerciseId } from '../core/exercises';
import type { Side } from '../devices/types';
import { cvPercent, max, median } from '../lib/stats';

/** A clinic sensor session with one step whose repetitions reach the given peak angles (synthetic trace). */
export function syntheticSession(id: string, patientId: string, startedAt: string, roms: number[], opts: { exercise?: ExerciseId; side?: Side; signal?: number; simulated?: boolean; flags?: Session['steps'][number]['summary']['flags'] } = {}): Session {
  const exercise = opts.exercise ?? 'elbow_flexion';
  const side = opts.side ?? 'right';
  const t: number[] = [];
  const angle: number[] = [];
  const trunk: (number | null)[] = [];
  const reps: RepMetrics[] = roms.map((rom, i) => {
    const tStart = i * 4 + 1;
    const tEnd = tStart + 3;
    for (let k = 0; k <= 60; k++) {
      const tt = tStart + k * 0.05;
      t.push(tt);
      angle.push(10 + (rom - 10) * Math.sin((Math.PI * k) / 60));
      trunk.push(2);
    }
    return { index: i, tStart, tEnd, rom, supination: null, pronation: null, sparc: -1.6 - i * 0.01, peakVelocity: 120 + i, duration: 3, trunk: null, check: null };
  });
  return {
    id,
    workspace: 'clinic',
    patientId,
    startedAt,
    endedAt: startedAt,
    protocolId: 'single',
    steps: [
      {
        status: 'done',
        trace: { t, angle, trunk },
        summary: { exercise, side, targetReps: roms.length, reps, rom: median(roms), romBest: max(roms), supination: null, pronation: null, sparc: -1.6, peakVelocity: 121, repDuration: 3, trunk: null, check: null, cv: cvPercent(roms), flags: opts.flags ?? [] },
      },
    ],
    events: [],
    quality: { received: 1000, lost: 0, saturated: 0, percent: opts.signal ?? 99 },
    activeSec: 30,
    totalSec: 40,
    calibrationAttempts: 1,
    status: 'completed',
    device: { kind: opts.simulated ? 'simulator' : 'usb', name: 'NeuroMove', firmware: 'f', format: 'imu-csv v1', rateHz: 100, simulated: !!opts.simulated },
    algorithmVersion: 'test',
    appVersion: 'test',
    clinician: 'Dr A',
    note: '',
    demo: false,
    hasRaw: false,
  };
}
