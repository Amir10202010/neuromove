// Repetition workflow of a validation session — pure functions over persisted trials.
//
// There is no hidden in-memory state: where the operator is (set, repetition, measurement point) and
// whether a goniometer value is awaited are DERIVED from the stored trials. Reloading the page, closing
// the browser or switching computers (after sync) therefore resumes exactly where the session stopped.
//
//   capture IMU ──► trial 'pending_reference' ──► operator types goniometer value ──► 'valid'
//        ▲                     │ Repeat measurement → 'superseded' (kept) + new attempt
//        │                     │ Mark invalid       → 'invalid' (kept, counted as invalid)
//        └─────────────────────┘ Skip with reason   → 'skipped' (slot closed without a pair)

import { newId } from '../lib/ids';
import type { ImuCapture, ProtocolDefinition, Slot, Trial, ValidationSession } from './model';
import { slotKey } from './model';
import type { Pair } from './stats';

/** All slots of the protocol in execution order: set → repetition → measurement point. */
export function protocolSlots(p: ProtocolDefinition): Slot[] {
  const out: Slot[] = [];
  for (let set = 1; set <= p.sets; set++)
    for (let repetition = 1; repetition <= p.repetitions; repetition++)
      for (const point of p.measurementPoints) out.push({ set, repetition, pointId: point.id });
  return out;
}

/** A slot is closed by a final trial: valid, invalid or skipped. Superseded attempts never close it. */
const FINAL: ReadonlySet<Trial['status']> = new Set(['valid', 'invalid', 'skipped']);

/** The latest (highest attempt) trial per slot, ignoring superseded attempts. */
export function currentTrials(trials: readonly Trial[]): Map<string, Trial> {
  const out = new Map<string, Trial>();
  for (const t of trials) {
    if (t.status === 'superseded') continue;
    const key = slotKey(t);
    const prev = out.get(key);
    if (!prev || t.attempt > prev.attempt) out.set(key, t);
  }
  return out;
}

export interface Cursor {
  /** Slot being worked on; null when every slot is closed. */
  slot: Slot | null;
  /** 0-based index of `slot` in protocolSlots. */
  index: number;
  total: number;
  /** Trial captured for `slot` and waiting for the goniometer value. */
  pending: Trial | null;
  /** Number of slots closed (valid + invalid + skipped). */
  closed: number;
  complete: boolean;
}

export function cursor(p: ProtocolDefinition, trials: readonly Trial[]): Cursor {
  const slots = protocolSlots(p);
  const cur = currentTrials(trials);
  let closed = 0;
  let first: { slot: Slot; index: number } | null = null;
  slots.forEach((slot, index) => {
    const t = cur.get(slotKey(slot));
    if (t && FINAL.has(t.status)) closed += 1;
    else if (!first) first = { slot, index };
  });
  const f = first as { slot: Slot; index: number } | null;
  const pendingTrial = f ? cur.get(slotKey(f.slot)) : undefined;
  return {
    slot: f?.slot ?? null,
    index: f?.index ?? slots.length,
    total: slots.length,
    pending: pendingTrial && pendingTrial.status === 'pending_reference' ? pendingTrial : null,
    closed,
    complete: f === null,
  };
}

function nextAttempt(trials: readonly Trial[], slot: Slot): number {
  const key = slotKey(slot);
  return trials.filter((t) => slotKey(t) === key).reduce((m, t) => Math.max(m, t.attempt), 0) + 1;
}

const base = (s: ValidationSession, slot: Slot, operator: string, now: Date, attempt: number) => ({
  id: newId('tr'),
  workspace: s.workspace,
  sessionId: s.id,
  participantId: s.participantId,
  set: slot.set,
  repetition: slot.repetition,
  pointId: slot.pointId,
  attempt,
  operator,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  notes: '',
  reason: '',
});

export type WorkflowError = 'not_current_slot' | 'already_pending' | 'not_pending' | 'invalid_reference' | 'reason_required' | 'session_closed';

/** Every action returns the trial records to upsert, in order (one transaction). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: WorkflowError };
const fail = <T>(error: WorkflowError): Result<T> => ({ ok: false, error });

/** Plausible goniometer range: anatomical joint angles in degrees, generous on purpose. */
export const REFERENCE_LIMITS = { min: -180, max: 360 } as const;

export function parseReference(input: string): number | null {
  const v = Number(input.trim().replace(',', '.').replace(/°$/, ''));
  if (!input.trim() || !Number.isFinite(v) || v < REFERENCE_LIMITS.min || v > REFERENCE_LIMITS.max) return null;
  return v;
}

/** IMU value captured for the current slot → new trial awaiting the reference value. */
export function capture(s: ValidationSession, trials: readonly Trial[], imu: ImuCapture, operator: string, now = new Date()): Result<Trial[]> {
  if (s.status !== 'active') return fail('session_closed');
  const c = cursor(s.protocol, trials);
  if (!c.slot) return fail('session_closed');
  if (c.pending) return fail('already_pending');
  return {
    ok: true,
    value: [{ ...base(s, c.slot, operator, now, nextAttempt(trials, c.slot)), status: 'pending_reference', imu, referenceDeg: null, referenceAt: null }],
  };
}

/** Goniometer value for the pending trial → 'valid'. The value is stored exactly as entered. */
export function saveReference(s: ValidationSession, trials: readonly Trial[], trialId: string, referenceDeg: number, notes: string, now = new Date()): Result<Trial[]> {
  const c = cursor(s.protocol, trials);
  if (!c.pending || c.pending.id !== trialId) return fail('not_pending');
  if (!Number.isFinite(referenceDeg) || referenceDeg < REFERENCE_LIMITS.min || referenceDeg > REFERENCE_LIMITS.max) return fail('invalid_reference');
  return { ok: true, value: [{ ...c.pending, status: 'valid', referenceDeg, referenceAt: now.toISOString(), notes, updatedAt: now.toISOString() }] };
}

/** Discard the pending capture and measure again: the old attempt is kept as 'superseded'. */
export function repeatMeasurement(s: ValidationSession, trials: readonly Trial[], reason: string, now = new Date()): Result<Trial[]> {
  const c = cursor(s.protocol, trials);
  if (!c.pending) return fail('not_pending');
  return { ok: true, value: [{ ...c.pending, status: 'superseded', reason: reason || 'repeat', updatedAt: now.toISOString() }] };
}

/** Close the current slot as invalid (kept and counted; excluded from agreement statistics). */
export function markInvalid(s: ValidationSession, trials: readonly Trial[], reason: string, operator: string, now = new Date()): Result<Trial[]> {
  if (!reason.trim()) return fail('reason_required');
  const c = cursor(s.protocol, trials);
  if (!c.slot) return fail('session_closed');
  if (c.pending) return { ok: true, value: [{ ...c.pending, status: 'invalid', reason, updatedAt: now.toISOString() }] };
  return { ok: true, value: [{ ...base(s, c.slot, operator, now, nextAttempt(trials, c.slot)), status: 'invalid', imu: null, referenceDeg: null, referenceAt: null, reason }] };
}

/** Close the current slot without a measurement. A reason is mandatory. */
export function skip(s: ValidationSession, trials: readonly Trial[], reason: string, operator: string, now = new Date()): Result<Trial[]> {
  if (!reason.trim()) return fail('reason_required');
  const c = cursor(s.protocol, trials);
  if (!c.slot) return fail('session_closed');
  // A capture already taken for this slot is kept (superseded), the slot is closed by the skip record
  const prev: Trial | null = c.pending ? { ...c.pending, status: 'superseded', reason: 'skipped after capture', updatedAt: now.toISOString() } : null;
  const t: Trial = { ...base(s, c.slot, operator, now, nextAttempt(trials, c.slot)), status: 'skipped', imu: null, referenceDeg: null, referenceAt: null, reason };
  return { ok: true, value: prev ? [prev, t] : [t] };
}

/**
 * Correct an already-closed trial (review of a previous repetition). Produces a NEW attempt that
 * supersedes the old one, so the original value stays in the audit trail.
 */
export function correctTrial(trials: readonly Trial[], trialId: string, patch: { referenceDeg?: number; status?: 'valid' | 'invalid'; reason?: string; notes?: string }, operator: string, now = new Date()): Result<Trial[]> {
  const old = trials.find((t) => t.id === trialId);
  if (!old || old.status === 'superseded' || old.status === 'pending_reference') return fail('not_pending');
  if (patch.referenceDeg !== undefined && (!Number.isFinite(patch.referenceDeg) || patch.referenceDeg < REFERENCE_LIMITS.min || patch.referenceDeg > REFERENCE_LIMITS.max)) return fail('invalid_reference');
  const status = patch.status ?? old.status;
  if (status === 'invalid' && !(patch.reason ?? old.reason).trim()) return fail('reason_required');
  if (status === 'valid' && (old.imu === null || (patch.referenceDeg ?? old.referenceDeg) === null)) return fail('invalid_reference');
  const replacement: Trial = {
    ...old,
    id: newId('tr'),
    attempt: nextAttempt(trials, old),
    status,
    referenceDeg: patch.referenceDeg ?? old.referenceDeg,
    referenceAt: patch.referenceDeg !== undefined ? now.toISOString() : old.referenceAt,
    reason: patch.reason ?? old.reason,
    notes: patch.notes ?? old.notes,
    operator,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return { ok: true, value: [{ ...old, status: 'superseded', reason: `corrected by ${replacement.id}`, updatedAt: now.toISOString() }, replacement] };
}

// ── Counts and pairs for statistics ───────────────────────────────────────────────────────────────

export interface TrialCounts {
  slots: number;
  valid: number;
  invalid: number;
  skipped: number;
  pending: number;
  /** Slots with no final trial yet (includes pending). */
  missing: number;
  superseded: number;
}

export function counts(p: ProtocolDefinition, trials: readonly Trial[]): TrialCounts {
  const cur = [...currentTrials(trials).values()];
  const slots = protocolSlots(p).length;
  const by = (st: Trial['status']) => cur.filter((t) => t.status === st).length;
  const valid = by('valid');
  const invalid = by('invalid');
  const skipped = by('skipped');
  return { slots, valid, invalid, skipped, pending: by('pending_reference'), missing: slots - valid - invalid - skipped, superseded: trials.filter((t) => t.status === 'superseded').length };
}

/** Valid trials as statistics pairs, in protocol order. Optional filter by measurement point. */
export function validPairs(trials: readonly Trial[], pointId?: string): (Pair & { trial: Trial })[] {
  return [...currentTrials(trials).values()]
    .filter((t) => t.status === 'valid' && t.imu && t.referenceDeg !== null && (!pointId || t.pointId === pointId))
    .sort((a, b) => a.set - b.set || a.repetition - b.repetition || a.pointId.localeCompare(b.pointId))
    .map((t) => ({ imu: (t.imu as ImuCapture).angleDeg, ref: t.referenceDeg as number, subject: t.participantId, id: t.id, trial: t }));
}
