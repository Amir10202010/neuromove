// Итог движка → запись сеанса для хранения.

import type { ProtocolId } from '../core/protocols';
import { ALGORITHM_VERSION, APP_VERSION } from '../core/version';
import type { Session, SessionDevice, Workspace } from '../data/models';
import { newId } from '../lib/ids';
import type { EngineResult } from './types';

export interface BuildSessionArgs {
  id?: string;
  workspace: Workspace;
  patientId: string;
  protocolId: ProtocolId;
  result: EngineResult;
  startedAt: Date;
  device: SessionDevice;
  clinician: string;
  demo: boolean;
  hasRaw: boolean;
  note?: string;
}

export function buildSession(a: BuildSessionArgs): Session {
  const ended = new Date(a.startedAt.getTime() + Math.max(a.result.totalSec, a.result.activeSec) * 1000);
  return {
    id: a.id ?? newId('s'),
    workspace: a.workspace,
    patientId: a.patientId,
    startedAt: a.startedAt.toISOString(),
    endedAt: ended.toISOString(),
    protocolId: a.protocolId,
    steps: a.result.steps,
    events: a.result.events,
    quality: a.result.quality,
    activeSec: a.result.activeSec,
    totalSec: a.result.totalSec,
    calibrationAttempts: a.result.calibrationAttempts,
    calibrationPose: a.result.calibrationPose,
    status: a.result.completed ? 'completed' : 'incomplete',
    device: a.device,
    algorithmVersion: ALGORITHM_VERSION,
    appVersion: APP_VERSION,
    clinician: a.clinician,
    note: a.note ?? '',
    demo: a.demo,
    hasRaw: a.hasRaw,
  };
}
