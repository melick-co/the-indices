/**
 * One way to ask Claude for JSON, shared by every agent script.
 * Each script used to set its own small max_tokens and JSON.parse the reply
 * blind, so a long verdict was cut off mid-string and the run died on
 * "Unterminated string in JSON". Here a cut-off reply is detected from
 * stop_reason and raised as TruncatedError, so callers can split their batch.
 */

export const MODEL = 'claude-sonnet-4-6';

export class TruncatedError extends Error {
  constructor(label) { super(`${label}: reply hit max_tokens`); this.name = 'TruncatedError'; }
}

/** Parse a JSON reply, tolerating ```json fences or a sentence around the object. */
export function parseJsonReply(text, label = 'claude') {
  const clean = String(text ?? '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(clean); } catch { /* try the outermost object below */ }
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error(`${label}: reply was not valid JSON (${clean.slice(0, 80)}…)`);
}

/**
 * @param {string} prompt
 * @param {{ label?: string, maxTokens?: number, model?: string, timeoutMs?: number, apiKey?: string }} [opts]
 */
export async function callClaudeJson(prompt, opts = {}) {
  const {
    label = 'claude', maxTokens = 16000, model = MODEL, timeoutMs = 600000,
    apiKey = process.env.ANTHROPIC_API_KEY,
  } = opts;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${label}: anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (body.stop_reason === 'max_tokens') throw new TruncatedError(label);
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return parseJsonReply(text, label);
}

/**
 * Run fn over items; if the reply is cut off, split the items in half and retry
 * each half. Results are concatenated. Single items that still truncate throw.
 * @template T, R
 * @param {T[]} items
 * @param {(batch: T[]) => Promise<R[]>} fn
 * @returns {Promise<R[]>}
 */
export async function splitOnTruncation(items, fn) {
  try {
    return await fn(items);
  } catch (e) {
    if (!(e instanceof TruncatedError) || items.length < 2) throw e;
    const mid = Math.ceil(items.length / 2);
    return [
      ...(await splitOnTruncation(items.slice(0, mid), fn)),
      ...(await splitOnTruncation(items.slice(mid), fn)),
    ];
  }
}
