import assert from 'node:assert/strict';
import {
  CUT_FPS,
  DEMO_PROPS,
  cutSources,
  describeCut,
  fitSceneSeconds,
  framesFor,
  planScene,
  totalFrames,
  totalSeconds,
} from './reel-cut-types';
import { SCENE_KINDS, type ReelScene } from './reel-types';

// A read that fits leaves the storyboard's length alone.
assert.equal(fitSceneSeconds(6, 4.2), 6);
assert.equal(fitSceneSeconds(6, null), 6);
assert.equal(fitSceneSeconds(6, 0), 6);

// A read that does not fit grows the scene to lead + read + tail, rounded up to a tenth.
assert.equal(fitSceneSeconds(5, 5.0), 5.6); // 0.2 lead + 5.0 read + 0.4 tail, not 5.7 from float drift
assert.equal(fitSceneSeconds(3, 2.45), 3.1);

// Frames round to the nearest whole frame and never reach zero.
assert.equal(framesFor(6), 6 * CUT_FPS);
assert.equal(framesFor(0.01), 1);
assert.equal(totalFrames({ scenes: [{ seconds: 4 }, { seconds: 6 }] }), 10 * CUT_FPS);
assert.equal(totalSeconds({ scenes: [{ seconds: 4.1 }, { seconds: 6 }] }), 10.1);

// Sources are named once each, with their period, six at most.
const sources = cutSources([
  { org: 'ABS', period: 'June 2026' },
  { org: 'abs', period: 'june 2026' },
  { org: 'ABS', period: 'March 2026' },
  { org: '', period: '2025' },
  { org: 'RBA', period: 'Q2 2026' },
]);
assert.deepEqual(sources, [
  { org: 'ABS', period: 'June 2026' },
  { org: 'ABS', period: 'March 2026' },
  { org: 'RBA', period: 'Q2 2026' },
]);
assert.equal(cutSources(Array.from({ length: 9 }, (_, i) => ({ org: `Org ${i}`, period: '2026' }))).length, 6);

// A planned scene keeps the storyboard's words and figure, carries the voice, and drops empty fields.
const scene: ReelScene = {
  id: 's2', kind: 'layer', seconds: 5,
  narration: 'Per person, Australia sits at 8.8.',
  on_screen: 'Australia 8.8 per person',
  visual_prompt: 'Rank rows.',
  chart: { kind: 'bars', caption: 'ABS, June 2026', reveal: 'sequential', series: [{ label: 'Australia', value: 8.8 }] },
};
const planned = planScene(scene, { voice: { file: 'voice/s2.mp3', seconds: 5.2 }, media: { kind: 'image', url: 'https://x/y.png' } });
assert.equal(planned.storyboardSeconds, 5);
assert.equal(planned.seconds, 5.8);
assert.equal(planned.on_screen, scene.on_screen);
assert.equal(planned.chart?.series[0].value, 8.8);
assert.equal(planned.voice?.file, 'voice/s2.mp3');
assert.equal(planned.media?.kind, 'image');
assert.ok(!('lower_third' in planned));
const silent = planScene(scene);
assert.ok(!('voice' in silent) && !('media' in silent));
assert.equal(silent.seconds, 5);

// The ledger account names every departure from the board.
const account = describeCut({ ...DEMO_PROPS, scenes: [planned] });
assert.match(account, /storyboard 5s, extended to fit the read/);
assert.match(account, /VO: Per person, Australia sits at 8.8\./);
assert.match(account, /voiced/);

// The demo reel exercises every scene kind and every chart kind, and is a valid length.
const kinds = new Set(DEMO_PROPS.scenes.map((s) => s.kind));
for (const k of SCENE_KINDS) assert.ok(kinds.has(k), `demo has a ${k} scene`);
const chartKinds = new Set(DEMO_PROPS.scenes.map((s) => s.chart?.kind).filter(Boolean));
assert.deepEqual([...chartKinds].sort(), ['bars', 'line', 'rank_swap', 'timeline']);
assert.ok(totalSeconds(DEMO_PROPS) >= 20 && totalSeconds(DEMO_PROPS) <= 75);
// Burned-in text obeys the charter.
for (const s of DEMO_PROPS.scenes) assert.ok(!/—/.test(`${s.on_screen} ${s.lower_third ?? ''} ${s.narration}`), `${s.id} has no em dash`);

console.log('reel-cut: all checks passed');
