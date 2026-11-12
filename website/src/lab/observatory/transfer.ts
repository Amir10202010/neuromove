// Task Transfer Matrix — tasks are nodes; an edge A → B describes what was OBSERVED in task B over the period in
// which task A changed. An edge is called a transfer candidate only when the protocol designates B as untrained AND
// both tasks were measured at least twice; otherwise the edge says why transfer cannot be assessed. No edge is ever
// drawn to a task that was not measured: generalisation to unmeasured tasks is not claimed.
//
// "Transfer candidate" is deliberately weak wording: a change in an untrained task can also be maturation,
// familiarisation with the test, or a change of measurement conditions that affects every task alike (a control
// task unrelated to the trained one is the design that separates these — the matrix reports whether one exists).

import type { ChangeEstimate } from '../learning';

export type TaskRole = 'trained' | 'transfer' | 'undesignated';

export interface TransferNode {
  /** `exercise:side`. */
  task: string;
  role: TaskRole;
  /** Included sessions of the task. */
  sessions: number;
  /** Change first → last included session with its SE (lab/learning.ts), null with fewer than 2 sessions. */
  change: ChangeEstimate | null;
  /** +1 when a larger value is the "performance-up" direction of the metric, −1 otherwise (a convention). */
  up: 1 | -1;
}

export type TransferStatus = 'transfer_candidate' | 'no_change_in_untrained_task' | 'opposite_change_in_untrained_task' | 'trained_task_did_not_change' | 'co_change_only' | 'not_assessable';

export interface TransferEdge {
  from: string;
  to: string;
  status: TransferStatus;
  reason: string;
  /** Standardised changes (Δ / SE) of both tasks on the performance-up convention; null when not computable. */
  zFrom: number | null;
  zTo: number | null;
  /** Change in the target task as a share of the change in the source task (same units only: same metric). */
  ratio: number | null;
}

export interface TransferMatrix {
  nodes: TransferNode[];
  edges: TransferEdge[];
  /** A designated untrained task exists (otherwise transfer is not assessable at all). */
  hasTransferTask: boolean;
  notes: string[];
}

const z = (n: TransferNode): number | null => (n.change && n.change.se > 0 && Number.isFinite(n.change.se) ? (n.up * n.change.delta) / n.change.se : null);

export function transferMatrix(nodes: readonly TransferNode[]): TransferMatrix {
  const edges: TransferEdge[] = [];
  const notes: string[] = ['edges_describe_observations_over_the_same_period,_not_causes', 'no_edge_to_a_task_that_was_not_measured'];
  const trained = nodes.filter((n) => n.role === 'trained');
  const hasTransferTask = nodes.some((n) => n.role === 'transfer');
  if (!hasTransferTask) notes.push('no_task_is_designated_as_untrained:_transfer_cannot_be_assessed,_only_co-change_described');
  if (!trained.length) notes.push('no_task_is_designated_as_trained');
  const sources = trained.length ? trained : nodes.filter((n) => n.role === 'undesignated');
  for (const a of sources)
    for (const b of nodes) {
      if (a.task === b.task) continue;
      const za = z(a);
      const zb = z(b);
      const ratio = a.change && b.change && a.change.delta !== 0 ? (b.up * b.change.delta) / (a.up * a.change.delta) : null;
      const base = { from: a.task, to: b.task, zFrom: za, zTo: zb, ratio };
      if (a.sessions < 2 || b.sessions < 2 || za === null || zb === null) {
        edges.push({ ...base, status: 'not_assessable', reason: 'a task has fewer than two included sessions', ratio: null });
        continue;
      }
      if (b.role !== 'transfer') {
        edges.push({ ...base, status: a.role === 'trained' && b.role === 'trained' ? 'co_change_only' : 'not_assessable', reason: b.role === 'trained' ? 'both tasks were trained: a common change is not transfer' : 'the target task is not designated as untrained by a protocol' });
        continue;
      }
      if (a.role !== 'trained') {
        edges.push({ ...base, status: 'not_assessable', reason: 'the source task is not designated as trained' });
        continue;
      }
      if (!a.change?.exceedsNoise) edges.push({ ...base, status: 'trained_task_did_not_change', reason: 'the trained task did not change beyond its noise: there is nothing to transfer' });
      else if (!b.change?.exceedsNoise) edges.push({ ...base, status: 'no_change_in_untrained_task', reason: 'the untrained task did not change beyond its noise (not evidence of no transfer)' });
      else if (Math.sign(za) !== Math.sign(zb)) edges.push({ ...base, status: 'opposite_change_in_untrained_task', reason: 'the untrained task changed in the opposite direction' });
      else edges.push({ ...base, status: 'transfer_candidate', reason: 'both changed beyond noise in the same direction; maturation, familiarisation and measurement conditions are not excluded' });
    }
  return { nodes: [...nodes], edges, hasTransferTask, notes };
}
