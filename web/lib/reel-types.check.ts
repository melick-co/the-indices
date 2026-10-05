import assert from 'node:assert/strict';
import {
  SCENE_SECONDS,
  WORDS_PER_SECOND,
  fitSecondsToWords,
  secondsForWords,
  validateReel,
  type ReelScene,
} from './reel-types';
import type { Story } from './story-types';

// The words decide the length: 36 words at the house pace need 16 whole seconds.
assert.equal(secondsForWords(36), Math.ceil(36 / WORDS_PER_SECOND));
assert.equal(secondsForWords(1), SCENE_SECONDS.min);
assert.equal(fitSecondsToWords(7, 'one two three four five six seven eight nine ten eleven twelve'), 7);
assert.equal(fitSecondsToWords(4, Array(23).fill('word').join(' ')), 10);

// A scene as long as its words need is not flagged; one padded past both the range and its words is.
const story = {
  title: 'T', hook: 'H', caveat: 'C', kicker: 'K', slug: 's', published: '2026-10-05',
  oneNumber: { value: '1', label: 'x' }, evidence: { sources: [{ metric: 'm', org: 'ABS', tier: 1, url: '', period: '2026', basis: '' }] },
} as unknown as Story;
const scene = (id: string, kind: ReelScene['kind'], seconds: number, words: number): ReelScene => ({
  id, kind, seconds, narration: Array(words).fill('word').join(' '), on_screen: 'x', visual_prompt: 'v',
});
const long = [
  scene('s1', 'cold_open', 4, 8), scene('s2', 'layer', 16, 36), scene('s3', 'layer', 4, 8),
  scene('s4', 'one_number', 3, 5), scene('s5', 'caveat', 3, 5), { ...scene('s6', 'sources', 3, 5), on_screen: 'ABS', narration: 'ABS' },
];
const { warnings } = validateReel(long, story, { stage: 'script' });
assert.ok(!warnings.some((w) => w.startsWith('Scene 2') && /outside/.test(w)), warnings.join('\n'));
const padded = validateReel([{ ...long[1], seconds: 20 }, ...long.filter((s) => s.id !== 's2')], story, { stage: 'script' });
assert.ok(padded.warnings.some((w) => /20s is outside/.test(w)), padded.warnings.join('\n'));

console.log('reel-types: all checks passed');
