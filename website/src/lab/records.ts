// Records of the computational motor-learning lab kept in the IndexedDB store `lab` (schema v4).
// Both kinds are insert-only; a learning protocol version may only change its status (draft → frozen → archived).

import type { AnalysisRun } from './runs';
import type { LearningProtocolVersion } from './protocol';

export type LabRecord = LearningProtocolVersion | AnalysisRun;
export type LabKind = LabRecord['kind'];

/** Shape check used when loading the store (records that fail are skipped and counted, never deleted). */
export function isLabRecord(x: unknown): x is LabRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || (r.workspace !== 'demo' && r.workspace !== 'clinic')) return false;
  if (r.kind === 'learning_protocol') return typeof r.protocolId === 'string' && typeof r.version === 'number' && typeof r.defHash === 'string' && !!r.def && typeof r.def === 'object';
  if (r.kind === 'analysis_run') return typeof r.participantId === 'string' && Array.isArray(r.snapshot) && Array.isArray(r.results) && typeof r.resultHash === 'string';
  return false;
}
