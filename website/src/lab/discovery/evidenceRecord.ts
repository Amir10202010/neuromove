// Evidence records — sealed, insert-only snapshots of derived research artefacts: a twin snapshot, a scientific
// report, a change evaluation. Each lists what it was derived from (kind, id, content hash) and carries a SHA-256
// of its own content, so a later reader can tell that it is unchanged and exactly which inputs produced it.
//
// Storage: the IndexedDB store `lab`, beside the lab records, under kind 'evidence_record'. They are LOCAL to the
// device and deliberately NOT part of team sync: every evidence record is a deterministic function of records that
// ARE synced and immutable (frozen analysis runs, sessions) and of the engine version it names, so a colleague
// reproduces it from the run instead of trusting a copy. Keeping them out of sync also means no server schema
// change: the PostgreSQL kind constraint of nm_lab_records (migration 0003) is untouched.
//
// Dependency-light on purpose (hashing only), like lab/integrity.ts.

import type { Workspace } from '../../data/models';
import { canonicalJson, hashOf } from '../hash';

export const EVIDENCE_TYPES = ['twin_snapshot', 'research_report', 'change_evaluation', 'strategy_profile'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface DerivedFrom {
  /** What the source is: 'analysis_run', 'session', 'raw_stream', 'learning_protocol', 'hypothesis', 'practice_trials' … */
  kind: string;
  id: string;
  /** Its content hash at the time (null when the source has none, e.g. a session stored without raw frames). */
  hash: string | null;
}

export interface EvidenceRecord {
  id: string;
  kind: 'evidence_record';
  workspace: Workspace;
  participantId: string | null;
  type: EvidenceType;
  title: string;
  createdAt: string;
  createdBy: string;
  /** Engine component versions that produced the body. */
  versions: Record<string, string>;
  derivedFrom: DerivedFrom[];
  /** The artefact itself (JSON). */
  body: unknown;
  simulated: boolean;
  /** SHA-256 of the record without this field. */
  contentHash: string;
}

/** Largest canonical-JSON size of a record, bytes — an evidence record is a summary, not a data dump. */
export const EVIDENCE_MAX_BYTES = 2_000_000;

export type EvidenceProblem = 'not_an_object' | 'not_an_evidence_record' | 'bad_shape' | 'too_large' | 'content_hash_mismatch';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 300) => typeof x === 'string' && x.length > 0 && x.length <= max;

export function evidenceRecordProblem(x: unknown): EvidenceProblem | null {
  if (!isObj(x)) return 'not_an_object';
  if (x.kind !== 'evidence_record') return 'not_an_evidence_record';
  if (!str(x.id, 120) || (x.workspace !== 'demo' && x.workspace !== 'clinic')) return 'bad_shape';
  if (!(x.participantId === null || str(x.participantId, 120))) return 'bad_shape';
  if (!(EVIDENCE_TYPES as readonly string[]).includes(String(x.type)) || !str(x.title) || !str(x.createdBy, 200)) return 'bad_shape';
  if (typeof x.createdAt !== 'string' || Number.isNaN(Date.parse(x.createdAt)) || typeof x.simulated !== 'boolean') return 'bad_shape';
  if (!isObj(x.versions) || !Array.isArray(x.derivedFrom) || x.derivedFrom.length > 5000 || x.body === undefined || x.body === null) return 'bad_shape';
  for (const d of x.derivedFrom) if (!isObj(d) || !str(d.kind, 60) || !str(d.id, 200) || !(d.hash === null || str(d.hash, 128))) return 'bad_shape';
  if (!str(x.contentHash, 64)) return 'bad_shape';
  if (canonicalJson(x).length > EVIDENCE_MAX_BYTES) return 'too_large';
  return hashOf({ ...x, contentHash: undefined }) === x.contentHash ? null : 'content_hash_mismatch';
}

export function isEvidenceRecord(x: unknown): x is EvidenceRecord {
  return evidenceRecordProblem(x) === null;
}

export function sealEvidence(rec: Omit<EvidenceRecord, 'contentHash' | 'kind'>): EvidenceRecord {
  const full = { ...rec, kind: 'evidence_record' as const };
  return { ...full, contentHash: hashOf({ ...full, contentHash: undefined }) };
}

/** Simulated content stays in the demo workspace (same rule as lab records). */
export function evidenceAllowed(rec: EvidenceRecord): boolean {
  return !(rec.simulated && rec.workspace === 'clinic');
}
