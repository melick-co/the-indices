import assert from 'node:assert/strict';
import { articleFromApprovedPitch } from './article-from-pitch';

const story = articleFromApprovedPitch({
  headline: 'Australia looks open until you divide',
  hook: 'The viral intake chart ranks the wrong thing',
  mechanism: 'Absolute arrivals measure the size of an economy. Openness is a per-person question. Those two rankings are not the same list.',
  caveat: 'A single year can move the rank without changing the stock.',
  chart_hint: 'rank_swap of absolute intake against per-capita intake',
  trigger_rows: { one_number: { value: '14th', label: 'Australia per-capita intake rank' } },
});

assert.equal(story.title, 'Australia looks open until you divide');
assert.equal(story.one_number.value, '14th');
assert.ok(story.body.blocks.length >= 5);
assert.ok(story.body.blocks.some((b) => b.type === 'paragraph'));
assert.ok(story.body.blocks.some((b) => b.type === 'layers'));
assert.ok(story.body.blocks.some((b) => b.type === 'pull'));
assert.ok(!story.body.blocks.some((b) => b.type === 'chart'), 'must not invent a chart');
assert.doesNotMatch(JSON.stringify(story), /—/);

const thin = articleFromApprovedPitch({ headline: 'Thin brief' });
assert.ok(thin.body.blocks.some((b) => b.type === 'layers' && b.items.length >= 2));
assert.equal(thin.one_number.value, '-');

console.log('generate-story.check: ok');
