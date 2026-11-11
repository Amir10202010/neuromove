// Scientific evidence graph — the auditable chain from a research question down to the raw observations:
//
//   question → hypothesis → (literature, protocol) → report → analysis → model → feature → trial → session → raw
//
// Every node is a thing that exists (a registered hypothesis, a frozen run, a stored session, a raw-stream manifest)
// and carries its content hash where it has one; every edge says how the upper node depends on the lower one. A
// displayed conclusion can be followed along `derived_from` edges until it reaches raw observations — or until the
// chain stops, in which case the graph says where and why (e.g. a session stored without raw frames). Nothing in
// the graph is inferred: it is assembled from the records themselves.

import type { Session } from '../../data/models';
import { isSimulatedSession } from '../../data/models';
import type { AnalysisRun } from '../runs';
import { hashOf } from '../hash';
import type { ProvenanceLabel } from '../measure/registry';
import { hypothesis } from './hypotheses';

export const NODE_TYPES = ['question', 'hypothesis', 'literature', 'protocol', 'report', 'analysis', 'model', 'feature', 'trial', 'session', 'raw'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface EvidenceNode {
  id: string;
  type: NodeType;
  label: string;
  /** Content hash when the thing has one (run result hash, protocol definition hash, raw-stream SHA-256 …). */
  hash: string | null;
  provenance: ProvenanceLabel | null;
  detail: Record<string, string | number | boolean | null>;
}

export type Relation = 'derived_from' | 'tests' | 'motivated_by' | 'cites' | 'pre_specified_by' | 'summarises';

export interface EvidenceEdge {
  from: string;
  to: string;
  relation: Relation;
}

export interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
}

export function emptyGraph(): EvidenceGraph {
  return { nodes: [], edges: [] };
}

function addNode(g: EvidenceGraph, n: EvidenceNode): EvidenceNode {
  const have = g.nodes.find((x) => x.id === n.id);
  if (have) return have;
  g.nodes.push(n);
  return n;
}
function addEdge(g: EvidenceGraph, from: string, to: string, relation: Relation): void {
  if (!g.edges.some((e) => e.from === from && e.to === to && e.relation === relation)) g.edges.push({ from, to, relation });
}

/** Question, hypothesis and its literature — the top of the graph. */
export function addHypothesis(g: EvidenceGraph, hypothesisId: string): string | null {
  const h = hypothesis(hypothesisId);
  if (!h) return null;
  const q = addNode(g, { id: `question:${h.id}`, type: 'question', label: h.question, hash: null, provenance: null, detail: {} });
  const hn = addNode(g, { id: `hypothesis:${h.id}`, type: 'hypothesis', label: `${h.id}: ${h.alternative}`, hash: hashOf(h), provenance: null, detail: { null: h.null, test: h.test, evidence: h.evidence, intent: h.intent } });
  addEdge(g, hn.id, q.id, 'motivated_by');
  for (const r of h.references) {
    const l = addNode(g, { id: `literature:${r}`, type: 'literature', label: r, hash: null, provenance: null, detail: { bibKey: r } });
    addEdge(g, hn.id, l.id, 'cites');
  }
  return hn.id;
}

/**
 * The chain below one frozen analysis run: analysis → model → feature → trial → session → raw, for every series
 * of the run. Sessions that the workspace no longer has are kept as nodes from the run's own snapshot (a frozen
 * run is self-contained) and marked `in_workspace: false`.
 */
export function addRun(g: EvidenceGraph, run: AnalysisRun, sessions: readonly Session[]): string {
  const prov = (simulated: boolean, kind: 'measurement' | 'estimate'): ProvenanceLabel => (simulated ? 'synthetic_simulation' : kind === 'estimate' ? 'model_estimate' : 'real_measurement');
  const an = addNode(g, { id: `analysis:${run.id}`, type: 'analysis', label: run.title || run.id, hash: run.resultHash, provenance: prov(run.simulated, 'estimate'), detail: { engine: run.engine, configHash: run.configHash, snapshotHash: run.snapshotHash, createdAt: run.createdAt, series: run.results.length } });
  if (run.protocol) {
    const pn = addNode(g, { id: `protocol:${run.protocol.id}`, type: 'protocol', label: `protocol ${run.protocol.protocolId} v${run.protocol.version}`, hash: run.protocol.defHash, provenance: null, detail: { version: run.protocol.version } });
    addEdge(g, an.id, pn.id, 'pre_specified_by');
  }
  run.snapshot.forEach((series, i) => {
    const res = run.results[i];
    const fid = `feature:${run.id}:${series.key}`;
    addNode(g, { id: fid, type: 'feature', label: `${series.metric} · ${series.exercise} · ${series.side}`, hash: res?.dataHash ?? null, provenance: prov(run.simulated, 'measurement'), detail: { metric: series.metric, unit: series.unit, registry: `metric.${series.metric}`, sessions: series.sessions.length, included: series.sessions.filter((s) => s.included).length } });
    if (res) {
      const mid = `model:${run.id}:${series.key}`;
      const row = res.comparison.rows.find((r) => r.model === res.selected);
      addNode(g, { id: mid, type: 'model', label: res.selected ? `${res.selected} (selected)` : 'no model selected', hash: null, provenance: prov(run.simulated, 'estimate'), detail: { selected: res.selected, candidates: res.comparison.rows.length, identifiable: row ? row.fit.identifiable : null, doseMode: res.doseMode, version: res.versions.models } });
      addEdge(g, an.id, mid, 'derived_from');
      addEdge(g, mid, fid, 'derived_from');
    } else addEdge(g, an.id, fid, 'derived_from');
    for (const obs of series.sessions) {
      const sid = `session:${obs.sessionId}`;
      const stored = sessions.find((s) => s.id === obs.sessionId);
      addNode(g, { id: sid, type: 'session', label: `session ${obs.date.slice(0, 10)}`, hash: null, provenance: prov(obs.simulated, 'measurement'), detail: { date: obs.date, algorithmVersion: obs.algorithmVersion, appVersion: obs.appVersion, signalPercent: obs.signalPercent, in_workspace: !!stored } });
      const tid = `trial:${run.id}:${series.key}:${obs.sessionId}`;
      addNode(g, { id: tid, type: 'trial', label: `${obs.n} repetition${obs.n === 1 ? '' : 's'}`, hash: hashOf(obs.reps), provenance: prov(obs.simulated, 'measurement'), detail: { repetitions: obs.n, included: obs.included, exclusions: obs.exclusions.join('; ') || null, mean: obs.mean } });
      addEdge(g, fid, tid, 'derived_from');
      addEdge(g, tid, sid, 'derived_from');
      const rid = `raw:${obs.sessionId}`;
      if (stored?.hasRaw) {
        addNode(g, { id: rid, type: 'raw', label: stored.rawManifest ? `raw stream, ${stored.rawManifest.frames} frames` : 'raw stream (no manifest: unverified)', hash: stored.rawManifest?.sha256 ?? null, provenance: isSimulatedSession(stored) ? 'synthetic_simulation' : 'real_measurement', detail: { frames: stored.rawManifest?.frames ?? null, rateHz: stored.rawManifest?.rateHz ?? stored.device.rateHz, verified_manifest: !!stored.rawManifest } });
        addEdge(g, sid, rid, 'derived_from');
      }
    }
  });
  return an.id;
}

export interface Trace {
  /** Node ids from the starting node to the end of this chain. */
  path: string[];
  /** The chain ends in a raw-stream node. */
  reachesRaw: boolean;
  /** Why the chain stops before raw observations, when it does. */
  stoppedBecause: string | null;
}

/**
 * Follow `derived_from` edges from a node down to every leaf. A leaf that is a session without a raw node is a
 * chain that stops at stored summaries: reported, not hidden.
 */
export function traceToRaw(g: EvidenceGraph, from: string): Trace[] {
  const out: Trace[] = [];
  const next = (id: string) => g.edges.filter((e) => e.from === id && (e.relation === 'derived_from' || e.relation === 'summarises')).map((e) => e.to);
  const walk = (id: string, path: string[]) => {
    const node = g.nodes.find((n) => n.id === id);
    const p = [...path, id];
    const kids = next(id).filter((k) => !p.includes(k));
    if (!kids.length) {
      const type = node?.type;
      out.push({ path: p, reachesRaw: type === 'raw', stoppedBecause: type === 'raw' ? null : type === 'session' ? (node?.detail.in_workspace === false ? 'the session is no longer in this workspace (the frozen run keeps its values)' : 'the session was stored without raw 100 Hz frames: the chain ends at its stored repetition metrics') : `no lower evidence recorded for ${type ?? 'this node'}` });
      return;
    }
    for (const k of kids) walk(k, p);
  };
  walk(from, []);
  return out;
}

export function nodeOf(g: EvidenceGraph, id: string): EvidenceNode | null {
  return g.nodes.find((n) => n.id === id) ?? null;
}

/** Summary of how well a node is grounded: chains, and how many reach raw observations. */
export function grounding(g: EvidenceGraph, from: string): { chains: number; reachingRaw: number; stopped: Record<string, number> } {
  const t = traceToRaw(g, from);
  const stopped: Record<string, number> = {};
  for (const x of t) if (x.stoppedBecause) stopped[x.stoppedBecause] = (stopped[x.stoppedBecause] ?? 0) + 1;
  return { chains: t.length, reachingRaw: t.filter((x) => x.reachesRaw).length, stopped };
}
