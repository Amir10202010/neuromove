// Текущий живой сеанс — один на всё приложение.

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { Patient, Session } from '../data/models';
import type { SessionEngine } from '../session/SessionEngine';
import type { EngineSnapshot } from '../session/types';
import { SessionController, type ControllerState, type RecoveryRecord, type SessionSetup } from './sessionController';

interface SessionStore {
  controller: SessionController | null;
  start(setup: SessionSetup, patient: Patient, history: readonly Session[], resume?: RecoveryRecord | null): SessionController;
  clear(): Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  controller: null,
  start(setup, patient, history, resume = null) {
    const prev = get().controller;
    if (prev) void prev.dispose();
    const controller = new SessionController(setup, patient, history, resume);
    set({ controller });
    return controller;
  },
  async clear() {
    const c = get().controller;
    set({ controller: null });
    if (c) await c.dispose();
  },
}));

const noopSubscribe = () => () => undefined;
const EMPTY_STATE: ControllerState | null = null;

export function useControllerState(c: SessionController | null): ControllerState | null {
  return useSyncExternalStore(c ? c.subscribe : noopSubscribe, c ? c.getState : () => EMPTY_STATE);
}

const EMPTY_SNAPSHOT: EngineSnapshot | null = null;
export function useEngineSnapshot(engine: SessionEngine | null): EngineSnapshot | null {
  return useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getSnapshot : () => EMPTY_SNAPSHOT,
  );
}
