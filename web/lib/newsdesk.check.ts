import assert from 'node:assert/strict';
import {
  bottomLineToday, checkIssues, countBy, feedHealth, hostOf, isGateHold, newestFirst, rowTitle, timeAgo, type FeedRow,
} from './newsdesk';

const now = new Date('2026-10-16T00:00:00Z');

assert.equal(timeAgo(null, now), '');
assert.equal(timeAgo('not a date', now), '');
assert.equal(timeAgo('2026-10-15T23:59:30Z', now), 'just now');
assert.equal(timeAgo('2026-10-15T23:48:00Z', now), '12m ago');
assert.equal(timeAgo('2026-10-15T19:00:00Z', now), '5h ago');
assert.equal(timeAgo('2026-10-13T00:00:00Z', now), '3d ago');
assert.equal(timeAgo('2026-09-01T00:00:00Z', now), '6w ago');
assert.equal(timeAgo('2026-10-16T05:00:00Z', now), 'in 5h');

assert.deepEqual(countBy([{ s: 'a' }, { s: 'b' }, { s: 'a' }, { s: null }], (r) => r.s), { a: 2, b: 1, unknown: 1 });

assert.equal(isGateHold('publish gate: this story has not passed the strict check'), true);
assert.equal(isGateHold('Held by the Publish Gate'), true);
assert.equal(isGateHold('network error'), false);
assert.equal(isGateHold(null), false);

const feed = (over: Partial<FeedRow>): FeedRow => ({
  feed_id: Math.random().toString(36), name: 'Feed', publisher: null, url: 'https://x.test/rss', active: true,
  last_fetched: '2026-10-15T22:00:00Z', last_item_at: null, error_count: 0, ...over,
});
const h = feedHealth([
  feed({ name: 'ok' }),
  feed({ name: 'bad', error_count: 3 }),
  feed({ name: 'worse', error_count: 9 }),
  feed({ name: 'new', last_fetched: null }),
  feed({ name: 'old', last_fetched: '2026-10-10T00:00:00Z' }),
  feed({ name: 'off', active: false, error_count: 5 }),
], now);
assert.equal(h.total, 6);
assert.equal(h.active, 5);
assert.equal(h.failing, 2);
assert.equal(h.neverFetched, 1);
assert.equal(h.stale, 1);
assert.deepEqual(h.problems.map((p) => p.feed.name), ['worse', 'bad', 'new', 'old']);
assert.equal(h.lastFetched, '2026-10-15T22:00:00Z');

assert.deepEqual(checkIssues({ ok: false, issues: ['a', { message: 'b' }] }), ['a', 'b']);
assert.deepEqual(checkIssues(null), []);
assert.deepEqual(checkIssues({ ok: true }), []);

assert.equal(rowTitle({ title: '  ', headline: 'Rents bite' }), 'Rents bite');
assert.equal(rowTitle({}), 'Untitled');

assert.deepEqual(newestFirst([{ id: 1, created_at: '2026-10-01' }, { id: 2, published_at: '2026-10-05' }, { id: 3 }]).map((r) => r.id), [2, 1, 3]);

assert.deepEqual(bottomLineToday([{ day: '2026-10-16', status: 'held' }], '2026-10-16').status, 'held');
assert.deepEqual(bottomLineToday([{ day: '2026-10-15', status: 'published' }], '2026-10-16'), { status: 'missing', row: null });

assert.equal(hostOf('https://www.abc.net.au/news/x'), 'abc.net.au');
assert.equal(hostOf('nope'), '');

console.log('newsdesk.check: ok');
