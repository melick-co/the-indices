import assert from 'node:assert/strict';
import { pickRub, rubBySlug } from './the-rub';
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

const matched = pickRub(rba);
assert.equal(matched.matched, true);
assert.equal(matched.rub.slug, 'cash-rate-theatre');
assert.match(matched.peg ?? '', /rba/);

const rotated = pickRub(empty, new Date('2026-01-02T00:00:00Z'));
assert.equal(rotated.matched, false);
assert.ok(rotated.rub.slug);

assert.ok(rubBySlug('gdp-grew-so-what'));
for (const slug of ['cash-rate-theatre', 'migration-headcount', 'house-price-cheer']) {
  const piece = rubBySlug(slug);
  assert.ok(piece);
  assert.equal(piece.paragraphs.at(-1), 'Which, if we are being precise, is the rub.');
  assert.doesNotMatch(piece.paragraphs.join(' '), /ladies and gentlemen|Now look/i);
}
assert.ok(explainerBySlug('bonds'));
assert.ok(pickExplainer(new Date('2026-01-01T00:00:00Z')).slug);

console.log('the-rub.check: ok');
