import assert from 'node:assert/strict';
import {
  dropFlaggedSentences,
  findListedLink,
  chartPathFor, dataFigures, decide, figuresMissingFrom, filterLinks, internalPathOk, isOfficialUrl, itemIssues, linkify,
  matchesTopics, normaliseDraft, shouldWrite, toCheckable, validateDraft, type BottomLineDraft, type SourceRef,
} from './australia-inc';

// ---------- fail closed
assert.deepEqual(decide({ issues: [], audited: true }), { ok: true, status: 'published' });
assert.deepEqual(decide({ issues: [], audited: false }), { ok: false, status: 'held' }, 'no audit, no publish');
assert.deepEqual(decide({ issues: ['x'], audited: true }), { ok: false, status: 'held' });
assert.equal(decide({ issues: undefined as unknown as string[], audited: true }).ok, false, 'a missing issue list is not a pass');
assert.equal(shouldWrite({ status: 'published' }, { status: 'held' }), false, 'a failed re-run never pulls the live brief');
assert.equal(shouldWrite({ status: 'published' }, { status: 'published' }), true);
assert.equal(shouldWrite({ status: 'held' }, { status: 'held' }), true);
assert.equal(shouldWrite(null, { status: 'held' }), true);

// ---------- sources and topics
assert.equal(isOfficialUrl('https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/x'), true);
assert.equal(isOfficialUrl('https://www.abc.net.au/news/x'), false);
assert.equal(isOfficialUrl('not a url'), false);
assert.equal(matchesTopics('Treasurer flags a smaller deficit'), true);
assert.equal(matchesTopics('Footy finals crowd record'), false);

// ---------- links
const known = { stories: new Set(['wages-lag']) };
assert.equal(internalPathOk('/indices/australia-inc', known), true);
assert.equal(internalPathOk('/indices/economy/rates', known), true);
assert.equal(internalPathOk('/stories/wages-lag', known), true);
assert.equal(internalPathOk('/stories/made-up', known), false);
assert.equal(internalPathOk('/foundry', known), false);
const cash = chartPathFor('cash_rate_au');
assert.ok(cash && cash.path.startsWith('/indices/economy/rates/'), 'cash rate charts on the rates section');
assert.equal(internalPathOk(cash!.path, known), true);
assert.equal(chartPathFor('not_a_series'), null);
const links = [
  { label: 'cash rate', url: '/indices/economy/rates', kind: 'chart' as const },
  { label: 'bad', url: '/nope', kind: 'chart' as const },
  { label: 'release', url: 'https://example.gov.au/a', kind: 'source' as const },
  { label: 'dead', url: 'https://example.gov.au/dead', kind: 'external' as const },
  { label: 'dup', url: '/indices/economy/rates', kind: 'chart' as const },
];
const f = filterLinks(links, known, new Map([['https://example.gov.au/a', true], ['https://example.gov.au/dead', false]]));
assert.deepEqual(f.kept.map((l) => l.label), ['cash rate', 'release']);
assert.deepEqual(f.dropped.map((l) => l.label), ['bad', 'dead']);

const lk = linkify('The Treasurer said the budget is on track, and the cash rate held.', [
  { label: 'cash rate', url: '/x', kind: 'chart' }, { label: 'Treasurer said', url: 'https://t.gov.au', kind: 'source' }, { label: 'missing', url: '/y', kind: 'chart' },
]);
assert.equal(lk.parts.map((p) => p.text).join(''), 'The Treasurer said the budget is on track, and the cash rate held.');
assert.deepEqual(lk.parts.filter((p) => p.link).map((p) => p.text), ['Treasurer said', 'cash rate']);
assert.deepEqual(lk.extra.map((l) => l.label), ['missing']);

// ---------- draft shape and rules
const sources: SourceRef[] = [
  { n: 1, title: 'Budget update', url: 'https://ministers.treasury.gov.au/a', publisher: 'Treasurer', official: true },
  { n: 2, title: 'Rates story', url: 'https://www.abc.net.au/b', publisher: 'ABC', official: false },
];
const raw = {
  headline: 'Deficit forecast narrows as spending rises',
  paragraphs: [
    { sentences: [{ text: 'The Treasurer said the deficit would be $27.9 billion this financial year.', source: 1 }, { text: 'Junk', source: 'x' }, { text: '' }], links: [{ label: 'Treasurer said', url: 'https://ministers.treasury.gov.au/a', kind: 'source' }, { label: 'bad', url: 'ftp://x' }] },
    { sentences: [{ text: 'The cash rate stands at 3.6 per cent.', source: null }], links: [] },
    { sentences: [{ text: 'The ABC reported that economists expect another cut.', source: 2 }], links: [] },
  ],
};
const draft = normaliseDraft(raw);
assert.equal(draft.paragraphs.length, 3);
assert.equal(draft.paragraphs[0].sentences.length, 2, 'empty sentences are dropped');
assert.equal(draft.paragraphs[0].sentences[1].source, null, 'a non-numeric source is no source');
assert.equal(draft.paragraphs[0].links.length, 1, 'non-http links are dropped');
assert.deepEqual(normaliseDraft(null), { headline: '', paragraphs: [] });

const v = validateDraft(draft, sources);
assert.ok(v.issues.some((i) => /words; the brief must run/.test(i)), 'too short');
assert.ok(!v.issues.some((i) => /news report/.test(i)), 'a news sentence without figures is fine');

const bad: BottomLineDraft = {
  headline: 'A headline — with a dash',
  paragraphs: [
    { sentences: [{ text: 'The ABC reported unemployment of 4.3 per cent.', source: 2 }], links: [] },
    { sentences: [{ text: 'The deficit is $27.9 billion.', source: 1 }], links: [] },
    { sentences: [{ text: 'Economists analyze the budget.', source: 9 }], links: [] },
    { sentences: [{ text: 'Headline inflation was 3.2 per cent.', source: null }], links: [] },
  ],
};
const b = validateDraft(bad, sources);
for (const re of [/em dash/, /figure from a news report/, /attribute it/, /not Australian English/, /source 9/, /trimmed mean/]) {
  assert.ok(b.issues.some((i) => re.test(i)), `expected an issue matching ${re}`);
}
assert.equal(validateDraft({ headline: 'x', paragraphs: [] }, sources).issues.some((i) => /0 paragraphs/.test(i)), true);

// ---------- the shape the gate reads
const story = toCheckable(draft, sources);
assert.equal(story.evidence?.footnotes?.length, 1, 'only official sources become footnotes');
assert.match((story.body.blocks[0] as { text: string }).text, /financial year\.\[\^1\]/);
assert.doesNotMatch((story.body.blocks[2] as { text: string }).text, /\[\^/, 'news sentences carry no footnote');
const dataOnly = toCheckable(draft, sources, { dataOnly: true });
assert.doesNotMatch(JSON.stringify(dataOnly.body), /27\.9/, 'sourced figures are left to the source check');
assert.deepEqual(dataFigures(draft, sources), [3.6]);

// ---------- figures against a document
assert.deepEqual(figuresMissingFrom('The deficit would be $27.9 billion, up from $22.1 billion.', 'deficit of $27.9 billion in 2026-27'), [22.1]);
assert.deepEqual(figuresMissingFrom('Spending of 1,234 million', 'spending 1,234 million'), []);
assert.deepEqual(itemIssues('The Treasurer said the deficit is $27.9 billion.', 'Treasurer', 'the deficit is $27.9 billion'), []);
assert.ok(itemIssues('The deficit is $30 billion.', 'Treasurer', 'the deficit is $27.9 billion').length >= 2);


// A brief held only for news figures loses those sentences, not the day; any other issue still holds it.
{
  const d = { headline: 'h', paragraphs: [
    { sentences: [{ text: 'The ABS said unemployment was 4.7 per cent.', source: null }, { text: 'The Guardian said 3 million rent.', source: 2 }], links: [{ label: 'unemployment', url: '/x', kind: 'chart' as const }] },
    { sentences: [{ text: 'MacroBusiness said 40 years.', source: 3 }], links: [{ label: 'MacroBusiness', url: 'https://m', kind: 'external' as const }] },
  ] };
  const links = d.paragraphs.map((p) => p.links);
  const cut = dropFlaggedSentences(d, links, [
    'paragraph 1 sentence 2: a figure from a news report (The Guardian); figures come from stored data or an official announcement',
    'paragraph 2 sentence 1: a figure from a news report (MacroBusiness); figures come from stored data or an official announcement',
  ]);
  assert.ok(cut);
  assert.equal(cut!.draft.paragraphs.length, 1);
  assert.equal(cut!.draft.paragraphs[0].sentences.length, 1);
  assert.equal(cut!.links.length, 1);
  assert.equal(cut!.dropped.length, 2);
  assert.equal(dropFlaggedSentences(d, links, ['claim not supported by stored data: "x"']), null);
  assert.equal(dropFlaggedSentences(d, links, []), null);
}

// A Treasury feed link the site no longer answers is found on its listing page by title.
{
  const html = '<ul><li><a href="/ministers/jim-chalmers-2022/media-releases/tax-reform-fairer-tax-system">Tax reform for a fairer tax system</a></li>'
    + '<li><a href="/ministers/jim-chalmers-2022/media-releases/first-meeting-between-uk-chancellor-healey-and">First meeting between UK Chancellor Healey and Australian Treasurer Chalmers</a></li>'
    + '<li><a href="/ministers/jim-chalmers-2022/media-releases/g20-meeting">G20 meeting</a></li></ul>';
  const base = 'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases';
  assert.equal(findListedLink(html, 'Tax reform for a fairer tax system', base), 'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/tax-reform-fairer-tax-system');
  assert.equal(findListedLink(html, 'First meeting between UK Chancellor Healey and Australian Treasurer Chalmers', base),
    'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/first-meeting-between-uk-chancellor-healey-and');
  // Slug matched by its opening words when the anchor text differs.
  assert.equal(findListedLink('<a href="/x/tax-reform-fairer-tax-system">Read more</a>', 'Tax reform for a fairer tax system', base),
    'https://ministers.treasury.gov.au/x/tax-reform-fairer-tax-system');
  assert.equal(findListedLink(html, 'Something else entirely', base), null);
}

console.log('australia-inc checks passed');
