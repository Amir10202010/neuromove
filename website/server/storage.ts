// Raw recording storage abstraction. Raw sensor data is kept separate from all derived data.
//
// Backend selection (RAW_STORAGE):
//   'postgres' (default) — chunk bytes in nm_raw_chunks.bytea. Works with no extra service; fine for the
//                          current scale (3 sensors × 100 Hz ≈ 2 MB per 10-minute session, gzip ≈ ¼).
//   'object'             — NOT IMPLEMENTED in this build: would write bytes to an S3-compatible bucket
//                          (Supabase Storage / R2) and keep only object_key + sha256 in PostgreSQL.
//                          Selecting it without an implementation returns 501 instead of silently
//                          dropping data.
// Chunks are idempotent: (team, recording, chunk index) is the key; re-uploading the same bytes is a
// no-op, different bytes for an existing chunk are refused (raw data is never overwritten).

import { createHash } from 'node:crypto';
import type { Principal } from './auth';
import type { Db } from './db';

const MAX_CHUNK_BYTES = 3 * 1024 * 1024;
const ENCODINGS = ['imu-csv-v1+gzip+base64', 'imu-csv-v1+base64'];

export async function putRawChunk(
  db: Db,
  env: Record<string, string | undefined>,
  p: Principal,
  b: { recordingId?: string; chunkIndex?: number; frameCount?: number; encoding?: string; sha256?: string; data?: string },
): Promise<{ ok: true; duplicate: boolean } | { status: number; error: string }> {
  if ((env.RAW_STORAGE ?? 'postgres') !== 'postgres') return { status: 501, error: 'raw_storage_backend_not_implemented' };
  if (typeof b.recordingId !== 'string' || !/^[\w-]{1,80}$/.test(b.recordingId)) return { status: 400, error: 'invalid_recording_id' };
  if (!Number.isInteger(b.chunkIndex) || (b.chunkIndex as number) < 0 || !Number.isInteger(b.frameCount) || (b.frameCount as number) < 1) return { status: 400, error: 'invalid_chunk' };
  if (!b.encoding || !ENCODINGS.includes(b.encoding) || typeof b.data !== 'string' || typeof b.sha256 !== 'string') return { status: 400, error: 'invalid_chunk' };
  const bytes = Buffer.from(b.data, 'base64');
  if (bytes.length > MAX_CHUNK_BYTES) return { status: 413, error: 'chunk_too_large' };
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== b.sha256) return { status: 400, error: 'checksum_mismatch' };
  // The recording must be a session of this team (rehab or validation)
  const owner = await db.query<{ team_id: string }>('select team_id from nm_rehab_sessions where id = $1 union all select team_id from nm_validation_sessions where id = $1', [b.recordingId]);
  if (!owner[0]) return { status: 409, error: 'session_not_synced_yet' };
  if (owner[0].team_id !== p.teamId) return { status: 403, error: 'forbidden' };
  const existing = await db.query<{ sha256: string }>('select sha256 from nm_raw_chunks where team_id = $1 and recording_id = $2 and chunk_index = $3', [p.teamId, b.recordingId, b.chunkIndex]);
  if (existing[0]) return existing[0].sha256 === digest ? { ok: true, duplicate: true } : { status: 409, error: 'raw_chunk_exists_with_different_content' };
  await db.query('insert into nm_raw_chunks (team_id, recording_id, chunk_index, sha256, frame_count, encoding, bytes) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing', [
    p.teamId,
    b.recordingId,
    b.chunkIndex,
    digest,
    b.frameCount,
    b.encoding,
    bytes,
  ]);
  await db.query("insert into nm_audit_events (team_id, user_id, action, entity, entity_id, details) values ($1, $2, 'raw_chunk', 'recording', $3, $4)", [p.teamId, p.userId, b.recordingId, { chunk: b.chunkIndex, frames: b.frameCount, bytes: bytes.length }]);
  return { ok: true, duplicate: false };
}

export async function listRawChunks(db: Db, p: Principal, recordingId: string) {
  return db.query('select chunk_index, sha256, frame_count, encoding, created_at from nm_raw_chunks where team_id = $1 and recording_id = $2 order by chunk_index', [p.teamId, recordingId]);
}
