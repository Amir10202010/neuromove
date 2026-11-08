// Adapters from stored NeuroMove records to MCSE inputs. Pure (no storage access): the caller loads the raw frames.
// Sessions without raw frames are reported as aggregate-only — nothing is reconstructed for them.

import type { Session } from '../../data/models';
import { isSimulatedSession } from '../../data/models';
import type { RawFrame, Side } from '../../devices/types';
import type { PracticeTrialSet } from '../records';
import type { RecordingMeta } from './channels';
import type { McseRecordingInput } from './engine';
import { timelineFromEvents } from './provenance';

export type Availability = 'raw_verified_manifest' | 'raw_without_manifest' | 'aggregate_only';

export function sessionAvailability(s: Session): Availability {
  if (!s.hasRaw) return 'aggregate_only';
  return s.rawManifest ? 'raw_verified_manifest' : 'raw_without_manifest';
}

export function sessionHasExercise(s: Session, exercise: string, side: Side): boolean {
  return s.steps.some((st) => st.summary.exercise === exercise && st.summary.side === side && st.status !== 'skipped');
}

export function sessionInput(s: Session, frames: readonly RawFrame[], side: Side): McseRecordingInput {
  const tl = s.rawManifest?.timeline ?? timelineFromEvents(s.events, s.steps.map((st) => ({ exercise: st.summary.exercise, side: st.summary.side })));
  const meta: RecordingMeta = {
    id: s.id,
    participantId: s.patientId,
    startedAt: s.startedAt,
    rateHz: s.device.rateHz || 100,
    side,
    ...(s.device.accCal ? { accCal: s.device.accCal } : {}),
    steps: tl.steps,
    calibrationEnd: tl.calibrationEnd,
    source: 'session',
    simulated: isSimulatedSession(s),
  };
  return { frames, meta, manifest: s.rawManifest ?? null };
}

export function practiceInput(set: PracticeTrialSet, frames: readonly RawFrame[]): McseRecordingInput | null {
  const m = set.rawManifest;
  if (!m) return null;
  const meta: RecordingMeta = {
    id: set.id,
    participantId: set.participantId,
    startedAt: set.startedAt,
    rateHz: m.rateHz,
    side: set.side,
    steps: m.timeline.steps,
    calibrationEnd: m.timeline.calibrationEnd,
    source: 'practice',
    simulated: set.simulated,
  };
  return { frames, meta, manifest: m };
}
