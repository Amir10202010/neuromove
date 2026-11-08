// Caregiver accounts (family access), client side: thin API calls to /api/team/caregivers (admin only on
// the server) and pure helpers. The server decides everything that matters: who may link, which
// children exist in the team, that a staff account is never turned into a caregiver account.

import type { Transport } from '../sync/engine';

export interface CaregiverLinkRow {
  id: string;
  email: string;
  display_name: string;
  participant_id: string;
  created_at: string;
  revoked_at: string | null;
}

export interface CaregiverAccount {
  userId: string;
  email: string;
  displayName: string;
  /** Children this account can currently see. */
  active: string[];
  /** Children whose link was revoked (kept for the record, never deleted). */
  revoked: string[];
}

export function groupLinks(rows: readonly CaregiverLinkRow[]): CaregiverAccount[] {
  const by = new Map<string, CaregiverAccount>();
  for (const r of rows) {
    const a = by.get(r.id) ?? { userId: r.id, email: r.email, displayName: r.display_name, active: [], revoked: [] };
    (r.revoked_at ? a.revoked : a.active).push(r.participant_id);
    by.set(r.id, a);
  }
  return [...by.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export type CaregiverError = 'admin_only' | 'invalid_input' | 'unknown_participant' | 'account_is_staff' | 'password_required' | 'password_too_short' | 'password_too_long' | 'network' | 'unavailable' | string;

export async function listCaregivers(transport: Transport): Promise<{ ok: true; accounts: CaregiverAccount[] } | { ok: false; error: CaregiverError }> {
  try {
    const r = await transport('/api/team/caregivers');
    if (r.status === 200) return { ok: true, accounts: groupLinks((r.json as { links: CaregiverLinkRow[] }).links) };
    return { ok: false, error: r.status === 503 ? 'unavailable' : ((r.json as { error?: string } | null)?.error ?? `HTTP ${r.status}`) };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function linkCaregiver(
  transport: Transport,
  body: { email: string; displayName: string; password?: string; participantIds: string[]; revoke?: boolean },
): Promise<{ ok: true } | { ok: false; error: CaregiverError }> {
  try {
    const r = await transport('/api/team/caregivers', { method: 'POST', body });
    if (r.status === 200) return { ok: true };
    return { ok: false, error: (r.json as { error?: string } | null)?.error ?? `HTTP ${r.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** A readable one-time password for a family (shown once to the admin; never stored by the browser). */
export function suggestPassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = random(15);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}-${chars.slice(10, 15).join('')}`;
}
