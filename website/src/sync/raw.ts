// Raw recording upload (rehab sessions recorded with raw frames). Runs inside the sync cycle, AFTER the
// session record itself was acknowledged (the server refuses chunks of unknown sessions with 409).
//
// Batching: 1 000 frames per chunk (10 s at 100 Hz) → imu-csv v1 text → gzip (CompressionStream when
// available) → base64. Each chunk carries its SHA-256; the server verifies it and stores the chunk once
// (re-upload of the same bytes is acknowledged as duplicate, different bytes are refused).
// Progress is remembered per chunk in the syncstate store (`raw:<session>:<index>`), so an interrupted
// upload resumes where it stopped.

import type { DataStorage } from '../data/db';
import type { RawFrame } from '../devices/types';
import type { Transport } from './engine';

export const RAW_CHUNK_FRAMES = 1000;

export interface RawSource {
  /** Clinic sessions with raw data, acknowledged by the server. */
  sessions(): string[];
  get(sessionId: string): Promise<RawFrame[] | null>;
}

const PLACEMENTS = ['trunk', 'upper_l', 'upper_r', 'fore_l', 'fore_r'] as const;

export function chunkText(frames: readonly RawFrame[]): string {
  const present = PLACEMENTS.filter((p) => frames.some((f) => f.data[p]));
  const head = ['seq', 't', ...present.flatMap((p) => ['ax', 'ay', 'az', 'gx', 'gy', 'gz'].map((a) => `${p}_${a}`))].join(',');
  const EMPTY: (number | string)[] = ['', '', '', '', '', ''];
  const rows = frames.map((f) => [f.seq, f.t, ...present.flatMap((p): (number | string)[] => (f.data[p] ? Array.from(f.data[p] as Int16Array) : EMPTY))].join(','));
  return `# imu-csv v1 chunk\n${head}\n${rows.join('\n')}\n`;
}

async function gzip(bytes: Uint8Array): Promise<{ bytes: Uint8Array; gz: boolean }> {
  if (typeof CompressionStream === 'undefined') return { bytes, gz: false };
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gz: true };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Upload missing chunks. Returns the number uploaded; stops at the first failure (retried next cycle). */
export async function uploadRaw(storage: DataStorage, source: RawSource, transport: Transport, limit = 20): Promise<number> {
  const done = new Set((await storage.getSyncState()).filter((r) => r.key.startsWith('raw:')).map((r) => r.key));
  let sent = 0;
  for (const sessionId of source.sessions()) {
    const frames = await source.get(sessionId);
    if (!frames?.length) continue;
    for (let i = 0; i * RAW_CHUNK_FRAMES < frames.length; i++) {
      const key = `raw:${sessionId}:${i}`;
      if (done.has(key)) continue;
      if (sent >= limit) return sent;
      const part = frames.slice(i * RAW_CHUNK_FRAMES, (i + 1) * RAW_CHUNK_FRAMES);
      const { bytes, gz } = await gzip(new TextEncoder().encode(chunkText(part)));
      const res = await transport('/api/raw', {
        method: 'POST',
        body: { recordingId: sessionId, chunkIndex: i, frameCount: part.length, encoding: gz ? 'imu-csv-v1+gzip+base64' : 'imu-csv-v1+base64', sha256: await sha256Hex(bytes), data: base64(bytes) },
      });
      if (res.status !== 200) return sent;
      await storage.putSyncState([{ key, serverRev: 1, syncedAt: new Date().toISOString() }]);
      sent++;
    }
  }
  return sent;
}
