import assert from 'node:assert/strict';
import { DEFAULT_RULES, cadenceDecision, channelMode, pieceChannels, planCadence, pickForSlot, wallTime, type CadenceCandidate } from '../content-queue';
import { cleanInvisible, lintLinkedin, postParts } from './linkedin-copy';
import { LINKEDIN_VERSION, buildArticlePost, buildImagePost, escapeLittle, linkedinError, postUrl, urnFromUrl } from './linkedin';

const codes = (text: string, source = SOURCE) => lintLinkedin(text, source).issues.map((i) => i.code);

// ---------------------------------------------------------------------------------------------------- lint

const SOURCE = `Rents rose 6.2% over the year to September, the ABS said. Headline CPI rose 3.1% and the trimmed mean rose 2.9%
in the September quarter. Electricity prices rose 9.4%. The Reserve Bank meets on 3 November 2026.`;

const GOOD = [
  'Rents rose 6.2% over the year to September, the fastest of any major CPI component, ABS figures show.',
  '',
  'Headline CPI rose 3.1% in the September quarter and the trimmed mean rose 2.9%, according to the ABS. The trimmed mean is the RBA\'s preferred measure of underlying inflation, so it carries more weight in rate decisions than the headline figure does.',
  '',
  'Electricity prices rose 9.4% over the same period as rebates rolled off. Housing costs remain the largest single source of price pressure in the basket, and they have been for most of the past two years.',
  '',
  'The Reserve Bank next meets on 3 November 2026, when the board will have the full quarterly figures in hand for the first time since the August meeting.',
  '',
  '#AusEcon #Inflation',
].join('\n');

assert.equal(lintLinkedin(GOOD, SOURCE).ok, true, JSON.stringify(lintLinkedin(GOOD, SOURCE).issues));

// Em dash and invisible characters.
assert.ok(codes(GOOD.replace('rose 9.4% over', 'rose 9.4% — over')).includes('em-dash'));
const zw = cleanInvisible('Rents​ rose 6.2%');
assert.equal(zw.text, 'Rents rose 6.2%');
assert.equal(zw.changed, 2);
assert.equal(lintLinkedin(GOOD.replace('Rents rose', 'Rents​ rose'), SOURCE).text.includes('​'), false);
assert.equal(lintLinkedin(GOOD.replace('Rents rose', 'Rents​ rose'), SOURCE).ok, true);

// Banned words (rejected, not replaced); economic terms pass.
assert.ok(codes(GOOD.replace('as rebates rolled off', 'a staggering jump as rebates rolled off')).includes('banned-word'));
assert.ok(codes(GOOD.replace('Housing costs remain', 'This underscores that housing costs remain')).includes('banned-word'));
assert.ok(!codes(GOOD.replace('Housing costs remain', 'In the labour market landscape, elevated housing costs remain')).includes('banned-word'));
assert.ok(codes(GOOD.replace('The Reserve Bank next', 'Let that sink in. The Reserve Bank next')).includes('banned-phrase'));

// Structural tells.
assert.ok(codes(GOOD.replace('Housing costs remain', "It's not just rents, it's housing costs that remain")).includes('not-just'));
assert.ok(codes(GOOD.replace('Housing costs remain the largest', 'Prices are higher, stickier, and broader. Housing costs remain the largest')).includes('triad'));
assert.ok(!codes(GOOD.replace('Housing costs remain the largest', 'Rents, insurance and electricity led. Housing costs remain the largest')).includes('triad'));
assert.ok(codes(GOOD.replace('\n\nThe Reserve Bank next', '\n\nThe result?\nThe Reserve Bank next')).includes('rhetorical-question'));
assert.ok(codes(GOOD.replace('#AusEcon #Inflation', 'Thoughts?\n\n#AusEcon #Inflation')).includes('engagement-bait'));
assert.ok(codes(GOOD.replace('#AusEcon #Inflation', '#AusEcon #Inflation #RBA #Rents')).includes('hashtags'));
assert.ok(codes(GOOD.replace('ABS figures show.', 'ABS figures show. #Rents')).includes('hashtags-placement'));
assert.ok(codes(GOOD.replace('ABS figures show.', 'ABS figures show \u{1F4C8}.')).includes('emoji'));
assert.ok(codes(GOOD.replace('Housing costs remain', 'We think housing costs remain')).includes('first-person'));
assert.ok(!codes(GOOD.replace('Housing costs remain', 'US housing costs differ, but here housing costs remain')).includes('first-person'));
assert.ok(codes(GOOD.replace('rolled off.', 'rolled off. See https://caveat.news.')).includes('link'));

// Figures must be the piece's own; inflation needs the pair and the guard; quotes must be verbatim.
assert.ok(codes(GOOD.replace('rose 9.4%', 'rose nearly 10%')).includes('figures'));
assert.ok(codes(GOOD.replace(' and the trimmed mean rose 2.9%', '')).includes('cpi-pair'));
assert.ok(codes(GOOD.replace("The trimmed mean is the RBA's preferred measure of underlying inflation, so it", 'It')).includes('cpi-guard'));
assert.ok(codes(GOOD.replace('as rebates rolled off', 'as "rebates have run out for households"')).includes('quote'));
assert.ok(!codes(GOOD.replace('as rebates rolled off', 'as "electricity prices rose 9.4%"')).includes('quote'));

// Length and first line.
assert.ok(codes(GOOD.split('\n\n#')[0].slice(0, 400)).includes('length'));
assert.ok(codes(`${GOOD}\n\n${'Electricity prices rose 9.4% again. '.repeat(25)}`).includes('length'));
const longFirst = GOOD.replace('ABS figures show.', 'ABS figures show, with the increase spread across every capital city and most regional centres as well.');
assert.ok(codes(longFirst).includes('first-line'));
assert.ok(codes(GOOD.replace('Rents rose 6.2% over the year to September', 'Rents kept climbing over the year to September')).includes('first-line-figure'));
assert.equal(postParts(GOOD).firstLine.length <= 140, true);
assert.equal(postParts(GOOD).paragraphs.length, 3);
assert.equal(postParts(GOOD).tags, '#AusEcon #Inflation');
assert.ok(codes(GOOD.replace(/\n\nElectricity[^\n]+\n\nThe Reserve[^\n]+/, '')).includes('paragraphs'));

// ---------------------------------------------------------------------------------------------------- cadence

const tz = 'Australia/Sydney';
const cad = DEFAULT_RULES.cadence!.linkedin!;
const at = (day: string, hhmm: string) => wallTime(day, hhmm, tz);
const c = (id: string, kind: CadenceCandidate['kind'], d: Date, status: CadenceCandidate['status'] = 'scheduled'): CadenceCandidate => ({ id, kind, status, siteAt: d });

// LinkedIn is off the per-piece lists, on review by default, weekdays only at 08:00.
assert.deepEqual(pieceChannels({ ...DEFAULT_RULES, channels: { article: ['site', 'x', 'linkedin'] } }, 'article'), ['site', 'x']);
assert.equal(channelMode(DEFAULT_RULES, 'linkedin'), 'review');
assert.equal(channelMode({ ...DEFAULT_RULES, channelModes: undefined }, 'linkedin'), 'review');
assert.deepEqual(cad.days, ['mon', 'tue', 'wed', 'thu', 'fri']);
assert.equal(cad.slot, '08:00');

// Wednesday 21 October 2026, 06:00 Sydney: today's 07:00 story beats yesterday's graphic and today's 09:30 graphic.
const now = at('2026-10-21', '06:00');
const cands = [
  c('story-today', 'article', at('2026-10-21', '07:00')),
  c('story-late', 'article', at('2026-10-21', '12:30')),            // after the slot: not live by 8am
  c('visual-yday', 'visual', at('2026-10-20', '09:30'), 'published'),
  c('visual-today', 'visual', at('2026-10-21', '09:30')),
  c('story-thu', 'article', at('2026-10-22', '07:00')),
];
const plan = planCadence(cad, tz, cands, [], new Set(), now);
assert.deepEqual(plan.map((p) => [p.day, p.pick.id]), [['2026-10-21', 'story-today'], ['2026-10-22', 'story-thu']]);
assert.equal(plan[0].at.toISOString(), at('2026-10-21', '08:00').toISOString());

// No story that morning: the newest graphic or race from that day or the day before.
assert.equal(pickForSlot(cands.filter((x) => x.kind !== 'article'), '2026-10-21', at('2026-10-21', '08:00'), tz, new Set())?.id, 'visual-yday');
const race = c('race-today', 'race', at('2026-10-21', '06:30'));
assert.equal(pickForSlot([...cands.filter((x) => x.kind !== 'article'), race], '2026-10-21', at('2026-10-21', '08:00'), tz, new Set())?.id, 'race-today');
// Older than the day before: nothing.
assert.equal(pickForSlot([c('old', 'visual', at('2026-10-19', '09:30'), 'published')], '2026-10-21', at('2026-10-21', '08:00'), tz, new Set()), null);
// A piece already used on LinkedIn is not picked again; a held piece is never picked.
assert.equal(pickForSlot(cands, '2026-10-21', at('2026-10-21', '08:00'), tz, new Set(['story-today']))?.id, 'visual-yday');
assert.equal(pickForSlot([c('h', 'article', at('2026-10-21', '07:00'), 'held')], '2026-10-21', at('2026-10-21', '08:00'), tz, new Set()), null);

// Weekends: Friday 23 October, 06:00: plans Friday; Saturday is skipped (aheadDays 1).
const fri = planCadence(cad, tz, [c('s-fri', 'article', at('2026-10-23', '07:00')), c('s-sat', 'article', at('2026-10-24', '07:00'))], [], new Set(), at('2026-10-23', '06:00'));
assert.deepEqual(fri.map((p) => p.day), ['2026-10-23']);
// Sunday evening plans Monday.
const sun = planCadence(cad, tz, [c('s-mon', 'article', at('2026-10-26', '07:00'))], [], new Set(), at('2026-10-25', '18:00'));
assert.deepEqual(sun.map((p) => [p.day, p.pick.id]), [['2026-10-26', 's-mon']]);

// A day with a post keeps it, except an unreviewed graphic gives way to a lead story scheduled later.
const existing = [{ postId: 'p1', day: '2026-10-22', queueId: 'visual-today', kind: 'visual' as const, status: 'review' }];
const swap = planCadence(cad, tz, cands, existing, new Set(['visual-today']), now);
assert.deepEqual(swap.find((p) => p.day === '2026-10-22'), { day: '2026-10-22', at: at('2026-10-22', '08:00'), pick: cands[4], replaces: 'p1' });
const kept = planCadence(cad, tz, cands, [{ ...existing[0], status: 'approved' }], new Set(['visual-today']), now);
assert.equal(kept.find((p) => p.day === '2026-10-22'), undefined);
// Today's slot is planned up to two hours late, not after.
assert.equal(planCadence(cad, tz, cands, [], new Set(), at('2026-10-21', '09:30')).some((p) => p.day === '2026-10-21'), true);
assert.equal(planCadence(cad, tz, cands, [], new Set(), at('2026-10-21', '10:30')).some((p) => p.day === '2026-10-21'), false);

// ---------------------------------------------------------------------------------------------------- review gating

const slot = at('2026-10-21', '08:00').toISOString();
const after = at('2026-10-21', '08:15'), before = at('2026-10-21', '07:45');
assert.equal(cadenceDecision('review', { status: 'review', scheduled_at: slot }, 'published', after), 'wait');     // not approved
assert.equal(cadenceDecision('review', { status: 'scheduled', scheduled_at: slot }, 'published', after), 'wait');  // passed checks is not enough
assert.equal(cadenceDecision('review', { status: 'approved', scheduled_at: slot }, 'published', after), 'post');
assert.equal(cadenceDecision('review', { status: 'approved', scheduled_at: slot }, 'published', before), 'wait');  // before the slot
assert.equal(cadenceDecision('review', { status: 'approved', scheduled_at: slot }, 'scheduled', after), 'wait');   // not live on the site yet
assert.equal(cadenceDecision('auto', { status: 'scheduled', scheduled_at: slot }, 'published', after), 'post');
assert.equal(cadenceDecision('auto', { status: 'held', scheduled_at: slot }, 'published', after), 'wait');         // fails checks: never auto
assert.equal(cadenceDecision('auto', { status: 'review', scheduled_at: slot }, 'published', after), 'wait');
assert.equal(cadenceDecision('review', { status: 'approved', scheduled_at: slot }, 'published', at('2026-10-21', '14:30')), 'stale');
assert.equal(cadenceDecision('review', { status: 'posted', scheduled_at: slot }, 'cancelled', after), 'withdraw');  // delete from LinkedIn
assert.equal(cadenceDecision('review', { status: 'review', scheduled_at: slot }, 'held', after), 'withdraw');
assert.equal(cadenceDecision('review', { status: 'review', scheduled_at: slot }, 'ready', after), 'unplan');
assert.equal(cadenceDecision('auto', { status: 'planned', scheduled_at: slot }, 'published', after), 'wait');       // another runner is posting

// ---------------------------------------------------------------------------------------------------- API bodies

assert.match(LINKEDIN_VERSION, /^20\d{4}$/);
const org = 'urn:li:organization:12345';
const art = buildArticlePost({ author: org, commentary: 'Rents rose 6.2% (ABS).\n\n#AusEcon', url: 'https://caveat.news/stories/rents', title: 'Rents rise 6.2%', description: 'The year to September.', thumbnail: 'urn:li:image:C4E10AQ' });
assert.deepEqual(art, {
  author: org, commentary: 'Rents rose 6.2% \\(ABS\\).\n\n#AusEcon', visibility: 'PUBLIC',
  distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
  lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  content: { article: { source: 'https://caveat.news/stories/rents', title: 'Rents rise 6.2%', description: 'The year to September.', thumbnail: 'urn:li:image:C4E10AQ' } },
});
assert.equal('thumbnail' in buildArticlePost({ author: org, commentary: 'x', url: 'https://caveat.news/x', title: 't' }).content.article, false);
const img = buildImagePost({ author: org, commentary: 'Race', image: 'urn:li:image:C5610', altText: 'Bar race' });
assert.deepEqual(img.content, { media: { id: 'urn:li:image:C5610', altText: 'Bar race' } });
assert.equal(img.distribution.feedDistribution, 'MAIN_FEED');

// little format: reserved characters escaped, hashtags kept.
assert.equal(escapeLittle('A_b *c* [d] {e} @f <g> ~h | i \\ j # k #Tag'), 'A\\_b \\*c\\* \\[d\\] \\{e\\} \\@f \\<g\\> \\~h \\| i \\\\ j \\# k #Tag');
assert.equal(escapeLittle('Rates fell #RBA'), 'Rates fell #RBA');
assert.equal(escapeLittle('Item#1'), 'Item\\#1');

// URLs and errors.
assert.equal(postUrl('urn:li:share:6844785523593134080'), 'https://www.linkedin.com/feed/update/urn:li:share:6844785523593134080');
assert.equal(urnFromUrl(postUrl('urn:li:ugcPost:68447855235931240')), 'urn:li:ugcPost:68447855235931240');
assert.equal(linkedinError(401, 'x').kind, 'token');
assert.equal(linkedinError(403, 'x').kind, 'permission');
assert.equal(linkedinError(429, 'x', '60').retryAfter, 60);
assert.equal(linkedinError(500, 'x').kind, 'other');

console.log('linkedin.check: ok');
