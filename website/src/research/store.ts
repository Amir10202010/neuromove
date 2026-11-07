// Research state: validation protocols, sessions and trials.
//
// Write path for every operator action:
//   1. pure workflow function produces the records (research/workflow.ts)
//   2. records + their outbox ops are committed to IndexedDB in ONE transaction
//   3. only then the in-memory state (and the screen) changes and "Saved on this device" appears
// If step 2 fails nothing changes on screen and the operator sees the error: the measurement is never
// shown as saved when it is not.

import { create } from 'zustand';
import type { Workspace } from '../data/models';
import { ALGORITHM_VERSION, APP_VERSION } from '../core/version';
import { newId } from '../lib/ids';
import { useAppStore } from '../state/appStore';
import { makeOp } from '../sync/ops';
import { remoteListeners, scheduleSync } from '../sync/engine';
import type { DeviceSnapshot, ProtocolDefinition, ProtocolVersion, Trial, ValidationSession } from './model';
import { newVersion } from './protocols';
import type { Result } from './workflow';

interface ResearchState {
  loaded: boolean;
  protocols: ProtocolVersion[];
  sessions: ValidationSession[];
  trials: Trial[];
  /** Last confirmed local write (ISO). */
  lastSavedAt: string | null;
  saving: boolean;
  error: string | null;
}

interface ResearchActions {
  load(): Promise<void>;
  saveProtocol(def: ProtocolDefinition, workspace: Workspace, author: string, protocolId?: string): Promise<ProtocolVersion | null>;
  archiveProtocol(v: ProtocolVersion): Promise<void>;
  createSession(args: { workspace: Workspace; participantId: string; operator: string; protocol: ProtocolVersion; device: DeviceSnapshot; notes: string }): Promise<ValidationSession>;
  updateSession(id: string, patch: Partial<Pick<ValidationSession, 'status' | 'endedAt' | 'notes' | 'calibration' | 'signal' | 'device'>>): Promise<void>;
  /** Persist the records of a workflow action. Returns false (and changes nothing) when the write failed. */
  apply(result: Result<Trial[]>): Promise<{ ok: true; trials: Trial[] } | { ok: false; error: string }>;
}

const st = () => {
  const s = useAppStore.getState().storage();
  if (!s) throw new Error('storage not ready');
  return s;
};

const opFor = (entity: 'protocol_version' | 'validation_session' | 'trial', id: string, payload: { workspace: Workspace }) =>
  payload.workspace === 'clinic' ? [makeOp(entity, id, payload)] : [];

export const useResearchStore = create<ResearchState & ResearchActions>((set, get) => {
  const confirm = () => {
    set({ lastSavedAt: new Date().toISOString(), saving: false, error: null });
    scheduleSync();
  };
  const failed = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    set({ saving: false, error: msg });
    return msg;
  };
  return {
    loaded: false,
    protocols: [],
    sessions: [],
    trials: [],
    lastSavedAt: null,
    saving: false,
    error: null,

    async load() {
      const s = st();
      const [protocols, sessions, trials] = await Promise.all([s.getAllResearch('protocols'), s.getAllResearch('vsessions'), s.getAllResearch('trials')]);
      set({ protocols, sessions, trials, loaded: true });
    },

    async saveProtocol(def, workspace, author, protocolId) {
      const v = newVersion(get().protocols, def, workspace, author, protocolId);
      if (!v) return null;
      set({ saving: true });
      try {
        await st().putResearchBatch('protocols', [v], opFor('protocol_version', v.key, v));
      } catch (e) {
        failed(e);
        throw e;
      }
      set({ protocols: [...get().protocols, v] });
      confirm();
      return v;
    },

    async archiveProtocol(v) {
      // Archiving is a new flag on the stored version (definition untouched). Sessions keep their snapshot.
      const next = { ...v, archived: true };
      await st().putResearchBatch('protocols', [next], opFor('protocol_version', v.key, next));
      set({ protocols: get().protocols.map((p) => (p.key === v.key ? next : p)) });
      confirm();
    },

    async createSession({ workspace, participantId, operator, protocol, device, notes }) {
      const now = new Date().toISOString();
      const session: ValidationSession = {
        id: newId('vs'),
        workspace,
        participantId,
        operator,
        protocolKey: protocol.key,
        protocol: structuredClone(protocol.definition),
        protocolVersion: protocol.version,
        device,
        algorithmVersion: ALGORITHM_VERSION,
        appVersion: APP_VERSION,
        startedAt: now,
        endedAt: null,
        status: 'active',
        calibration: null,
        signal: null,
        notes,
        createdAt: now,
        updatedAt: now,
      };
      set({ saving: true });
      try {
        await st().putResearchBatch('vsessions', [session], opFor('validation_session', session.id, session));
      } catch (e) {
        failed(e);
        throw e;
      }
      set({ sessions: [...get().sessions, session] });
      confirm();
      return session;
    },

    async updateSession(id, patch) {
      const cur = get().sessions.find((s) => s.id === id);
      if (!cur) return;
      const next: ValidationSession = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      set({ saving: true });
      try {
        await st().putResearchBatch('vsessions', [next], opFor('validation_session', id, next));
      } catch (e) {
        failed(e);
        throw e;
      }
      set({ sessions: get().sessions.map((s) => (s.id === id ? next : s)) });
      confirm();
    },

    async apply(result) {
      if (!result.ok) return { ok: false, error: result.error };
      const records = result.value;
      set({ saving: true });
      try {
        await st().putResearchBatch(
          'trials',
          records,
          records.flatMap((t) => opFor('trial', t.id, t)),
        );
      } catch (e) {
        return { ok: false, error: failed(e) };
      }
      const byId = new Map(get().trials.map((t) => [t.id, t]));
      for (const t of records) byId.set(t.id, t);
      set({ trials: [...byId.values()] });
      confirm();
      return { ok: true, trials: records };
    },
  };
});

// Pulled server changes → in-memory state (the record is already in IndexedDB)
remoteListeners.add((ch) => {
  const s = useResearchStore.getState();
  if (!s.loaded || !ch.payload) return;
  const upsert = <T,>(list: T[], key: (x: T) => string, v: T) => (list.some((x) => key(x) === key(v)) ? list.map((x) => (key(x) === key(v) ? v : x)) : [...list, v]);
  if (ch.entity === 'trial') useResearchStore.setState({ trials: upsert(s.trials, (x) => x.id, ch.payload as Trial) });
  if (ch.entity === 'validation_session') useResearchStore.setState({ sessions: upsert(s.sessions, (x) => x.id, ch.payload as ValidationSession) });
  if (ch.entity === 'protocol_version') useResearchStore.setState({ protocols: upsert(s.protocols, (x) => x.key, ch.payload as ProtocolVersion) });
});

export function sessionTrials(all: readonly Trial[], sessionId: string): Trial[] {
  return all.filter((t) => t.sessionId === sessionId);
}
