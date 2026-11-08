// Records of the computational motor-learning lab kept in the IndexedDB store `lab` (schema v4) and synced to the
// server table nm_lab_records (migration 0003_lab) as the entity 'lab_record'.
//
//   learning_protocol  versioned study protocol; only its status may change (draft → frozen → archived)
//   analysis_run       frozen analysis — insert-only
//   practice_trials    one sitting of child-mode practice: every detected repetition with the target — insert-only
//   trial_recording    a professional's decision to record (or stop recording) practice trials for a participant;
//                      append-only, the newest record wins
//
// Every shape and hash rule is in integrity.ts, shared with the server.

import type { ExerciseId } from '../core/exercises';
import type { Workspace } from '../data/models';
import type { Side } from '../devices/types';
import type { ConsentRecord } from '../rehab/model';
import { hashOf } from './hash';
import { labRecordProblem } from './integrity';
import type { LearningProtocolVersion } from './protocol';
import type { AnalysisRun } from './runs';
import type { RawManifest } from './coord/provenance';

export interface PracticeTrial {
  /** 1-based repetition index within the sitting. */
  index: number;
  /** Seconds from the start of recording. */
  t: number;
  /** Peak joint angle of the repetition, degrees (the same angle the clinic test computes). */
  peakDeg: number;
  /** target − peak, degrees; null when there was no target. Positive = below the target. */
  errorDeg: number | null;
  /** The repetition passed the engine's quality checks (no gap, no saturation, no sensor loss). */
  valid: boolean;
}

export interface PracticeTrialSet {
  id: string;
  kind: 'practice_trials';
  workspace: Workspace;
  participantId: string;
  exercise: ExerciseId;
  side: Side;
  /** Professional-set feedback target shown to the child, degrees; null = no target line. */
  targetDeg: number | null;
  /** Feedback the child saw: the live angle against the target, on every repetition. */
  feedback: 'live_angle_with_target';
  startedAt: string;
  endedAt: string;
  trials: PracticeTrial[];
  /** Share of expected samples received during the sitting, %. */
  signalPercent: number;
  algorithmVersion: string;
  appVersion: string;
  /** Consent record under which the trials were recorded (null only in the demo workspace). */
  consentId: string | null;
  simulated: boolean;
  createdAt: string;
  /** Manifest of the raw frames of the sitting, stored locally under this record's id (consent-gated); absent before 2026-11-08 or when the frames could not be stored. */
  rawManifest?: RawManifest;
  /** SHA-256 of the record without this field — detects any later change. */
  contentHash: string;
}

export interface TrialRecordingSetting {
  id: string;
  kind: 'trial_recording';
  workspace: Workspace;
  participantId: string;
  enabled: boolean;
  /** Active consent the professional relied on when enabling (null when disabling, or in the demo). */
  consentId: string | null;
  createdAt: string;
  createdBy: string;
}

export type LabRecord = LearningProtocolVersion | AnalysisRun | PracticeTrialSet | TrialRecordingSetting;
export type LabKind = LabRecord['kind'];

/** Shape and integrity check used when loading the store and when applying pulled changes. */
export function isLabRecord(x: unknown): x is LabRecord {
  return labRecordProblem(x) === null;
}

export function sealTrialSet(set: Omit<PracticeTrialSet, 'contentHash'>): PracticeTrialSet {
  return { ...set, contentHash: hashOf({ ...set, contentHash: undefined }) };
}

/**
 * Whether practice trials may be recorded for a participant now. Clinic: only with the newest recording setting
 * enabled AND an active consent record for the participant. Demo: with the setting enabled (simulated children).
 */
export function trialRecordingStatus(
  participantId: string,
  workspace: Workspace,
  records: readonly LabRecord[],
  consents: readonly ConsentRecord[],
): { enabled: boolean; consent: ConsentRecord | null; reason: 'not_enabled' | 'no_active_consent' | null } {
  const latest = records
    .filter((r): r is TrialRecordingSetting => r.kind === 'trial_recording' && r.participantId === participantId && r.workspace === workspace)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest?.enabled) return { enabled: false, consent: null, reason: 'not_enabled' };
  if (workspace === 'demo') return { enabled: true, consent: null, reason: null };
  const consent = consents.find((c) => c.participantId === participantId && c.workspace === workspace && c.status === 'active') ?? null;
  return consent ? { enabled: true, consent, reason: null } : { enabled: false, consent: null, reason: 'no_active_consent' };
}
