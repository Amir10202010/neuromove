// Building outbox operations. Pure: no storage, no network.

import { newId } from '../lib/ids';
import type { CollectionName } from '../data/db';
import type { OutboxOp, SyncEntity } from './types';

export const ENTITY_OF_COLLECTION: Record<CollectionName, SyncEntity> = {
  patients: 'participant',
  sessions: 'rehab_session',
  notes: 'note',
  alerts: 'alert',
};

/** Last server revision seen per entity (`${entity}:${id}`), maintained by the sync engine. */
const knownRevs = new Map<string, number>();

export function rememberRev(entity: SyncEntity, id: string, rev: number): void {
  const key = `${entity}:${id}`;
  if ((knownRevs.get(key) ?? -1) < rev) knownRevs.set(key, rev);
}

export function knownRev(entity: SyncEntity, id: string): number | null {
  return knownRevs.get(`${entity}:${id}`) ?? null;
}

export function resetKnownRevs(): void {
  knownRevs.clear();
}

export function makeOp(entity: SyncEntity, entityId: string, payload: unknown, deleted = false, now = new Date()): OutboxOp {
  return {
    opId: newId('op'),
    entity,
    entityId,
    baseRev: knownRev(entity, entityId),
    payload: deleted ? null : payload,
    deleted,
    createdAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending',
  };
}

/**
 * Exponential backoff with full jitter: 2 s, 4 s, 8 s … capped at 5 min. `random` is injectable for tests.
 */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(300_000, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base / 2 + random() * (base / 2));
}
