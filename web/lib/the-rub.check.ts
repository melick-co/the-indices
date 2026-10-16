import assert from 'node:assert/strict';
import { RUBS } from '../content/the-rub/seed';
import { chooseRub, findRub } from './the-rub';
import { pickExplainer, explainerBySlug } from './explainers';
import type { TrendingPageData } from './trending-topics';

const empty: TrendingPageData = {
  period_end: '2026-09-22',
  rss_day: null,
  rss_week: null,
  x_au_day: null,
  x_au_week: null,
  x_global_day: null,
  x_global_week: null,
  x_configured: false,
};

const rba: TrendingPageData = {
  ...empty,
  rss_day: {
    source: 'rss',
    region: 'au',
    window_type: '1d',
    period_end: '2026-09-22',
    item_count: 1,
    computed_at: null,
    topics: [{ rank: 1, topic: 'RBA holds the cash rate' }],
  },
};

const matched = chooseRub(RUBS, rba);
assert.equal(matched.matched, true);
assert.equal(matched.rub.slug, 'cash-rate-theatre');
assert.match(matched.peg ?? '', /rba/);

const rotated = chooseRub(RUBS, empty, new Date('2026-01-02T00:00:00Z'));
assert.equal(rotated.matched, false);
assert.ok(rotated.rub.slug);

assert.ok(findRub(RUBS, 'gdp-grew-so-what'));
for (const slug of ['cash-rate-theatre', 'migration-headcount', 'house-price-cheer']) {
  const piece = findRub(RUBS, slug);
  assert.ok(piece);
  assert.equal(piece.paragraphs.at(-1), 'Which, if we are being precise, is the rub.');
  assert.doesNotMatch(piece.paragraphs.join(' '), /ladies and gentlemen|Now look/i);
}
assert.ok(explainerBySlug('bonds'));
assert.ok(pickExplainer(new Date('2026-01-01T00:00:00Z')).slug);

// An empty pool (nothing published yet) still yields a column, from the seed.
assert.ok(chooseRub([], empty).rub.slug);
// A published row from the table is preferred when it matches the trend.
const fresh = { slug: 'new-one', title: 'New', keywords: ['tariff'], published: '2026-10-20', paragraphs: ['x'] };
const tariff = { ...rba, rss_day: { ...rba.rss_day!, topics: [{ rank: 1, topic: 'Tariff talk' }] } };
assert.equal(chooseRub([fresh, ...RUBS], tariff).rub.slug, 'new-one');

console.log('the-rub.check: ok');
