import assert from 'node:assert/strict';
import { compactRunwayPrompt, chartLockBlock, RUNWAY_PROMPT_MAX } from './runway-prompts';
import type { ReelScene, ReelStyle } from './reel-types';

const style: ReelStyle = {
  presenter: 'Single presenter, piece to camera.',
  look: 'Swiss editorial grid on raw off-white paper stock. Charcoal ink.',
  voice: 'Measured Australian news read.',
  audio: 'Sparse percussive bed.',
};

const chartScene: ReelScene = {
  id: 's3',
  kind: 'layer',
  seconds: 6,
  narration: 'Per person, Australia sits at 8.8, not the headline rank.',
  on_screen: 'Australia 8.8 per person',
  lower_third: 'ABS, June 2025',
  visual_prompt: 'Rank rows swap from absolute intake to per person, Australia highlighted.',
  chart: {
    kind: 'rank_swap',
    caption: 'ABS, June 2025',
    reveal: 'swap',
    primary_label: 'Absolute',
    alt_label: 'Per person',
    series: [
      { label: 'Australia', value: 8.8, highlight: true },
      { label: 'OECD', value: 14 },
    ],
    alt_series: [
      { label: 'Australia', value: 14, highlight: true },
      { label: 'OECD', value: 8.8 },
    ],
  },
};

const lock = chartLockBlock(chartScene.chart!);
assert.match(lock, /Australia 8\.8/);
assert.match(lock, /OECD 14/);
assert.match(lock, /do not alter, round, or compute new values/);

const prompt = compactRunwayPrompt({
  scene: chartScene,
  storyTitle: 'It takes 8.8 to buy the house',
  style,
  kind: 'chart_video',
});

assert.ok(prompt.length <= RUNWAY_PROMPT_MAX, `prompt is ${prompt.length} utf-16 units`);
assert.match(prompt, /Australia 8\.8/);
assert.match(prompt, /OECD 14/);
assert.match(prompt, /LOCKED SCRIPT/);
assert.match(prompt, /Do not invent/);
assert.doesNotMatch(prompt, /9\.1/);

console.log('runway-prompts ok', prompt.length);
