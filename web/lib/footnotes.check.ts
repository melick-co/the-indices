import assert from 'node:assert/strict';
import { mergeDuplicateFootnotes } from './footnotes';

const story = {
  hook: 'Deck.[^9]',
  caveat: 'Caveat.',
  body: { blocks: [
    { type: 'paragraph', text: 'A.[^2] B.[^9] C.[^5][^10]' },
    { type: 'timeline', events: [{ date: 'Oct', label: 'FSR out.[^9]', footnote: 9 }] },
    { type: 'chart', footnote: 10, caption: 'Source' },
  ] },
  evidence: { footnotes: [
    { n: 2, text: 'RBA, FSR, October 2026.', url: 'https://www.rba.gov.au/publications/fsr/2026/oct/' },
    { n: 5, text: 'ABS, Building Activity.', url: 'https://abs.gov.au/x' },
    { n: 9, text: 'RBA, FSR, October 2026, media release MR-26-28.', url: 'https://www.rba.gov.au/publications/fsr/2026/oct' },
    { n: 10, text: 'ABS, Building Activity.', url: 'https://abs.gov.au/x' },
  ] },
} as never as Parameters<typeof mergeDuplicateFootnotes>[0];
mergeDuplicateFootnotes(story);
const s = story as unknown as { hook: string; body: { blocks: Record<string, unknown>[] }; evidence: { footnotes: { n: number; text: string }[] } };
assert.equal(s.evidence.footnotes.length, 2);
assert.deepEqual(s.evidence.footnotes.map((f) => f.n), [1, 2]);
assert.equal(s.hook, 'Deck.[^1]');
assert.equal(s.body.blocks[0].text, 'A.[^1] B.[^1] C.[^2]');
assert.equal((s.body.blocks[1].events as { footnote: number; label: string }[])[0].footnote, 1);
assert.equal(s.body.blocks[2].footnote, 2);
assert.equal(s.evidence.footnotes[0].text, 'RBA, FSR, October 2026, media release MR-26-28.');
// A footnote nothing cites is dropped.
const lone = { hook: 'Deck.[^1]', body: { blocks: [] }, evidence: { footnotes: [{ n: 1, text: 'A', url: 'https://a' }, { n: 2, text: 'B', url: 'https://b' }] } } as never as Parameters<typeof mergeDuplicateFootnotes>[0];
mergeDuplicateFootnotes(lone);
assert.equal((lone as unknown as { evidence: { footnotes: unknown[] } }).evidence.footnotes.length, 1);
// An uncited footnote sharing a URL with a cited one is dropped, not merged in.
const shared = { hook: 'Deck.[^1]', body: { blocks: [] }, evidence: { footnotes: [{ n: 1, text: 'OECD, inflows.', url: 'https://x' }, { n: 2, text: 'Unverified claim.', url: 'https://x' }] } } as never as Parameters<typeof mergeDuplicateFootnotes>[0];
mergeDuplicateFootnotes(shared);
assert.equal((shared as unknown as { evidence: { footnotes: { text: string }[] } }).evidence.footnotes[0].text, 'OECD, inflows.');
console.log('footnotes.check: ok');
