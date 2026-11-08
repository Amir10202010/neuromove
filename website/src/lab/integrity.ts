// Integrity checks for lab records — dependency-light (hashing only) so the server bundle can use exactly the
// same rules as the browser without importing the analysis engine.
//
// A record passes only if it is well-formed AND its stored hashes match its content: a protocol whose
// definition was edited after hashing, or a run whose snapshot, configuration or results were altered, is refused.

import { canonicalJson, hashOf, sha256Hex } from './hash';

/**
 * Hash scheme 1 for run results: canonical JSON WITHOUT the per-series version labels (compared separately),
 * numbers at 8 significant digits (tolerates last-bit floating-point differences between JavaScript engines).
 */
export const RESULT_DIGITS = 8;
export const RESULT_HASH_SCHEME = 1;
export const resultsHash = (r: readonly object[]): string => sha256Hex(canonicalJson(r.map((x) => ({ ...x, versions: undefined })), RESULT_DIGITS));

export const LAB_KINDS = ['learning_protocol', 'analysis_run', 'practice_trials', 'trial_recording'] as const;
export type LabKindName = (typeof LAB_KINDS)[number];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max;
const iso = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown) => x === null || num(x);

export type LabProblem =
  | 'not_an_object'
  | 'unknown_kind'
  | 'bad_shape'
  | 'definition_hash_mismatch'
  | 'snapshot_hash_mismatch'
  | 'config_hash_mismatch'
  | 'result_hash_mismatch'
  | 'unknown_hash_scheme'
  | 'too_many_trials';

/** First problem found, or null when the record is valid and internally consistent. */
export function labRecordProblem(x: unknown): LabProblem | null {
  if (!isObj(x)) return 'not_an_object';
  if (!str(x.id, 120) || (x.workspace !== 'demo' && x.workspace !== 'clinic')) return 'bad_shape';
  switch (x.kind) {
    case 'learning_protocol': {
      if (!str(x.protocolId, 120) || !num(x.version) || !isObj(x.def) || !str(x.defHash, 64) || !iso(x.createdAt)) return 'bad_shape';
      if (!['draft', 'frozen', 'archived'].includes(String(x.status)) || x.participantId !== null) return 'bad_shape';
      return hashOf(x.def) === x.defHash ? null : 'definition_hash_mismatch';
    }
    case 'analysis_run': {
      if (!str(x.participantId, 120) || !Array.isArray(x.snapshot) || !Array.isArray(x.results) || !isObj(x.config) || !iso(x.createdAt)) return 'bad_shape';
      if (!str(x.snapshotHash, 64) || !str(x.configHash, 64) || !str(x.resultHash, 64)) return 'bad_shape';
      if ((x.hashScheme ?? 1) !== RESULT_HASH_SCHEME) return 'unknown_hash_scheme';
      if (hashOf(x.snapshot) !== x.snapshotHash) return 'snapshot_hash_mismatch';
      if (hashOf(x.config) !== x.configHash) return 'config_hash_mismatch';
      return resultsHash(x.results as object[]) === x.resultHash ? null : 'result_hash_mismatch';
    }
    case 'practice_trials': {
      if (!str(x.participantId, 120) || !str(x.exercise, 40) || !['left', 'right'].includes(String(x.side)) || !iso(x.startedAt) || !iso(x.endedAt)) return 'bad_shape';
      if (!numOrNull(x.targetDeg) || !Array.isArray(x.trials) || !str(x.algorithmVersion, 60) || typeof x.simulated !== 'boolean') return 'bad_shape';
      if (x.trials.length > 2000) return 'too_many_trials';
      for (const t of x.trials) {
        if (!isObj(t) || !num(t.index) || !num(t.t) || !num(t.peakDeg) || !numOrNull(t.errorDeg) || typeof t.valid !== 'boolean') return 'bad_shape';
      }
      return str(x.contentHash, 64) && hashOf({ ...x, contentHash: undefined }) === x.contentHash ? null : 'bad_shape';
    }
    case 'trial_recording': {
      if (!str(x.participantId, 120) || typeof x.enabled !== 'boolean' || !iso(x.createdAt) || !(x.consentId === null || str(x.consentId, 120))) return 'bad_shape';
      return null;
    }
    default:
      return 'unknown_kind';
  }
}

/**
 * Allowed change of a stored record (server and browser apply the same rule):
 * runs, practice-trial sets and recording settings are insert-only; a protocol may change ONLY its status,
 * along draft → frozen → archived, and never its definition.
 */
export function labTransitionProblem(prev: Record<string, unknown>, next: Record<string, unknown>): 'immutable' | 'kind_changed' | 'definition_changed' | 'invalid_status_change' | null {
  if (prev.kind !== next.kind) return 'kind_changed';
  if (prev.kind !== 'learning_protocol') return canonicalJson(prev) === canonicalJson(next) ? null : 'immutable';
  if (prev.defHash !== next.defHash || canonicalJson(prev.def) !== canonicalJson(next.def) || prev.protocolId !== next.protocolId || prev.version !== next.version) return 'definition_changed';
  const from = String(prev.status);
  const to = String(next.status);
  const ok = from === to || (from === 'draft' && (to === 'frozen' || to === 'archived')) || (from === 'frozen' && to === 'archived');
  return ok ? null : 'invalid_status_change';
}

/** Simulated content never leaves the demo workspace (the server refuses it as well). */
export function labRecordSimulated(x: Record<string, unknown>): boolean {
  if (x.kind === 'analysis_run') return x.simulated === true;
  if (x.kind === 'practice_trials') return x.simulated === true;
  return false;
}
