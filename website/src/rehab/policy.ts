// Who may do what with rehab records. ONE policy for the device (store.ts) and the server (server/sync.ts):
// the server never trusts the device, the device refuses early so nobody sees a "saved" that the server
// would reject.
//
// Roles are the existing team roles plus 'caregiver':
//   admin, session_operator  → rehabilitation professionals (own goals, programs, reviews, assessments)
//   measurement_operator     → records measurements and technical incidents, no clinical decisions
//   observer                 → read-only
//   caregiver                → only the participants they are linked to; reports practice, observations,
//                              discomfort and family input on goals; reads instructions and approved summaries

import type { RehabRecord } from './model';
import { canonicalJson } from './validate';

export const TEAM_ROLES = ['admin', 'session_operator', 'measurement_operator', 'observer', 'caregiver'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const isProfessional = (r: TeamRole) => r === 'admin' || r === 'session_operator';

export interface Actor {
  role: TeamRole;
  /** Display name stored in createdBy. */
  name: string;
  /** For caregivers: the participants they are linked to. Ignored for other roles. */
  participantIds: readonly string[];
}

export type Denial = 'read_only_role' | 'not_linked' | 'professional_only' | 'caregiver_scope' | 'author_role_mismatch' | null;

/**
 * May `actor` write `next` (replacing `prev`, if any)? Structural validity and historical integrity are
 * checked separately (validate.ts); this is authorisation only.
 */
export function canWriteRehab(actor: Pick<Actor, 'role' | 'participantIds'>, next: RehabRecord, prev: RehabRecord | null): Denial {
  const { role } = actor;
  if (role === 'observer') return 'read_only_role';
  if (isProfessional(role)) {
    // Caregiver-authored reports may be uploaded by a staff account: on a shared clinic tablet the family
    // view runs under the device owner's account. Provenance stays in the server audit log (uploading
    // account + device), and reports are immutable, so a staff account cannot alter what a family wrote.
    if (!prev && next.createdByRole === 'caregiver' && next.kind !== 'practice' && next.kind !== 'incident') return 'author_role_mismatch';
    return null;
  }
  if (role === 'measurement_operator') {
    if (next.kind === 'practice' && next.source === 'professional_entry' && !prev) return null;
    if (next.kind === 'incident' && next.category === 'technical' && !prev) return null;
    return 'professional_only';
  }
  // caregiver
  if (!next.participantId || !actor.participantIds.includes(next.participantId)) return 'not_linked';
  if (next.kind === 'practice') {
    if (prev) return 'caregiver_scope';
    if (next.createdByRole !== 'caregiver' || (next.source !== 'caregiver_report' && next.source !== 'child_mode') || next.sensorSessionId !== null) return 'caregiver_scope';
    return null;
  }
  if (next.kind === 'incident') {
    if (prev) return 'caregiver_scope'; // reviewing an incident is a professional act
    if (next.createdByRole !== 'caregiver' || next.category !== 'safety' || next.review !== null) return 'caregiver_scope';
    return null;
  }
  if (next.kind === 'goal' && prev && prev.kind === 'goal') {
    // Families contribute to goal definition through 'family_input' entries; they never change status,
    // targets or anything a professional wrote.
    const added = next.history.slice(prev.history.length);
    const { history: _h1, updatedAt: _u1, contributors: _c1, ...a } = prev;
    const { history: _h2, updatedAt: _u2, contributors: _c2, ...b } = next;
    if (added.length !== 1 || added[0]?.type !== 'family_input' || added[0]?.byRole !== 'caregiver') return 'caregiver_scope';
    if (canonicalJson(a) !== canonicalJson(b)) return 'caregiver_scope';
    return null;
  }
  return 'professional_only';
}

/** Kinds a caregiver may read for a linked participant (server pull filter and the family screens). */
export function caregiverMayRead(r: RehabRecord, linked: readonly string[]): boolean {
  switch (r.kind) {
    case 'activity':
      // Library items carry no child data; drafts stay with professionals
      return r.status !== 'draft';
    case 'profile':
    case 'goal':
    case 'program':
    case 'practice':
      return !!r.participantId && linked.includes(r.participantId) && !(r.kind === 'program' && r.template);
    case 'incident':
      return linked.includes(r.participantId) && r.createdByRole === 'caregiver';
    default:
      // reviews, assessments, studies, consent: professional / research records
      return false;
  }
}
