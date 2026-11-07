// Structural validation of research records — shared by the browser (pulled data) and the server
// (pushed data). The server never trusts a payload it did not validate.

import { EXERCISE_IDS } from '../core/exercises';
import type { ProtocolVersion, Trial, ValidationSession } from './model';

type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 300): x is string => typeof x === 'string' && x.length <= max;
const nonEmpty = (x: unknown, max = 300) => str(x, max) && (x as string).length > 0;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const date = (x: unknown) => str(x, 40) && Number.isFinite(Date.parse(x as string));
const nullable = <T>(x: unknown, f: (v: unknown) => v is T | boolean) => x === null || f(x);
const oneOf = (x: unknown, xs: readonly unknown[]) => xs.includes(x);
const intIn = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;

function definition(d: unknown): boolean {
  if (!obj(d)) return false;
  const q = d.quality;
  return (
    nonEmpty(d.name, 200) &&
    str(d.description, 2000) &&
    oneOf(d.bodyRegion, ['upper_limb', 'lower_limb', 'trunk', 'multi_segment', 'custom']) &&
    str(d.joint, 100) &&
    oneOf(d.exercise, EXERCISE_IDS) &&
    oneOf(d.side, ['left', 'right']) &&
    str(d.movementType, 200) &&
    Array.isArray(d.measurementPoints) &&
    d.measurementPoints.length > 0 &&
    d.measurementPoints.length <= 20 &&
    d.measurementPoints.every((p) => obj(p) && nonEmpty(p.id, 40) && oneOf(p.kind, ['max_flexion', 'max_extension', 'neutral', 'custom']) && str(p.label, 100)) &&
    intIn(d.repetitions, 1, 200) &&
    intIn(d.sets, 1, 20) &&
    num(d.restSec) &&
    typeof d.goniometerRequired === 'boolean' &&
    oneOf(d.captureMode, ['hold', 'rep_peak']) &&
    num(d.holdWindowSec) &&
    obj(q) &&
    num(q.maxWindowSdDeg) &&
    num(q.minWindowSamples) &&
    num(q.reviewAbsErrorDeg) &&
    str(d.operatorNotes, 4000) &&
    obj(d.customFields) &&
    Object.values(d.customFields).every((v) => str(v, 1000))
  );
}

export function validProtocolVersion(x: unknown): x is ProtocolVersion {
  return (
    obj(x) &&
    nonEmpty(x.key, 120) &&
    nonEmpty(x.protocolId, 80) &&
    intIn(x.version, 1, 100000) &&
    x.key === `${x.protocolId}@${x.version}` &&
    oneOf(x.workspace, ['clinic', 'demo']) &&
    definition(x.definition) &&
    date(x.createdAt) &&
    str(x.createdBy, 200) &&
    typeof x.archived === 'boolean'
  );
}

function device(d: unknown): boolean {
  return (
    obj(d) &&
    oneOf(d.kind, ['usb', 'ble', 'simulator', 'replay']) &&
    str(d.name, 200) &&
    str(d.firmware, 100) &&
    str(d.format, 100) &&
    num(d.rateHz) &&
    typeof d.simulated === 'boolean' &&
    Array.isArray(d.sensors) &&
    d.sensors.every((s) => obj(s) && oneOf(s.placement, ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r']) && nullable(s.moduleId, (v): v is string => str(v, 20)))
  );
}

export function validValidationSession(x: unknown): x is ValidationSession {
  return (
    obj(x) &&
    nonEmpty(x.id, 80) &&
    oneOf(x.workspace, ['clinic', 'demo']) &&
    nonEmpty(x.participantId, 80) &&
    str(x.operator, 200) &&
    nonEmpty(x.protocolKey, 120) &&
    definition(x.protocol) &&
    intIn(x.protocolVersion, 1, 100000) &&
    device(x.device) &&
    str(x.algorithmVersion, 100) &&
    str(x.appVersion, 100) &&
    date(x.startedAt) &&
    (x.endedAt === null || date(x.endedAt)) &&
    oneOf(x.status, ['active', 'completed', 'abandoned']) &&
    (x.calibration === null || (obj(x.calibration) && date(x.calibration.at) && num(x.calibration.attempts) && obj(x.calibration.poseDeg))) &&
    (x.signal === null || (obj(x.signal) && num(x.signal.received) && num(x.signal.lost) && num(x.signal.saturated) && num(x.signal.percent))) &&
    str(x.notes, 4000) &&
    date(x.createdAt) &&
    date(x.updatedAt)
  );
}

export function validTrial(x: unknown): x is Trial {
  if (!obj(x)) return false;
  const imu = x.imu;
  const imuOk =
    imu === null ||
    (obj(imu) &&
      num(imu.angleDeg) &&
      Math.abs(imu.angleDeg) <= 400 &&
      oneOf(imu.method, ['hold', 'rep_peak']) &&
      num(imu.tFrom) &&
      num(imu.tTo) &&
      intIn(imu.samples, 0, 1_000_000) &&
      num(imu.windowSdDeg) &&
      num(imu.windowMinDeg) &&
      num(imu.windowMaxDeg) &&
      date(imu.capturedAt));
  const refOk = x.referenceDeg === null || (num(x.referenceDeg) && x.referenceDeg >= -180 && x.referenceDeg <= 360);
  // A valid trial is a complete pair; a pending one has an IMU value and no reference yet
  const pairOk =
    (x.status !== 'valid' || (imu !== null && x.referenceDeg !== null)) && (x.status !== 'pending_reference' || (imu !== null && x.referenceDeg === null));
  return (
    nonEmpty(x.id, 80) &&
    oneOf(x.workspace, ['clinic', 'demo']) &&
    nonEmpty(x.sessionId, 80) &&
    nonEmpty(x.participantId, 80) &&
    intIn(x.set, 1, 20) &&
    intIn(x.repetition, 1, 200) &&
    nonEmpty(x.pointId, 40) &&
    intIn(x.attempt, 1, 10000) &&
    oneOf(x.status, ['pending_reference', 'valid', 'invalid', 'skipped', 'superseded']) &&
    imuOk &&
    refOk &&
    pairOk &&
    (x.referenceAt === null || date(x.referenceAt)) &&
    str(x.reason, 1000) &&
    str(x.notes, 2000) &&
    str(x.operator, 200) &&
    date(x.createdAt) &&
    date(x.updatedAt)
  );
}
