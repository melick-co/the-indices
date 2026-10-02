import assert from 'node:assert/strict';
import { checkStyle, splitLongParagraphs } from './style-check';
import type { StoryBlock } from './story-types';

const good = {
  title: 'Housing Credit Outruns Falling Home Values as Rates Climb',
  hook: 'Lending grew 7.3% in the year to August while the value of the dwelling stock fell A$34 billion, leaving borrowers more exposed as the RBA tightens.[^2]',
  one_number: { value: '7.3%', label: 'housing credit growth, year to August', metric_id: 'credit_housing_12m_au', footnote: 1 },
  evidence: { sources: [], footnotes: [{ n: 1, text: 'RBA, D1', url: 'https://www.rba.gov.au/statistics/tables/' }, { n: 2, text: 'ABS, dwellings', url: 'https://www.abs.gov.au/' }, { n: 3, text: 'RBA, F6', url: 'https://www.rba.gov.au/statistics/tables/' }] },
  body: {
    blocks: [
      { type: 'paragraph', role: 'lede', text: 'Australian housing credit grew 7.3% in the year to August, the fastest pace in this tightening cycle, the Reserve Bank said.[^1]' },
      { type: 'paragraph', role: 'nut', text: 'The value of homes securing those loans fell for the first time since 2022.[^2] That squeezes borrowers from both sides.' },
      { type: 'chart', kind: 'line', title: 'Credit growth keeps climbing', subtitle: 'Housing credit, annual change, %', alt: 'Credit growth rose to 7.3%.', footnote: 1, series: [], data: { metric_id: 'credit_housing_12m_au', mode: 'timeline' } },
      { type: 'paragraph', role: 'evidence', text: 'The average outstanding variable rate for owner-occupiers reached 8.77%.[^3]' },
      { type: 'paragraph', role: 'to_be_sure', text: 'Arrears remain low, and most borrowers built buffers when rates were lower.' },
      { type: 'paragraph', role: 'whats_next', text: 'The RBA next meets on 4 November.[^1]' },
    ] as StoryBlock[],
  },
};
const ok = checkStyle(good);
assert.deepEqual(ok.issues, [], ok.issues.join('\n'));

const bad = checkStyle({
  ...good,
  title: 'Housing',
  hook: 'Short deck.',
  body: { blocks: [
    { type: 'paragraph', text: 'Credit grew 7.3% in the year to August while home values fell across most capital cities, which matters a great deal for a very large number of mortgage borrowers across the whole country right now and for some time to come.' },
    { type: 'paragraph', text: 'One. Two. Three. Four.' },
  ] as StoryBlock[] },
});
for (const expected of [/headline is 1 words/, /deck is 2 words/, /lede is \d+ words/, /no nut graf/, /no "to be sure"/, /no "what's next"/, /paragraph 2 has 4 sentences/, /figure without a footnote marker/]) {
  assert.ok(bad.issues.some((i) => expected.test(i)), `expected ${expected}; got:\n${bad.issues.join('\n')}`);
}
assert.ok(checkStyle({ ...good, title: 'A Revolutionary Shift Hits the Housing Market This Year' }).issues.some((i) => /hype word/.test(i)));

// Long paragraphs split into parts of at most three sentences, markers kept with their sentence.
const split = splitLongParagraphs([
  { type: 'paragraph', role: 'lede', text: 'Credit hit A$2,568 billion.[^1] Values fell. Rates rose to 4.60%.[^2] Borrowers are squeezed.' },
  { type: 'paragraph', role: 'evidence', text: 'A. B. C. D. E.' },
] as StoryBlock[]) as Extract<StoryBlock, { type: 'paragraph' }>[];
assert.deepEqual(split.map((p) => [p.role, p.text]), [
  ['lede', 'Credit hit A$2,568 billion.[^1] Values fell.'],
  ['context', 'Rates rose to 4.60%.[^2] Borrowers are squeezed.'],
  ['evidence', 'A. B. C.'],
  ['evidence', 'D. E.'],
]);

// Sourced statements need a footnote, and cited footnotes need a link.
const noLink = checkStyle({ ...good, evidence: { sources: [], footnotes: [{ n: 1, text: 'RBA, D1' }, ...good.evidence.footnotes.slice(1)] } });
assert.ok(noLink.issues.some((i) => /footnote \[\^1\] has no link/.test(i)), noLink.issues.join('\n'));
const unattributed = checkStyle({ ...good, body: { blocks: good.body.blocks.map((b) => (
  (b as { role?: string }).role === 'whats_next' ? { ...b, text: 'The board said it will watch wages closely.' } : b)) as StoryBlock[] } });
assert.ok(unattributed.issues.some((i) => /sourced statement without a footnote link/.test(i)), unattributed.issues.join('\n'));
console.log('style-check.check: ok');
