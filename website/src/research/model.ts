// Research data model: measurement-validation studies (IMU vs. reference goniometer).
//
// Design rules (see docs/research/DATA_MODEL.md):
//  - Raw observations are stored exactly as captured: the IMU angle the software produced and the
//    reference angle the operator typed. Errors (signed / absolute) are always DERIVED, never stored,
//    so a stored record can never disagree with its own inputs. Nothing is rounded before storage.
//  - A validation session carries a frozen snapshot of the protocol version it ran under. Editing a
//    protocol creates a new version; old sessions keep the definition they were measured with.
//  - Every trial is traceable to: participant, session, set/repetition/measurement point, protocol
//    version, device + sensor assignment, algorithm version, operator.
//  - Nothing is ever hard-deleted by the workflow. "Repeat measurement" supersedes an attempt
//    (status 'superseded') and keeps it for the audit trail.

import type { ExerciseId } from '../core/exercises';
import type { AccCalibration } from '../core/imu';
import type { Workspace } from '../data/models';
import type { DeviceKind, Placement, Side } from '../devices/types';

export type BodyRegion = 'upper_limb' | 'lower_limb' | 'trunk' | 'multi_segment' | 'custom';

/** Where in the movement the paired measurement is taken. */
export type MeasurementPointKind = 'max_flexion' | 'max_extension' | 'neutral' | 'custom';

export interface MeasurementPointDef {
  /** Stable within a protocol version, e.g. "p1". */
  id: string;
  kind: MeasurementPointKind;
  /** Free label shown to the operator ("Peak flexion", "Neutral 0°"). */
  label: string;
}

/**
 * How the IMU value of a trial is captured.
 *  - 'hold': the participant holds the joint at the measurement point; the operator presses Capture;
 *    the IMU value is the MEDIAN joint angle over the last `holdWindowSec` seconds (window SD recorded
 *    as a stability indicator). This is the recommended mode for goniometer comparison because the
 *    goniometer is read on a static joint.
 *  - 'rep_peak': the software's repetition detector closes a repetition; the IMU value is the peak
 *    (max for flexion points, min for extension points) of that repetition. The participant must
 *    hold the peak while the goniometer is read. Experimental.
 */
export type CaptureMode = 'hold' | 'rep_peak';

export interface QualityCriteria {
  /** Hold window SD above this marks the capture "unstable" (not rejected). Degrees. */
  maxWindowSdDeg: number;
  /** Minimum samples in the capture window. */
  minWindowSamples: number;
  /** Absolute error above this is flagged for review (never auto-removed). Degrees. */
  reviewAbsErrorDeg: number;
}

export interface ProtocolDefinition {
  name: string;
  description: string;
  bodyRegion: BodyRegion;
  /** Joint label, e.g. "elbow", "shoulder", "knee". */
  joint: string;
  /**
   * The software angle definition used for the IMU value. Only exercises the existing three-sensor
   * upper-limb configuration can compute are selectable (see research/capabilities.ts).
   */
  exercise: ExerciseId;
  side: Side;
  movementType: string;
  measurementPoints: MeasurementPointDef[];
  repetitions: number;
  sets: number;
  restSec: number;
  goniometerRequired: boolean;
  captureMode: CaptureMode;
  holdWindowSec: number;
  quality: QualityCriteria;
  operatorNotes: string;
  customFields: Record<string, string>;
}

/** One immutable version of a protocol. Key: `${protocolId}@${version}`. */
export interface ProtocolVersion {
  key: string;
  protocolId: string;
  version: number;
  workspace: Workspace;
  definition: ProtocolDefinition;
  createdAt: string;
  createdBy: string;
  /** Archived protocols are hidden from "new session" but remain readable forever. */
  archived: boolean;
}

export interface SensorAssignment {
  placement: Placement;
  /** MPU-6050 module fingerprint from the device passport, or null when the firmware did not send one. */
  moduleId: string | null;
}

export interface DeviceSnapshot {
  kind: DeviceKind;
  name: string;
  firmware: string;
  format: string;
  rateHz: number;
  simulated: boolean;
  accCal?: Partial<Record<Placement, AccCalibration>>;
  sensors: SensorAssignment[];
}

export type ValidationStatus = 'active' | 'completed' | 'abandoned';

export interface ValidationSession {
  id: string;
  workspace: Workspace;
  /** Participant = existing patient record (pseudonymous code). */
  participantId: string;
  operator: string;
  protocolKey: string;
  /** Frozen copy of the protocol version used. Never updated after creation. */
  protocol: ProtocolDefinition;
  protocolVersion: number;
  device: DeviceSnapshot;
  algorithmVersion: string;
  appVersion: string;
  startedAt: string;
  endedAt: string | null;
  status: ValidationStatus;
  /** Recorded calibration (stand-still) quality for this session. */
  calibration: { at: string; attempts: number; poseDeg: Partial<Record<Placement, number>> } | null;
  /** Signal quality at last update (received / lost / saturated), as reported by the existing pipeline. */
  signal: { received: number; lost: number; saturated: number; percent: number } | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type TrialStatus = 'pending_reference' | 'valid' | 'invalid' | 'skipped' | 'superseded';

export interface ImuCapture {
  /** Angle the software reports for this trial, degrees, full precision. */
  angleDeg: number;
  method: CaptureMode;
  /** Device time (s from session engine start) of the window. */
  tFrom: number;
  tTo: number;
  samples: number;
  /** SD of the joint angle inside the window, degrees (stability indicator). */
  windowSdDeg: number;
  windowMinDeg: number;
  windowMaxDeg: number;
  capturedAt: string;
}

export interface Trial {
  id: string;
  workspace: Workspace;
  sessionId: string;
  participantId: string;
  set: number;
  repetition: number;
  pointId: string;
  /** 1 for the first attempt; "Repeat measurement" creates attempt + 1 and supersedes the previous one. */
  attempt: number;
  status: TrialStatus;
  imu: ImuCapture | null;
  /** Reference goniometer angle typed by the operator, degrees. */
  referenceDeg: number | null;
  referenceAt: string | null;
  /** Reason for invalid / skipped / superseded. */
  reason: string;
  notes: string;
  operator: string;
  createdAt: string;
  updatedAt: string;
}

/** A slot = one (set, repetition, measurement point) cell of the protocol grid. */
export interface Slot {
  set: number;
  repetition: number;
  pointId: string;
}

export const slotKey = (s: Slot): string => `${s.set}:${s.repetition}:${s.pointId}`;
