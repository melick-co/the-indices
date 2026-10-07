import assert from 'node:assert/strict';
import { DEFAULT_RULES, captionNumbersOk, planSlots, wallTime } from './content-queue';

const tz = 'Australia/Sydney';
const fmt = (d: Date) => d.toLocaleString('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '');

// Wall time in Sydney, either side of the October daylight-saving change (4 Oct 2026).
assert.equal(wallTime('2026-10-07', '07:00', tz).toISOString(), '2026-10-06T20:00:00.000Z'); // AEDT, UTC+11
assert.equal(wallTime('2026-09-30', '07:00', tz).toISOString(), '2026-09-29T21:00:00.000Z'); // AEST, UTC+10

// Wednesday 7 October 2026, 06:00 Sydney.
const now = wallTime('2026-10-07', '06:00', tz);
const items = [
  { id: 'a1', kind: 'article' as const }, { id: 'a2', kind: 'article' as const }, { id: 'a3', kind: 'article' as const },
  { id: 'v1', kind: 'visual' as const }, { id: 'v2', kind: 'visual' as const },
  { id: 'r1', kind: 'race' as const }, { id: 'r2', kind: 'race' as const },
];
const plan = planSlots(DEFAULT_RULES, items, [], [], now);
const at = (id: string) => fmt(plan.get(id)!);
assert.equal(at('a1'), 'Wed 7 Oct, 07:00');
assert.equal(at('a2'), 'Wed 7 Oct, 12:30');
assert.equal(at('a3'), 'Thu 8 Oct, 07:00');          // two a day
assert.equal(at('v1'), 'Wed 7 Oct, 09:30');
assert.equal(at('v2'), 'Thu 8 Oct, 09:30');          // one a day
assert.equal(at('r1'), 'Wed 7 Oct, 18:00');          // races Tue to Thu
assert.equal(at('r2'), 'Tue 13 Oct, 18:00');         // one a week (the week starts Monday)

// A data release at 11:00: nothing within two hours of it, so the 12:30 article waits for Thursday and the visual takes 15:00.
const release = wallTime('2026-10-07', '11:00', tz);
const p2 = planSlots(DEFAULT_RULES, [{ id: 'a1', kind: 'article' }, { id: 'a2', kind: 'article' }, { id: 'v1', kind: 'visual' }], [], [release], now);
assert.equal(fmt(p2.get('a1')!), 'Wed 7 Oct, 07:00');
assert.equal(fmt(p2.get('v1')!), 'Wed 7 Oct, 15:00');  // 09:30 is within two hours of the release
assert.equal(fmt(p2.get('a2')!), 'Thu 8 Oct, 07:00');

// Already published today counts against the cap; nothing in the past or within 15 minutes.
const p3 = planSlots(DEFAULT_RULES, [{ id: 'a1', kind: 'article' }], [{ kind: 'article', at: wallTime('2026-10-07', '07:00', tz) }, { kind: 'article', at: wallTime('2026-10-07', '12:30', tz) }], [], wallTime('2026-10-07', '08:00', tz));
assert.equal(fmt(p3.get('a1')!), 'Thu 8 Oct, 07:00');

// Captions may only use the piece's own numbers.
assert.equal(captionNumbersOk('India now leads with 971,020 residents born there.', 'India leads with 971,020 in 2025'), true);
assert.equal(captionNumbersOk('India leads with nearly 1 million.', 'India leads with 971,020 in 2025'), false);
console.log('content-queue.check: ok');
