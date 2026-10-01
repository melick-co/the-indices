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

/**
 * Parse a JSON reply, tolerating ```json fences, a sentence around the object,
 * and invalid backslash escapes (e.g. "\_T" in an SDMX key).
 */
/** The first complete {...} in text, respecting strings; null if none closes. */
function firstObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function parseJsonReply(text, label = 'claude') {
  const clean = String(text ?? '').replace(/```(?:json)?/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  const object = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  const repaired = object.replace(/\\(?!["\\/bfnrtu])/g, '');
  // Replies that add a second object or a note after the JSON: take the first object.
  const first = firstObject(clean);
  const candidates = [clean, object, repaired];
  if (first) candidates.push(first, first.replace(/\\(?!["\\/bfnrtu])/g, ''));
  let lastError;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (e) { lastError = e; }
  }
  const tail = clean.length > 160 ? ` … ${clean.slice(-80)}` : '';
  throw new Error(`${label}: reply was not valid JSON: ${lastError?.message} (${clean.slice(0, 80)}${tail})`);
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
