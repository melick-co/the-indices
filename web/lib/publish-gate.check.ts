import assert from 'node:assert/strict';
import {
  canonicalJson, claimsOf, gateIssues, gateMessage, isGateError, passedStrict, sameClaims, stampFields,
} from './publish-gate';
import { sanitiseEvidence } from './desk-evidence';

// Fail closed: only a check that passed with the claim audit run counts.
assert.ok(passedStrict({ ok: true, issues: [], audited: true }));
assert.ok(!passedStrict({ ok: true, issues: [] }), 'a check without the audit flag is not a pass');
assert.ok(!passedStrict({ ok: true, issues: [], audited: false }), 'audit skipped (no ANTHROPIC_API_KEY) is not a pass');
assert.ok(!passedStrict({ ok: false, issues: ['x'], audited: true }));
assert.ok(!passedStrict({ ok: true, issues: [], audited: true, stale: true }), 'edited since the check');
assert.ok(!passedStrict(null));
assert.match(gateIssues({ ok: true, issues: [], audited: false })[0], /ANTHROPIC_API_KEY/);
assert.deepEqual(gateIssues({ ok: false, issues: ['style: lede too long'], audited: true }), ['style: lede too long']);

// The highlight panel is not a claim; key order and undefined fields do not change the claims.
const story = {
  title: 'T', kicker: 'K', hook: 'H', caveat: 'C', one_number: { value: '4%', label: 'L' },
  body: { blocks: [{ type: 'paragraph', text: 'p' }], highlights: { items: [1] } },
  evidence: { sources: [], footnotes: [{ n: 1, text: 'ABS', url: 'https://abs.gov.au' }] },
  hero_image_url: 'a.png', home_section: null,
};
assert.equal((claimsOf(story).body as Record<string, unknown>).highlights, undefined);
assert.ok(sameClaims(story, { ...story, body: { blocks: story.body.blocks }, hero_image_url: 'b.png', art: [] }));
assert.ok(sameClaims(story, { ...story, one_number: { label: 'L', value: '4%', metric_id: undefined } }));
assert.ok(!sameClaims(story, { ...story, one_number: { value: '5%', label: 'L' } }));
assert.ok(!sameClaims(story, { ...story, evidence: { sources: [] } }), 'dropping footnotes changes the claims');
assert.equal(canonicalJson({ b: 1, a: [1, { d: undefined, c: 2 }] }), '{"a":[1,{"c":2}],"b":1}');

// The trigger's refusal is recognised and passed on in its own words.
assert.ok(isGateError({ code: 'CV001', message: 'x' }));
assert.ok(isGateError({ message: 'publish gate: this story has not passed the strict check for its current content (/stories/a)' }));
assert.ok(!isGateError({ code: '23505', message: 'duplicate key' }));
assert.match(gateMessage({ code: 'CV001', message: 'publish gate: no' }), /^publish gate: no.*nothing was published/);

// Stamping: only content that passed is stamped, with the hash Postgres computes; an override needs a reason.
type Call = { fn: string; args: unknown };
function fakeDb(reply: { data?: unknown; error?: { code?: string; message: string } }) {
  const calls: Call[] = [];
  const db = { rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return { data: reply.data ?? null, error: reply.error ?? null }; } };
  return { db: db as never, calls };
}

async function stamping() {
  const ok = fakeDb({ data: 'abc123' });
  const stamp = await stampFields(ok.db, story, { ok: true, issues: [], audited: true });
  assert.equal(stamp.check_hash, 'abc123');
  assert.equal(stamp.check_override, null);
  assert.equal(ok.calls[0].fn, 'claim_hash_of');
  assert.equal(((ok.calls[0].args as { p: { body: Record<string, unknown> } }).p.body).highlights, undefined, 'hashes the claims only');

  const skipped = fakeDb({ data: 'abc123' });
  assert.deepEqual(await stampFields(skipped.db, story, { ok: true, issues: [] }), {}, 'audit skipped: no stamp');
  assert.deepEqual(await stampFields(skipped.db, story, { ok: false, issues: ['x'], audited: true }), {}, 'failed: no stamp');
  assert.deepEqual(await stampFields(skipped.db, story, { ok: false, issues: ['x'], audited: true }, '   '), {}, 'blank reason is no override');
  assert.equal(skipped.calls.length, 0);

  const forced = fakeDb({ data: 'def456' });
  const over = await stampFields(forced.db, story, { ok: false, issues: ['x'], audited: true }, 'Editor verified the figure by phone');
  assert.equal(over.check_hash, 'def456');
  assert.equal(over.check_override, 'Editor verified the figure by phone');

  // Before 45_publish_gate.sql runs there is no hash: nothing to stamp, and nothing breaks.
  const missing = fakeDb({ error: { code: 'PGRST202', message: 'Could not find the function public.claim_hash_of(p)' } });
  assert.deepEqual(await stampFields(missing.db, story, { ok: true, issues: [], audited: true }), {});
  const broken = fakeDb({ error: { code: '500', message: 'network' } });
  assert.deepEqual(await stampFields(broken.db, story, { ok: true, issues: [], audited: true }), {}, 'no hash, no stamp');
}

// A desk save keeps footnotes and quoted metric ids the payload does not carry.
const stored = { sources: [], footnotes: [{ n: 1, text: 'ABS CPI', url: 'https://abs.gov.au/cpi' }], metric_ids: ['cpi_headline'] };
const saved = sanitiseEvidence({ sources: [{ metric: ' CPI ', org: 'ABS', tier: 1, url: '', period: '', basis: '' }] }, stored);
assert.deepEqual(saved.footnotes, stored.footnotes);
assert.deepEqual(saved.metric_ids, ['cpi_headline']);
assert.equal(saved.sources[0].metric, 'CPI');
const edited = sanitiseEvidence({ sources: [], footnotes: [] }, stored);
assert.deepEqual(edited.footnotes, [], 'footnotes the payload carries win');
assert.equal(sanitiseEvidence({ sources: [] }).footnotes, undefined);

stamping().then(() => console.log('publish-gate.check: ok'), (e) => { console.error(e); process.exit(1); });
