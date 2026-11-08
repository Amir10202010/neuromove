// Practice-trial capture from child-mode live practice — dependency-light (no analysis engine), so the child
// screens in the main bundle can use it.
//
// What is captured: every repetition the existing detector counted during a sitting, its peak angle and the
// professional's target shown to the child. Nothing is captured unless a professional enabled recording for the
// participant AND (clinic) an active consent exists — lab/records.ts trialRecordingStatus. The adult on the device
// sees that recording is on.

import { ALGORITHM_VERSION, APP_VERSION } from '../core/version';
import type { ExerciseId } from '../core/exercises';
import type { DataStorage } from '../data/db';
import type { Workspace } from '../data/models';
import type { Side } from '../devices/types';
import { newId } from '../lib/ids';
import type { EngineResult } from '../session/types';
import { makeOp } from '../sync/ops';
import { labRecordProblem } from './integrity';
import type { RawFrame } from '../devices/types';
import { buildManifest, syncModelFor, timelineFromEvents } from './coord/provenance';
import { sealTrialSet, type PracticeTrial, type PracticeTrialSet } from './records';

/** Step flags that make every repetition of the sitting unreliable (same blocking list as rehab/movement.ts). */
const BLOCKING = ['saturation', 'data_gap', 'sensor_lost', 'mount_flipped', 'calibration_moved'];

export function trialSetFromEngine(o: {
  result: EngineResult;
  workspace: Workspace;
  participantId: string;
  exercise: ExerciseId;
  side: Side;
  targetDeg: number | null;
  startedAt: Date;
  endedAt: Date;
  consentId: string | null;
  simulated: boolean;
  /**
   * Raw frames of the sitting and the device facts needed to analyse them later (MCSE). Only passed when trial
   * recording is enabled under consent — the same gate as the trials themselves.
   */
  raw?: { frames: readonly RawFrame[]; rateHz: number; deviceKind: string; accCalibrated: boolean };
}): PracticeTrialSet | null {
  const step = o.result.steps[0];
  if (!step) return null;
  const reps = step.summary.reps.filter((r) => Number.isFinite(r.rom));
  if (!reps.length) return null;
  const blocked = step.summary.flags.some((f) => BLOCKING.includes(f));
  const trials: PracticeTrial[] = reps.map((r, i) => ({
    index: i + 1,
    t: Math.round(r.tStart * 100) / 100,
    peakDeg: r.rom,
    errorDeg: o.targetDeg === null ? null : o.targetDeg - r.rom,
    valid: !blocked && o.result.quality.percent >= 90,
  }));
  return sealTrialSet({
    id: newId('ptr'),
    kind: 'practice_trials',
    workspace: o.workspace,
    participantId: o.participantId,
    exercise: o.exercise,
    side: o.side,
    targetDeg: o.targetDeg,
    feedback: 'live_angle_with_target',
    startedAt: o.startedAt.toISOString(),
    endedAt: o.endedAt.toISOString(),
    trials,
    signalPercent: o.result.quality.percent,
    algorithmVersion: ALGORITHM_VERSION,
    appVersion: APP_VERSION,
    consentId: o.consentId,
    simulated: o.simulated,
    createdAt: o.endedAt.toISOString(),
    ...(o.raw && o.raw.frames.length
      ? {
          rawManifest:
            buildManifest(o.raw.frames, {
              rateHz: o.raw.rateHz,
              sync: syncModelFor(o.raw.deviceKind, o.simulated),
              accCalibrated: o.raw.accCalibrated,
              timeline: timelineFromEvents(o.result.events, [{ exercise: o.exercise, side: o.side }]),
              algorithm: ALGORITHM_VERSION,
              app: APP_VERSION,
              now: o.endedAt,
            }) ?? undefined,
        }
      : {}),
  });
}

/** Write a trial set (and, in the clinic, its outbox op) in one transaction. Refuses invalid or simulated clinic data. */
export async function storeTrialSet(storage: DataStorage, set0: PracticeTrialSet, frames?: readonly RawFrame[]): Promise<boolean> {
  let set = set0;
  if (labRecordProblem(set)) return false;
  if (set.workspace === 'clinic' && set.simulated) return false;
  // Raw frames first (local only — the server accepts raw chunks for sessions). If they cannot be stored, the
  // trial set is stored WITHOUT a manifest, so it never points at raw data that does not exist.
  if (set.rawManifest && frames?.length) {
    const ok = await storage.putRaw(set.id, frames).then(
      () => true,
      () => false,
    );
    if (!ok) {
      const { rawManifest: _drop, contentHash: _h, ...rest } = set;
      void _drop;
      void _h;
      set = sealTrialSet(rest);
    }
  } else if (set.rawManifest) {
    const { rawManifest: _drop, contentHash: _h, ...rest } = set;
    void _drop;
    void _h;
    set = sealTrialSet(rest);
  }
  await storage.putResearchBatch('lab', [set], set.workspace === 'clinic' ? [makeOp('lab_record', set.id, set)] : []);
  return true;
}
