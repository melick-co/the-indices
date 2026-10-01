import assert from 'node:assert/strict';
import { TruncatedError, callClaudeJson, parseJsonReply, splitOnTruncation } from './claude.mjs';

// Replies come back fenced, bare, or with a sentence around the object.
assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
assert.deepEqual(parseJsonReply('Here is the verdict:\n{"a":{"b":2}}\nDone.'), { a: { b: 2 } });
assert.throws(() => parseJsonReply('{"a":"cut off', 'taste verdict'), /taste verdict: reply was not valid JSON/);

const reply = (body, ok = true, status = 200) => async () => ({
  ok, status, json: async () => body, text: async () => JSON.stringify(body),
});

// A reply that hit max_tokens is a TruncatedError, never a JSON parse attempt.
globalThis.fetch = reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"decisions":[{"x":"unterm' }] });
await assert.rejects(callClaudeJson('p', { label: 'rss verdict' }), (e) => e instanceof TruncatedError && /rss verdict/.test(e.message));

globalThis.fetch = reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }] });
assert.deepEqual(await callClaudeJson('p'), { ok: true });

globalThis.fetch = reply({ error: 'overloaded' }, false, 529);
await assert.rejects(callClaudeJson('p', { label: 'trend verdict' }), /trend verdict: anthropic 529/);

// splitOnTruncation halves until each batch fits, keeping order.
const seen = [];
const out = await splitOnTruncation([1, 2, 3, 4, 5], async (batch) => {
  seen.push(batch.length);
  if (batch.length > 2) throw new TruncatedError('t');
  return batch.map((n) => n * 10);
});
assert.deepEqual(out, [10, 20, 30, 40, 50]);
assert.deepEqual(seen, [5, 3, 2, 1, 2]);
// Other errors pass straight through, and a single item that still truncates throws.
await assert.rejects(splitOnTruncation([1, 2], async () => { throw new Error('boom'); }), /boom/);
await assert.rejects(splitOnTruncation([1], async () => { throw new TruncatedError('t'); }), TruncatedError);

console.log('claude.check: ok');
