// Optional AI-drafted summaries (POST /api/ai/summary) via the Google Gemini API.
// OFF unless the operator sets BOTH:
//   GEMINI_API_KEYS=key1,key2,key3   (one or more keys, comma-separated)
//   NEUROMOVE_AI_SUMMARIES=1         (explicit opt-in: pseudonymous facts are sent to Google)
// Optional: GEMINI_MODEL (default below).
//
// Keys are used in turn: every request takes the NEXT key (round robin). If a key is rate-limited or
// rejected, the same request moves on to the following key; each key is tried at most once.
// Note: on serverless hosting every running instance keeps its own counter.
//
// The request carries only the numbered facts built on the device (src/rehab/summary.ts): no names,
// no participant code, no free text unless the professional included goal wording. The response is
// checked (citations, wording) before it is returned, and the server stores nothing but an audit count.

import { checkDraft, factsPrompt, SUMMARY_SECTIONS, systemPrompt, validDraft, type CheckedDraft, type Fact, type SummaryLanguage } from '../src/rehab/summary';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export type FactsPayload = Pick<Fact, 'id' | 'section' | 'source' | 'text'>[];

export interface DraftResult {
  draft: CheckedDraft;
  model: string;
  /** Which key answered, as a position in the list (never the key itself), for the audit log. */
  keyIndex: number;
}

/** fetch is injectable so tests never reach the network. */
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export function geminiKeys(env: Record<string, string | undefined>): string[] {
  return (env.GEMINI_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function aiEnabled(env: Record<string, string | undefined>): boolean {
  return env.NEUROMOVE_AI_SUMMARIES === '1' && geminiKeys(env).length > 0;
}

let counter = 0;
/** Index of the key for the next request (round robin). */
export function nextKeyIndex(count: number): number {
  const i = counter % count;
  counter = (counter + 1) % 1_000_000;
  return i;
}
export function resetKeyRotation(): void {
  counter = 0;
}

export class DraftError extends Error {}

/** Gemini's response schema (OpenAPI subset): sections → sentences with cited fact ids. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['sections'],
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['section', 'sentences'],
        properties: {
          section: { type: 'STRING', enum: [...SUMMARY_SECTIONS] },
          sentences: {
            type: 'ARRAY',
            items: { type: 'OBJECT', required: ['text', 'facts'], properties: { text: { type: 'STRING' }, facts: { type: 'ARRAY', items: { type: 'STRING' } } } },
          },
        },
      },
    },
  },
};

/** Statuses after which the same request is retried with the next key. */
const TRY_NEXT_KEY = new Set([401, 403, 429, 500, 502, 503, 504]);

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

export async function draftSummary(fetchFn: FetchFn, keys: readonly string[], facts: FactsPayload, language: SummaryLanguage, model = DEFAULT_GEMINI_MODEL): Promise<DraftResult> {
  if (!keys.length) throw new DraftError('not_configured');
  const start = nextKeyIndex(keys.length);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(language) }] },
    contents: [{ role: 'user', parts: [{ text: factsPrompt(facts) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2, maxOutputTokens: 4096 },
  });
  let lastStatus = 0;
  for (let n = 0; n < keys.length; n++) {
    const keyIndex = (start + n) % keys.length;
    // The key goes in a header, never in the URL (URLs end up in logs)
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[keyIndex] as string },
      body,
    });
    if (TRY_NEXT_KEY.has(res.status)) {
      lastStatus = res.status;
      continue;
    }
    if (res.status !== 200) throw new DraftError(`http_${res.status}`);
    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) throw new DraftError('refused');
    const cand = data.candidates?.[0];
    if (!cand) throw new DraftError('empty');
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT' || cand.finishReason === 'BLOCKLIST') throw new DraftError('refused');
    if (cand.finishReason === 'MAX_TOKENS') throw new DraftError('truncated');
    const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DraftError('invalid_output');
    }
    if (!validDraft(parsed)) throw new DraftError('invalid_output');
    return { draft: checkDraft(parsed, facts), model: data.modelVersion ?? model, keyIndex };
  }
  throw new DraftError(lastStatus === 429 ? 'all_keys_rate_limited' : 'all_keys_failed');
}
