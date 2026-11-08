// Raw-recording manifest: what was recorded, how, and a content hash that makes the stored stream verifiable.
//
// Written ONCE when a recording is saved (session finalize, practice sitting with consent-gated trial recording),
// from exactly the frames that are stored. MCSE recomputes the hash before analysis and refuses a mismatch: raw
// observations are immutable, and a changed stream is reported, never silently analysed.
// Dependency-light (no analysis engine) so the main bundle can import it.

import { sha256Hex } from '../hash';
import { PLACEMENTS, type Placement, type RawFrame, type Side } from '../../devices/types';
import type { SessionEvent } from '../../session/types';

export const RAW_MANIFEST_SCHEME = 'nm-raw-manifest 1';

export type SyncModel = 'single_tick_sequential_i2c' | 'per_packet_seq_aligned' | 'simulated' | 'unknown';

export interface RawTimeline {
  /** Seconds from the first stored frame. */
  calibrationEnd: number | null;
  steps: { exercise: string; side: Side; tStart: number; tEnd: number }[];
}

export interface RawManifest {
  scheme: typeof RAW_MANIFEST_SCHEME;
  frames: number;
  seqFirst: number;
  seqLast: number;
  tFirst: number;
  tLast: number;
  placements: Placement[];
  rateHz: number;
  /** SHA-256 of the canonical byte encoding (see encodeFrames). */
  sha256: string;
  /** Sensor-mounting convention the axes follow. */
  mount: 'COORDINATES.md §2';
  sync: SyncModel;
  /** Accelerometer 6-position calibration present in the device passport (values are in session.device.accCal). */
  accCalibrated: boolean;
  /** Session calibration pose: the still frames are INSIDE the stream; their end is timeline.calibrationEnd. */
  timeline: RawTimeline;
  /** Software that recorded the stream (algorithm + app version). */
  recordedWith: { algorithm: string; app: string };
  createdAt: string;
}

/**
 * Canonical encoding: per frame, int32 seq (LE), float64 t (LE), then for every place in PLACEMENTS order one
 * presence byte and, when present, 6 × int16 (LE). Independent of object key order and of the IndexedDB chunking.
 */
export function encodeFrames(frames: readonly RawFrame[]): Uint8Array {
  let size = 0;
  for (const f of frames) {
    size += 12 + PLACEMENTS.length;
    for (const p of PLACEMENTS) if (f.data[p]) size += 12;
  }
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  for (const f of frames) {
    v.setInt32(o, f.seq, true);
    v.setFloat64(o + 4, f.t, true);
    o += 12;
    for (const p of PLACEMENTS) {
      const d = f.data[p];
      v.setUint8(o++, d ? 1 : 0);
      if (d) for (let k = 0; k < 6; k++, o += 2) v.setInt16(o, d[k] as number, true);
    }
  }
  return new Uint8Array(buf);
}

export function hashFrames(frames: readonly RawFrame[]): string {
  return sha256Hex(encodeFrames(frames));
}

/** Timeline from session events (event t is seconds from the first processed frame = the first stored frame). */
export function timelineFromEvents(events: readonly SessionEvent[], steps: readonly { exercise: string; side: Side }[]): RawTimeline {
  const calDone = [...events].reverse().find((e) => e.kind === 'calibration_done');
  const spans: RawTimeline['steps'] = [];
  const open = new Map<number, number>();
  for (const e of events) {
    if (e.kind === 'step_start' && e.step !== undefined) open.set(e.step, e.t);
    if ((e.kind === 'step_done' || e.kind === 'step_skipped') && e.step !== undefined && open.has(e.step)) {
      const st = steps[e.step];
      if (st) spans.push({ exercise: st.exercise, side: st.side, tStart: open.get(e.step) as number, tEnd: e.t });
      open.delete(e.step);
    }
  }
  return { calibrationEnd: calDone ? calDone.t : null, steps: spans };
}

export function buildManifest(frames: readonly RawFrame[], o: { rateHz: number; sync: SyncModel; accCalibrated: boolean; timeline: RawTimeline; algorithm: string; app: string; now?: Date }): RawManifest | null {
  if (!frames.length) return null;
  const first = frames[0] as RawFrame;
  const last = frames[frames.length - 1] as RawFrame;
  return {
    scheme: RAW_MANIFEST_SCHEME,
    frames: frames.length,
    seqFirst: first.seq,
    seqLast: last.seq,
    tFirst: first.t,
    tLast: last.t,
    placements: PLACEMENTS.filter((p) => frames.some((f) => f.data[p])),
    rateHz: o.rateHz,
    sha256: hashFrames(frames),
    mount: 'COORDINATES.md §2',
    sync: o.sync,
    accCalibrated: o.accCalibrated,
    timeline: o.timeline,
    recordedWith: { algorithm: o.algorithm, app: o.app },
    createdAt: (o.now ?? new Date()).toISOString(),
  };
}

export type ManifestCheck = 'verified' | 'no_manifest' | 'hash_mismatch' | 'frame_count_mismatch' | 'unknown_scheme';

export function verifyManifest(frames: readonly RawFrame[], m: RawManifest | undefined | null): ManifestCheck {
  if (!m) return 'no_manifest';
  if (m.scheme !== RAW_MANIFEST_SCHEME) return 'unknown_scheme';
  if (m.frames !== frames.length) return 'frame_count_mismatch';
  return hashFrames(frames) === m.sha256 ? 'verified' : 'hash_mismatch';
}

export function syncModelFor(kind: string, simulated: boolean): SyncModel {
  if (simulated || kind === 'simulator') return 'simulated';
  if (kind === 'usb') return 'single_tick_sequential_i2c';
  if (kind === 'ble') return 'per_packet_seq_aligned';
  return 'unknown';
}
