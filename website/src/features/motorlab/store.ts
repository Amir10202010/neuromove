// State of the computational motor-learning lab: learning-study protocol versions and frozen analysis runs.
//
// Write path (same contract as research/store.ts and rehab/store.ts):
//   1. a pure function builds the record (lab/protocol.ts makeVersion, lab/runs.ts createRun)
//   2. it is committed to IndexedDB (store `lab`)
//   3. only then the in-memory state — and the screen — change
// Records are insert-only. The only permitted update is a protocol version's status (draft → frozen → archived),
// checked by canTransition; a frozen definition never changes. Lab records are local to this browser for now
// (not part of team sync) — the page says so.

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Workspace } from '../../data/models';
import { newId } from '../../lib/ids';
import { useAppStore } from '../../state/appStore';
import type { AnalysisConfig } from '../../lab/analysis';
import type { LearningSeries } from '../../lab/dataset';
import { canTransition, makeVersion, validateProtocol, type LearningProtocolDef, type LearningProtocolVersion } from '../../lab/protocol';
import { isLabRecord, type LabRecord } from '../../lab/records';
import { createRun, type AnalysisRun } from '../../lab/runs';

interface LabState {
  loaded: boolean;
  records: LabRecord[];
  /** Stored records that failed the shape check (kept in the database, not shown). */
  unreadable: number;
  error: string | null;
}

interface LabActions {
  load(): Promise<void>;
  saveProtocol(def: LearningProtocolDef, workspace: Workspace, author: string, previous: LearningProtocolVersion | null): Promise<LearningProtocolVersion | null>;
  setProtocolStatus(v: LearningProtocolVersion, to: LearningProtocolVersion['status']): Promise<boolean>;
  freezeRun(o: { workspace: Workspace; participantId: string; title: string; author: string; series: readonly LearningSeries[]; config: AnalysisConfig; protocol: LearningProtocolVersion | null }): Promise<AnalysisRun | null>;
}

const storage = () => useAppStore.getState().storage();

export const useLabStore = create<LabState & LabActions>((set, get) => ({
  loaded: false,
  records: [],
  unreadable: 0,
  error: null,

  async load() {
    const s = storage();
    if (!s) return;
    try {
      const all = await s.getAllResearch('lab');
      const ok = all.filter(isLabRecord);
      set({ records: ok, unreadable: all.length - ok.length, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async saveProtocol(def, workspace, author, previous) {
    if (validateProtocol(def).length) return null;
    const s = storage();
    if (!s) return null;
    const versions = get().records.filter((r): r is LearningProtocolVersion => r.kind === 'learning_protocol' && r.protocolId === previous?.protocolId);
    const latest = versions.sort((a, b) => b.version - a.version)[0] ?? previous;
    const v = makeVersion(latest ?? null, def, { workspace, author, now: new Date().toISOString(), id: newId('lp') });
    try {
      await s.putResearch('lab', v);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
    set({ records: [...get().records, v], error: null });
    return v;
  },

  async setProtocolStatus(v, to) {
    if (!canTransition(v.status, to)) return false;
    const s = storage();
    if (!s) return false;
    const next: LearningProtocolVersion = { ...v, status: to };
    try {
      await s.putResearch('lab', next);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    set({ records: get().records.map((r) => (r.id === v.id ? next : r)), error: null });
    return true;
  },

  async freezeRun(o) {
    const s = storage();
    if (!s) return null;
    const run = createRun({ ...o, id: newId('run'), now: new Date().toISOString() });
    try {
      await s.putResearch('lab', run);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
    set({ records: [...get().records, run], error: null });
    return run;
  },
}));

export function useLabRecords(ws: Workspace) {
  const records = useLabStore((s) => s.records);
  // Memoised: pages key expensive analyses on these arrays
  return useMemo(
    () => ({
      protocols: records.filter((r): r is LearningProtocolVersion => r.kind === 'learning_protocol' && r.workspace === ws),
      runs: records.filter((r): r is AnalysisRun => r.kind === 'analysis_run' && r.workspace === ws),
    }),
    [records, ws],
  );
}
