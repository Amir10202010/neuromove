// Frozen analysis runs — the unit of reproducible scientific results.
//
// A run stores: the exact input observations (a snapshot, so later edits or reprocessing of sessions cannot change
// it), the configuration, the protocol version (if any), every component version, and the full results with a
// SHA-256 of them. Runs are insert-only: a new algorithm never rewrites an old run; re-running creates a NEW run,
// and verifyRun() reports whether the current engine reproduces the stored result.
//
// Lineage: Study → Protocol version → Participant → Session → Raw / stored repetition metrics → Quality rules →
// Learning series → Model fitting → Results → Report (docs/architecture/data-lineage.md).

import type { Workspace } from '../data/models';
import { analyzeSeries, type AnalysisConfig, type SeriesAnalysis } from './analysis';
import type { LearningSeries } from './dataset';
import { hashOf } from './hash';
import { RESULT_HASH_SCHEME, resultsHash } from './integrity';
import type { LearningProtocolVersion } from './protocol';
import { LAB_ENGINE_VERSION, LAB_VERSIONS } from './version';

export interface AnalysisRun {
  id: string;
  kind: 'analysis_run';
  workspace: Workspace;
  participantId: string;
  title: string;
  createdAt: string;
  createdBy: string;
  protocol: { id: string; protocolId: string; version: number; defHash: string } | null;
  config: AnalysisConfig;
  configHash: string;
  engine: string;
  versions: typeof LAB_VERSIONS;
  /** Source sessions with the core algorithm/app version that produced their stored metrics. */
  inputs: { sessionId: string; startedAt: string; algorithmVersion: string; appVersion: string }[];
  /** The observations exactly as analysed (immutable copy). */
  snapshot: LearningSeries[];
  snapshotHash: string;
  results: SeriesAnalysis[];
  resultHash: string;
  hashScheme: number;
  simulated: boolean;
}

// Result hashing lives in integrity.ts (shared with the server validator).
export { RESULT_DIGITS, RESULT_HASH_SCHEME, resultsHash } from './integrity';

export function createRun(o: {
  id: string;
  workspace: Workspace;
  participantId: string;
  title: string;
  now: string;
  author: string;
  series: readonly LearningSeries[];
  config: AnalysisConfig;
  protocol: LearningProtocolVersion | null;
}): AnalysisRun {
  const snapshot: LearningSeries[] = JSON.parse(JSON.stringify(o.series));
  const results = snapshot.map((s) => analyzeSeries(s, o.config));
  const inputs = new Map<string, AnalysisRun['inputs'][number]>();
  for (const s of snapshot) for (const x of s.sessions) inputs.set(x.sessionId, { sessionId: x.sessionId, startedAt: x.date, algorithmVersion: x.algorithmVersion, appVersion: x.appVersion });
  return {
    id: o.id,
    kind: 'analysis_run',
    workspace: o.workspace,
    participantId: o.participantId,
    title: o.title,
    createdAt: o.now,
    createdBy: o.author,
    protocol: o.protocol ? { id: o.protocol.id, protocolId: o.protocol.protocolId, version: o.protocol.version, defHash: o.protocol.defHash } : null,
    config: JSON.parse(JSON.stringify(o.config)),
    configHash: hashOf(o.config),
    engine: LAB_ENGINE_VERSION,
    versions: LAB_VERSIONS,
    inputs: [...inputs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    snapshot,
    snapshotHash: hashOf(snapshot),
    results,
    resultHash: resultsHash(results),
    hashScheme: RESULT_HASH_SCHEME,
    simulated: snapshot.some((s) => s.sessions.some((x) => x.simulated)),
  };
}

export type Verification =
  | { status: 'reproduced' }
  | { status: 'tampered'; what: 'snapshot' | 'config' | 'results' }
  | { status: 'differs'; engineChanged: boolean; changed: string[] };

/** Recompute the run from its own snapshot and configuration with the CURRENT engine, and compare. */
export function verifyRun(run: AnalysisRun): Verification {
  if (hashOf(run.snapshot) !== run.snapshotHash) return { status: 'tampered', what: 'snapshot' };
  if (hashOf(run.config) !== run.configHash) return { status: 'tampered', what: 'config' };
  if ((run.hashScheme ?? 1) !== RESULT_HASH_SCHEME) return { status: 'differs', engineChanged: true, changed: ['hash_scheme'] };
  if (resultsHash(run.results) !== run.resultHash) return { status: 'tampered', what: 'results' };
  const again = run.snapshot.map((s) => analyzeSeries(s, run.config));
  if (resultsHash(again) === run.resultHash) return { status: 'reproduced' };
  const changed = again.filter((a, i) => resultsHash([a]) !== resultsHash([run.results[i] as SeriesAnalysis])).map((a) => a.seriesKey);
  return { status: 'differs', engineChanged: run.engine !== LAB_ENGINE_VERSION || JSON.stringify(run.versions) !== JSON.stringify(LAB_VERSIONS), changed };
}
