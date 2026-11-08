// State of the computational motor-learning lab: learning-study protocol versions, frozen analysis runs,
// practice-trial sets and practice-trial recording settings.
//
// Write path (same contract as research/store.ts and rehab/store.ts):
//   1. a pure function builds the record (lab/protocol.ts makeVersion, lab/runs.ts createRun, lab/records.ts …)
//   2. the record passes the shared integrity check (lab/integrity.ts — the server applies the same rules)
//   3. record + its outbox op are committed to IndexedDB in ONE transaction (clinic workspace only; demo never syncs)
//   4. only then the in-memory state — and the screen — change
// Records are insert-only. The only permitted update is a protocol version's status (draft → frozen → archived).

import { useMemo } from 'react';
import { create } from 'zustand';
import type { Workspace } from '../../data/models';
import { newId } from '../../lib/ids';
import { useAppStore } from '../../state/appStore';
import { makeOp } from '../../sync/ops';
import { remoteListeners, scheduleSync } from '../../sync/engine';
import type { AnalysisConfig } from '../../lab/analysis';
import type { LearningSeries } from '../../lab/dataset';
import { labRecordProblem, labTransitionProblem } from '../../lab/integrity';
import { canTransition, makeVersion, validateProtocol, type LearningProtocolDef, type LearningProtocolVersion } from '../../lab/protocol';
import { isLabRecord, type LabRecord, type PracticeTrialSet, type TrialRecordingSetting } from '../../lab/records';
import { createRun, type AnalysisRun } from '../../lab/runs';

interface LabState {
  loaded: boolean;
  records: LabRecord[];
  /** Stored records that failed the shape or hash check (kept in the database, not shown). */
  unreadable: number;
  error: string | null;
}

interface LabActions {
  load(): Promise<void>;
  saveProtocol(def: LearningProtocolDef, workspace: Workspace, author: string, previous: LearningProtocolVersion | null): Promise<LearningProtocolVersion | null>;
  setProtocolStatus(v: LearningProtocolVersion, to: LearningProtocolVersion['status']): Promise<boolean>;
  freezeRun(o: { workspace: Workspace; participantId: string; title: string; author: string; series: readonly LearningSeries[]; config: AnalysisConfig; protocol: LearningProtocolVersion | null }): Promise<AnalysisRun | null>;
  setTrialRecording(o: { workspace: Workspace; participantId: string; enabled: boolean; consentId: string | null; author: string }): Promise<boolean>;
  saveTrialSet(set: PracticeTrialSet): Promise<boolean>;
}

const storage = () => useAppStore.getState().storage();

export const useLabStore = create<LabState & LabActions>((set, get) => {
  /** Validate, commit with its outbox op (clinic), then show. Returns false when refused or not written. */
  const put = async (rec: LabRecord, prev: LabRecord | null): Promise<boolean> => {
    const s = storage();
    if (!s) return false;
    if (labRecordProblem(rec)) {
      set({ error: 'invalid_record' });
      return false;
    }
    if (prev && labTransitionProblem(prev as unknown as Record<string, unknown>, rec as unknown as Record<string, unknown>)) {
      set({ error: 'immutable' });
      return false;
    }
    try {
      await s.putResearchBatch('lab', [rec], rec.workspace === 'clinic' ? [makeOp('lab_record', rec.id, rec)] : []);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    const others = get().records.filter((r) => r.id !== rec.id);
    set({ records: [...others, rec], error: null });
    if (rec.workspace === 'clinic') scheduleSync();
    return true;
  };

  return {
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
      const versions = get().records.filter((r): r is LearningProtocolVersion => r.kind === 'learning_protocol' && r.protocolId === previous?.protocolId);
      const latest = versions.sort((a, b) => b.version - a.version)[0] ?? previous;
      const v = makeVersion(latest ?? null, def, { workspace, author, now: new Date().toISOString(), id: newId('lp') });
      return (await put(v, null)) ? v : null;
    },

    async setProtocolStatus(v, to) {
      if (!canTransition(v.status, to)) return false;
      return put({ ...v, status: to }, v);
    },

    async freezeRun(o) {
      const run = createRun({ ...o, id: newId('run'), now: new Date().toISOString() });
      return (await put(run, null)) ? run : null;
    },

    async setTrialRecording(o) {
      const rec: TrialRecordingSetting = {
        id: newId('trec'),
        kind: 'trial_recording',
        workspace: o.workspace,
        participantId: o.participantId,
        enabled: o.enabled,
        consentId: o.enabled ? o.consentId : null,
        createdAt: new Date().toISOString(),
        createdBy: o.author,
      };
      return put(rec, null);
    },

    async saveTrialSet(trialSet) {
      return put(trialSet, null);
    },
  };
});

// Pulled server changes → in-memory state (already validated and written by appStore.applyRemote)
remoteListeners.add((ch) => {
  if (ch.entity !== 'lab_record' || !ch.payload || !isLabRecord(ch.payload)) return;
  const s = useLabStore.getState();
  if (!s.loaded) return;
  const r = ch.payload;
  useLabStore.setState({ records: s.records.some((x) => x.id === r.id) ? s.records.map((x) => (x.id === r.id ? r : x)) : [...s.records, r] });
});

export function useLabRecords(ws: Workspace) {
  const records = useLabStore((s) => s.records);
  // Memoised: pages key expensive analyses on these arrays
  return useMemo(
    () => ({
      protocols: records.filter((r): r is LearningProtocolVersion => r.kind === 'learning_protocol' && r.workspace === ws),
      runs: records.filter((r): r is AnalysisRun => r.kind === 'analysis_run' && r.workspace === ws),
      trialSets: records.filter((r): r is PracticeTrialSet => r.kind === 'practice_trials' && r.workspace === ws),
      recordings: records.filter((r): r is TrialRecordingSetting => r.kind === 'trial_recording' && r.workspace === ws),
    }),
    [records, ws],
  );
}
