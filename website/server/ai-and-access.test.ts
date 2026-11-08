// Optional AI summaries (/api/ai/summary, Google Gemini) and the family-access client against the real
// API handler. Gemini is a fake fetch: no network, no real keys. What is checked is NeuroMove's contract.

import { beforeEach, describe, expect, it } from 'vitest';
import { linkCaregiver, listCaregivers } from '../src/rehab/caregivers';
import type { PushResponse } from '../src/sync/types';
import { geminiKeys, resetKeyRotation, type FetchFn } from './ai';
import { handle } from './http';
import { testApi } from './testing';

const SETUP = 'test-setup-code-123';
const facts = [
  { id: 'F1', section: 'practice', source: 'reported', text: 'Home practice reports in the last 28 days: 4 (done 3, partly 0, not done 0, stopped 1); planned by the professional: 6.' },
  { id: 'F2', section: 'measurements', source: 'imu', text: 'elbow_flexion right: latest measured range 95° (3 days ago), from 2 usable sessions. IMU measurement, not clinically validated.' },
];

interface Call {
  url: string;
  key: string;
  body: Record<string, unknown>;
}

/** Fake Gemini: answers `reply` as JSON text; `statusFor(key)` lets a key fail (e.g. 429). */
function fakeGemini(reply: unknown, opts: { statusFor?: (key: string) => number; finishReason?: string; blockReason?: string } = {}) {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const key = init.headers['x-goog-api-key'] as string;
    calls.push({ url, key, body: JSON.parse(init.body) as Record<string, unknown> });
    const status = opts.statusFor?.(key) ?? 200;
    return {
      status,
      json: async () => ({
        modelVersion: 'gemini-test',
        ...(opts.blockReason ? { promptFeedback: { blockReason: opts.blockReason } } : {}),
        candidates: [{ finishReason: opts.finishReason ?? 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }],
      }),
    };
  };
  return { fetchFn, calls };
}

async function setup(env: Record<string, string>, aiFetch?: FetchFn) {
  const api = await testApi({ NEUROMOVE_SETUP_CODE: SETUP, ...env });
  if (aiFetch) api.deps.aiFetch = aiFetch;
  const admin = api.client();
  expect((await admin('/api/auth/bootstrap', { body: { setupCode: SETUP, teamName: 'Clinic', email: 'dr@c.org', password: 'correct horse battery', displayName: 'Dr A' } })).status).toBe(200);
  return { api, admin };
}

const ON = { GEMINI_API_KEYS: 'key-a, key-b ,key-c', NEUROMOVE_AI_SUMMARIES: '1' };
const okReply = { sections: [{ section: 'practice', sentences: [{ text: 'Three of four reported sessions were done; one was stopped.', facts: ['F1'] }] }] };

beforeEach(() => resetKeyRotation());

describe('AI summaries (Gemini) are optional, staff-only and grounded', () => {
  it('keys are read from GEMINI_API_KEYS, comma-separated, spaces and empty items ignored', () => {
    expect(geminiKeys({ GEMINI_API_KEYS: ' a ,b,, c ' })).toEqual(['a', 'b', 'c']);
    expect(geminiKeys({})).toEqual([]);
  });

  it('off unless the operator opts in AND at least one key exists; health says so', async () => {
    const { admin } = await setup({});
    expect((await admin('/api/health')).json).toMatchObject({ aiSummaries: 'disabled' });
    expect((await admin('/api/ai/summary', { body: { facts, language: 'ru' } })).json).toEqual({ error: 'ai_not_configured' });
    const keysOnly = await setup({ GEMINI_API_KEYS: 'k1' });
    expect((await keysOnly.admin('/api/ai/summary', { body: { facts, language: 'ru' } })).json).toEqual({ error: 'ai_not_configured' });
  });

  it('every request uses the NEXT key in turn; the key travels in a header, never in the URL', async () => {
    const g = fakeGemini(okReply);
    const { admin } = await setup(ON, g.fetchFn);
    expect((await admin('/api/health')).json).toMatchObject({ aiSummaries: 'enabled' });
    for (let i = 0; i < 4; i++) expect((await admin('/api/ai/summary', { body: { facts, language: 'ru' } })).status).toBe(200);
    expect(g.calls.map((c) => c.key)).toEqual(['key-a', 'key-b', 'key-c', 'key-a']);
    for (const c of g.calls) {
      expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(c.url).not.toContain('key');
    }
  });

  it('a rate-limited or rejected key is skipped for that request; the rotation continues', async () => {
    const g = fakeGemini(okReply, { statusFor: (k) => (k === 'key-a' ? 429 : 200) });
    const { admin } = await setup(ON, g.fetchFn);
    expect((await admin('/api/ai/summary', { body: { facts, language: 'en' } })).status).toBe(200);
    expect(g.calls.map((c) => c.key)).toEqual(['key-a', 'key-b']);
    expect((await admin('/api/ai/summary', { body: { facts, language: 'en' } })).status).toBe(200);
    expect(g.calls.map((c) => c.key).slice(2)).toEqual(['key-b']);
    const allLimited = await setup(ON, fakeGemini(okReply, { statusFor: () => 429 }).fetchFn);
    expect((await allLimited.admin('/api/ai/summary', { body: { facts, language: 'en' } })).json).toEqual({ error: 'ai_all_keys_rate_limited' });
  });

  it('sends only the facts and the instructions; checks citations; audits counts and key position, never keys or content', async () => {
    const reply = { sections: [{ section: 'practice', sentences: [{ text: 'Three of four reported sessions were done; one was stopped.', facts: ['F1'] }, { text: 'Range improved.', facts: ['F2'] }, { text: 'Invented.', facts: ['F7'] }] }] };
    const g = fakeGemini(reply);
    const { api, admin } = await setup({ ...ON, GEMINI_MODEL: 'gemini-custom' }, g.fetchFn);
    const r = await admin('/api/ai/summary', { body: { facts, language: 'kk' } });
    expect(r.status).toBe(200);
    const body = r.json as { draft: { sections: { sentences: { flags: string[] }[] }[]; flagged: number }; model: string; keyIndex: number };
    expect(body.draft.sections[0]!.sentences.map((s) => s.flags)).toEqual([[], ['wording'], ['unknown_fact']]);
    expect(body.model).toBe('gemini-test');
    const sent = g.calls[0]!;
    expect(sent.url).toContain('/models/gemini-custom:generateContent');
    expect(JSON.stringify(sent.body.systemInstruction)).toMatch(/Kazakh/);
    expect(JSON.stringify(sent.body.systemInstruction)).toMatch(/Do not diagnose/);
    expect(JSON.stringify(sent.body.contents)).toContain('F1 [practice; source: reported]');
    expect((sent.body.generationConfig as { responseMimeType: string }).responseMimeType).toBe('application/json');
    const audit = await api.db.query<{ details: Record<string, unknown> }>("select details from nm_audit_events where action = 'ai_summary'");
    expect(audit[0]!.details).toEqual({ facts: 2, model: 'gemini-test', keyIndex: 0, flagged: 2 });
    expect(JSON.stringify(audit)).not.toMatch(/key-a|Three of four/);
  });

  it('blocked, truncated and malformed answers never become a draft; bad input is rejected', async () => {
    const blocked = await setup(ON, fakeGemini(okReply, { blockReason: 'SAFETY' }).fetchFn);
    expect((await blocked.admin('/api/ai/summary', { body: { facts, language: 'en' } })).json).toEqual({ error: 'ai_refused' });
    const truncated = await setup(ON, fakeGemini(okReply, { finishReason: 'MAX_TOKENS' }).fetchFn);
    expect((await truncated.admin('/api/ai/summary', { body: { facts, language: 'en' } })).json).toEqual({ error: 'ai_truncated' });
    const bad = await setup(ON, fakeGemini({ nope: true }).fetchFn);
    expect((await bad.admin('/api/ai/summary', { body: { facts, language: 'en' } })).json).toEqual({ error: 'ai_invalid_output' });
    expect((await bad.admin('/api/ai/summary', { body: { facts: [{ id: 'X', section: 'practice', source: 'reported', text: 'x' }], language: 'en' } })).json).toEqual({ error: 'invalid_input' });
    expect((await bad.admin('/api/ai/summary', { body: { facts, language: 'de' } })).json).toEqual({ error: 'invalid_input' });
  });

  it('caregivers and observers cannot request drafts', async () => {
    const { api, admin } = await setup(ON, fakeGemini(okReply).fetchFn);
    const pushed = (await admin('/api/sync/push', { body: { deviceId: 'd', ops: [{ opId: 'o1', entity: 'participant', entityId: 'p1', baseRev: null, deleted: false, payload: { id: 'p1', workspace: 'clinic', code: 'P01', birthYear: 2016, cpForm: 'other', gmfcs: null, macs: null, affectedSide: 'right', status: 'active', courseStart: null, createdAt: '2026-11-08T10:00:00.000Z', goals: [], nextVisit: null, nextProtocol: null } }] } })).json as PushResponse;
    expect(pushed.results[0]!.status).toBe('applied');
    await admin('/api/team/caregivers', { body: { email: 'mom@f.kz', displayName: 'Mother', password: 'family password 1', participantIds: ['p1'] } });
    await admin('/api/team/members', { body: { email: 'obs@c.org', displayName: 'Obs', password: 'observer password', role: 'observer' } });
    for (const [email, pw] of [['mom@f.kz', 'family password 1'], ['obs@c.org', 'observer password']]) {
      const c = api.client();
      await c('/api/auth/login', { body: { email, password: pw } });
      expect((await c('/api/ai/summary', { body: { facts, language: 'en' } })).status).toBe(403);
    }
  });
});

describe('family access client ⇄ server', () => {
  it('lists, links (new account with password), links more children, revokes — admin only', async () => {
    const { api, admin } = await setup({});
    let cookie = '';
    const transport = async (path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      const res = await handle(new Request(`https://app.test${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json', 'x-neuromove': '1' } : {}) }, ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}) }), api.deps);
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0]!;
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    await transport('/api/auth/login', { method: 'POST', body: { email: 'dr@c.org', password: 'correct horse battery' } });
    const mk = (id: string) => ({ opId: `o-${id}`, entity: 'participant', entityId: id, baseRev: null, deleted: false, payload: { id, workspace: 'clinic', code: id.toUpperCase(), birthYear: 2016, cpForm: 'other', gmfcs: null, macs: null, affectedSide: 'right', status: 'active', courseStart: null, createdAt: '2026-11-08T10:00:00.000Z', goals: [], nextVisit: null, nextProtocol: null } });
    await admin('/api/sync/push', { body: { deviceId: 'd', ops: [mk('p1'), mk('p2')] } });

    expect(await listCaregivers(transport)).toEqual({ ok: true, accounts: [] });
    expect(await linkCaregiver(transport, { email: 'mom@f.kz', displayName: 'Mother', participantIds: ['p1'] })).toEqual({ ok: false, error: 'password_required' });
    expect(await linkCaregiver(transport, { email: 'mom@f.kz', displayName: 'Mother', password: 'abcde-fghjk-mnpqr', participantIds: ['p1'] })).toEqual({ ok: true });
    expect(await linkCaregiver(transport, { email: 'mom@f.kz', displayName: 'Mother', participantIds: ['p2'] })).toEqual({ ok: true });
    expect(await linkCaregiver(transport, { email: 'mom@f.kz', displayName: 'Mother', participantIds: ['p2'], revoke: true })).toEqual({ ok: true });
    const list = await listCaregivers(transport);
    expect(list).toMatchObject({ ok: true, accounts: [{ email: 'mom@f.kz', active: ['p1'], revoked: ['p2'] }] });

    // The family account itself cannot manage access
    const mom = api.client();
    await mom('/api/auth/login', { body: { email: 'mom@f.kz', password: 'abcde-fghjk-mnpqr' } });
    expect((await mom('/api/team/caregivers')).status).toBe(403);
    expect(((await mom('/api/auth/me')).json as { account: { participantIds: string[] } }).account.participantIds).toEqual(['p1']);
  });
});
