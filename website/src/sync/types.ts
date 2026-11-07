// Synchronisation contract shared by the browser outbox and the server (/api/sync).
//
// Local-first: every write lands in IndexedDB first (the entity and its outbox op in ONE transaction),
// then the sync engine pushes ops to the server. A record counts as "synchronised" only after the
// server acknowledged that exact op. Ops carry an idempotency key (opId): re-sending an op the server
// already applied is answered with 'duplicate' and changes nothing.

export const SYNC_ENTITIES = [
  'participant',
  'rehab_session',
  'note',
  'alert',
  'protocol_version',
  'validation_session',
  'trial',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export type OutboxState = 'pending' | 'conflict' | 'rejected';

export interface OutboxOp {
  /** Auto-increment key: FIFO order keeps parents ahead of children (participant → session → trial). */
  seq?: number;
  /** Idempotency key. A new payload for the same entity always gets a NEW opId. */
  opId: string;
  entity: SyncEntity;
  entityId: string;
  /** Server revision this edit was based on (null = never seen by the server). */
  baseRev: number | null;
  payload: unknown;
  /** Tombstone: the entity was deleted locally. The server soft-deletes (never drops rows). */
  deleted: boolean;
  createdAt: string;
  attempts: number;
  /** Epoch ms; the engine does not retry before this. */
  nextAttemptAt: number;
  lastError: string | null;
  state: OutboxState;
  /** On conflict: the server's current revision and payload, kept for the operator's decision. */
  server?: { rev: number; payload: unknown };
}

export interface SyncStateRow {
  /** `${entity}:${entityId}` */
  key: string;
  serverRev: number;
  syncedAt: string;
}

export interface PushRequest {
  deviceId: string;
  ops: Pick<OutboxOp, 'opId' | 'entity' | 'entityId' | 'baseRev' | 'payload' | 'deleted'>[];
}

export type PushStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'retry';

export interface PushResult {
  opId: string;
  status: PushStatus;
  /** Server revision after this op (applied / duplicate / conflict). */
  rev?: number;
  error?: string;
  /** On conflict: the server's current payload, so the operator can choose. */
  server?: unknown;
}

export interface PushResponse {
  results: PushResult[];
  cursor: number;
}

export interface PullChange {
  seq: number;
  entity: SyncEntity;
  entityId: string;
  rev: number;
  payload: unknown;
  deleted: boolean;
}

export interface PullResponse {
  changes: PullChange[];
  cursor: number;
  more: boolean;
}

/** Maximum ops per push request (Vercel request body limit is 4.5 MB). */
export const PUSH_BATCH = 50;
