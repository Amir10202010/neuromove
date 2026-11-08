// Rehab state: every Functional Progression record of both workspaces.
//
// Write path (same contract as the research module):
//   1. pure workflow functions build the records (goals.ts, programs.ts, workflows.ts)
//   2. each record is validated (validate.ts), authorised for the acting person (policy.ts) and checked
//      against the stored version for historical integrity (checkTransition)
//   3. records + outbox ops are committed to IndexedDB in ONE transaction
//   4. only then the in-memory state and the screen change
// A refusal in step 2 or a failed write in step 3 changes nothing and is returned to the caller.

import { create } from 'zustand';
import type { Workspace } from '../data/models';
import { useAppStore } from '../state/appStore';
import { makeOp } from '../sync/ops';
import { remoteListeners, scheduleSync } from '../sync/engine';
import type { RehabKind, RecordOf, RehabRecord } from './model';
import { canWriteRehab, type Actor, type Denial } from './policy';
import { checkTransition, validRehabRecord, type TransitionProblem } from './validate';

export type SaveError = 'invalid_record' | Exclude<Denial, null> | Exclude<TransitionProblem, null> | 'storage_not_ready' | 'write_failed' | 'duplicate_in_batch';
export type SaveResult = { ok: true; records: RehabRecord[] } | { ok: false; error: SaveError; detail?: string };

interface RehabState {
  loaded: boolean;
  records: RehabRecord[];
  lastSavedAt: string | null;
  saving: boolean;
  error: string | null;
}

interface RehabActions {
  load(): Promise<void>;
  /** Validate, authorise and persist records atomically. */
  save(records: readonly RehabRecord[], actor: Actor): Promise<SaveResult>;
  /** Replace the demo workspace's rehab records (demo seeding only; never touches clinic data). */
  replaceDemo(records: readonly RehabRecord[]): Promise<void>;
}

const storage = () => useAppStore.getState().storage();

/** Pure pre-flight shared by the store and tests: what would `save` say? */
export function checkSave(records: readonly RehabRecord[], actor: Actor, current: readonly RehabRecord[]): SaveResult {
  const byId = new Map(current.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) return { ok: false, error: 'duplicate_in_batch', detail: r.id };
    seen.add(r.id);
    if (!validRehabRecord(JSON.parse(JSON.stringify(r)))) return { ok: false, error: 'invalid_record', detail: `${r.kind}:${r.id}` };
    const prev = byId.get(r.id) ?? null;
    const denial = canWriteRehab(actor, r, prev);
    if (denial) return { ok: false, error: denial, detail: `${r.kind}:${r.id}` };
    if (prev) {
      const problem = checkTransition(prev, r);
      if (problem) return { ok: false, error: problem, detail: `${r.kind}:${r.id}` };
    }
  }
  return { ok: true, records: [...records] };
}

export const useRehabStore = create<RehabState & RehabActions>((set, get) => ({
  loaded: false,
  records: [],
  lastSavedAt: null,
  saving: false,
  error: null,

  async load() {
    const st = storage();
    if (!st) return;
    // Records are validated on the way in, like every other store: a damaged record is not shown
    const all = (await st.getAllResearch('rehab')).filter((r) => validRehabRecord(r));
    set({ records: all, loaded: true });
  },

  async save(records, actor) {
    const st = storage();
    if (!st) return { ok: false, error: 'storage_not_ready' };
    const pre = checkSave(records, actor, get().records);
    if (!pre.ok) return pre;
    const copies = records.map((r) => structuredClone(r));
    set({ saving: true });
    try {
      await st.putResearchBatch(
        'rehab',
        copies,
        copies.filter((r) => r.workspace === 'clinic').map((r) => makeOp('rehab_record', r.id, r)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ saving: false, error: msg });
      return { ok: false, error: 'write_failed', detail: msg };
    }
    const byId = new Map(get().records.map((r) => [r.id, r]));
    for (const r of copies) byId.set(r.id, r);
    set({ records: [...byId.values()], saving: false, error: null, lastSavedAt: new Date().toISOString() });
    if (copies.some((r) => r.workspace === 'clinic')) scheduleSync();
    // A user edit of demo records stops the daily demo re-seed from overwriting it
    if (copies.some((r) => r.workspace === 'demo')) {
      const meta = (await st.getMeta('rehabDemo')) as { modified?: boolean } | undefined;
      if (meta && !meta.modified) await st.setMeta('rehabDemo', { ...meta, modified: true });
    }
    return { ok: true, records: copies };
  },

  async replaceDemo(records) {
    const st = storage();
    if (!st) return;
    const old = get().records.filter((r) => r.workspace === 'demo').map((r) => r.id);
    await st.removeResearch('rehab', old);
    const demo = records.filter((r) => r.workspace === 'demo');
    await st.putResearchBatch('rehab', demo, []);
    set({ records: [...get().records.filter((r) => r.workspace !== 'demo'), ...demo] });
  },
}));

// Pulled server changes → in-memory state (already validated and written by appStore.applyRemote)
remoteListeners.add((ch) => {
  if (ch.entity !== 'rehab_record' || !ch.payload) return;
  const s = useRehabStore.getState();
  if (!s.loaded || !validRehabRecord(ch.payload)) return;
  const r = ch.payload;
  useRehabStore.setState({ records: s.records.some((x) => x.id === r.id) ? s.records.map((x) => (x.id === r.id ? r : x)) : [...s.records, r] });
});

// ── Selectors ──────────────────────────────────────────────────────────────────────────────────

export function ofKind<K extends RehabKind>(records: readonly RehabRecord[], kind: K, ws: Workspace, participantId?: string): RecordOf<K>[] {
  return records.filter((r): r is RecordOf<K> => r.kind === kind && r.workspace === ws && (participantId === undefined || r.participantId === participantId));
}

export function findRecord<K extends RehabKind>(records: readonly RehabRecord[], kind: K, id: string): RecordOf<K> | undefined {
  return records.find((r): r is RecordOf<K> => r.kind === kind && r.id === id);
}
