// Authentication: email + password (scrypt), opaque session token in an HttpOnly cookie.
// Only the SHA-256 of a token is stored. Authorization is ALWAYS derived from the session row on the
// server (team + role); a team id sent by the client is never trusted.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

import { TEAM_ROLES, type TeamRole } from '../src/rehab/policy';

export type Role = TeamRole;
export const ROLES: readonly Role[] = TEAM_ROLES;

export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  teamId: string;
  teamName: string;
  role: Role;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_DAYS = 30;
export const COOKIE = 'nm_session';

function scrypt(password: string, salt: Buffer, o = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'password_too_short';
  if (password.length > 200) return 'password_too_long';
  return null;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

export async function createSession(db: Db, userId: string, teamId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.query('insert into nm_auth_sessions (token_hash, user_id, team_id, expires_at) values ($1, $2, $3, $4)', [sha256(token), userId, teamId, expires.toISOString()]);
  return { token, expires };
}

export async function principalFromToken(db: Db, token: string | null): Promise<Principal | null> {
  if (!token) return null;
  const rows = await db.query<{ user_id: string; email: string; display_name: string; team_id: string; team_name: string; role: Role }>(
    `select u.id as user_id, u.email, u.display_name, t.id as team_id, t.name as team_name, m.role
       from nm_auth_sessions s
       join nm_users u on u.id = s.user_id and u.disabled_at is null
       join nm_memberships m on m.user_id = s.user_id and m.team_id = s.team_id
       join nm_teams t on t.id = s.team_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
    [sha256(token)],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, email: r.email, displayName: r.display_name, teamId: r.team_id, teamName: r.team_name, role: r.role } : null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.query('update nm_auth_sessions set revoked_at = now() where token_hash = $1', [sha256(token)]);
}

export function readCookie(header: string | null, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token: string, expires: Date, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

/**
 * Who may write which entity at all. Observers are read-only; measurement operators record trials and
 * (within rehab records) measurement entries; caregivers write rehab records only. The per-record rules
 * (linked child, report kinds) are in src/rehab/policy.ts and checked by the rehab_record handler.
 */
export function canWrite(role: Role, entity: string): boolean {
  if (role === 'observer') return false;
  // Caregivers: rehab records, and lab practice-trial sets of their linked child (checked in the lab handler)
  if (role === 'caregiver') return entity === 'rehab_record' || entity === 'lab_record';
  if (role === 'measurement_operator') return entity === 'trial' || entity === 'validation_session' || entity === 'rehab_record' || entity === 'lab_record';
  return true;
}

/** Participants a caregiver account is linked to (never trusted from the client). */
export async function linkedParticipants(db: Db, p: Principal): Promise<string[]> {
  if (p.role !== 'caregiver') return [];
  const rows = await db.query<{ participant_id: string }>('select participant_id from nm_caregiver_links where team_id = $1 and user_id = $2 and revoked_at is null', [p.teamId, p.userId]);
  return rows.map((r) => r.participant_id);
}
