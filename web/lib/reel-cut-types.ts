/**
 * The cut: the locked storyboard rendered to an MP4 by Remotion, so every chart and every line of
 * burned-in text is drawn from the traced figures rather than asked of a model. A generator may
 * still supply the picture behind a scene; it never supplies a number or a word.
 *
 * Shared by the composition (browser bundle) and the render script (Node), so nothing in here
 * touches the database, the filesystem or a network.
 */

import { REEL_FORMAT, type ReelChartFrame, type ReelScene, type ReelSceneKind } from './reel-types';

export const CUT_FPS = REEL_FORMAT.fps;
export const CUT_WIDTH = REEL_FORMAT.width;
export const CUT_HEIGHT = REEL_FORMAT.height;
export const CUT_COMPOSITION_ID = 'caveat-reel';

/** Narration starts this far into its scene, so the first word lands after the frame has settled. */
export const VOICE_LEAD_SECONDS = 0.2;
/** Room left after the last word before the scene cuts. */
export const VOICE_TAIL_SECONDS = 0.4;

/**
 * A model-drawn picture behind a scene's text. Never a chart: charts are drawn here from the series.
 * `file` is a copy in the bundle's public folder, which the composition prefers to the URL so the
 * render never waits on the network; `seconds` is measured from that copy and lets a short clip loop.
 */
export type CutMedia = { kind: 'image' | 'video'; url: string; file?: string; seconds?: number };

/** One scene's narration as an audio file in the bundle's public folder, with its measured length. */
export type CutVoice = { file: string; seconds: number };

export type CutScene = {
  id: string;
  kind: ReelSceneKind;
  /** Seconds the scene runs for in the cut: the storyboard's figure, extended only to fit the read. */
  seconds: number;
  /** The storyboard's own figure, kept so the cut can say where it departed. */
  storyboardSeconds: number;
  narration: string;
  on_screen: string;
  lower_third?: string;
  chart?: ReelChartFrame;
  media?: CutMedia;
  voice?: CutVoice;
};

export type CutSource = { org: string; period: string };

export type CutProps = {
  story: { slug: string; title: string; kicker: string; caveat: string; published: string };
  oneNumber: { value: string; label: string } | null;
  sources: CutSource[];
  scenes: CutScene[];
};

export function framesFor(seconds: number): number {
  return Math.max(1, Math.round(seconds * CUT_FPS));
}

export function totalFrames(props: { scenes: Array<{ seconds: number }> }): number {
  return props.scenes.reduce((sum, s) => sum + framesFor(s.seconds), 0);
}

export function totalSeconds(props: { scenes: Array<{ seconds: number }> }): number {
  return Math.round(props.scenes.reduce((sum, s) => sum + s.seconds, 0) * 10) / 10;
}

/**
 * A scene keeps the storyboard's length unless the read does not fit, in which case it grows to
 * hold the read plus its lead and tail, rounded up to a tenth of a second. The read is never sped
 * up or cut: the words are the locked script.
 */
export function fitSceneSeconds(storyboardSeconds: number, voiceSeconds: number | null | undefined): number {
  if (!voiceSeconds || voiceSeconds <= 0) return storyboardSeconds;
  // Summed in whole milliseconds first, so 0.2 + 5.2 + 0.4 is 5.8 and not a tenth over it.
  const neededMs = Math.round((VOICE_LEAD_SECONDS + voiceSeconds + VOICE_TAIL_SECONDS) * 1000);
  if (neededMs <= storyboardSeconds * 1000) return storyboardSeconds;
  return Math.ceil(neededMs / 100) / 10;
}

export function planScene(
  scene: ReelScene,
  extras: { media?: CutMedia | null; voice?: CutVoice | null } = {},
): CutScene {
  const planned: CutScene = {
    id: scene.id,
    kind: scene.kind,
    seconds: fitSceneSeconds(scene.seconds, extras.voice?.seconds),
    storyboardSeconds: scene.seconds,
    narration: scene.narration,
    on_screen: scene.on_screen,
  };
  if (scene.lower_third) planned.lower_third = scene.lower_third;
  if (scene.chart) planned.chart = scene.chart;
  if (extras.media) planned.media = extras.media;
  if (extras.voice) planned.voice = extras.voice;
  return planned;
}

/** The sources card names each publisher once, with the period it covers. Six fit the frame. */
export function cutSources(sources: Array<{ org: string; period: string }>, max = 6): CutSource[] {
  const seen = new Set<string>();
  const out: CutSource[] = [];
  for (const s of sources) {
    const org = s.org?.trim();
    if (!org) continue;
    const period = s.period?.trim() ?? '';
    const key = `${org.toLowerCase()}|${period.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ org, period });
    if (out.length >= max) break;
  }
  return out;
}

/** The ledger's account of a cut: what ran for how long, and every place it departed from the board. */
export function describeCut(props: CutProps): string {
  const lines = [
    `CUT — ${props.story.title}`,
    `Runtime ${totalSeconds(props)}s across ${props.scenes.length} scenes, ${CUT_WIDTH}x${CUT_HEIGHT} at ${CUT_FPS}fps`,
    '',
  ];
  props.scenes.forEach((scene, i) => {
    const bits = [`${i + 1}. [${scene.kind.toUpperCase()}] ${scene.seconds}s`];
    if (scene.seconds !== scene.storyboardSeconds) {
      bits.push(`(storyboard ${scene.storyboardSeconds}s, extended to fit the read)`);
    }
    if (scene.chart) bits.push(`chart ${scene.chart.kind}`);
    if (scene.media) bits.push(`${scene.media.kind} behind`);
    bits.push(scene.voice ? 'voiced' : 'silent');
    lines.push(bits.join(' · '));
    lines.push(`   VO: ${scene.narration}`);
    lines.push(`   ON SCREEN: ${scene.on_screen}`);
  });
  return lines.join('\n');
}

/** A sample reel for checking the look without a database. Figures are invented and say so. */
export const DEMO_PROPS: CutProps = {
  story: {
    slug: 'demo',
    title: 'Demo reel: the shape of a Caveat cut',
    kicker: 'Demo',
    caveat: 'Every number here is made up to show the layout.',
    published: '2026-10-05',
  },
  oneNumber: { value: '8.8', label: 'per person, demo units' },
  sources: [
    { org: 'Demo Bureau of Statistics', period: 'June 2026' },
    { org: 'Demo Central Bank', period: 'Q2 2026' },
  ],
  scenes: [
    {
      id: 'd1', kind: 'cold_open', seconds: 4, storyboardSeconds: 4,
      narration: 'The headline says Australia leads. The per-person figure says something else.',
      on_screen: 'Australia leads. Or does it?',
      lower_third: 'Demo figures',
    },
    {
      id: 'd2', kind: 'frame', seconds: 6, storyboardSeconds: 6,
      narration: 'In absolute terms the ranking looks like this.',
      on_screen: 'The familiar ranking',
      lower_third: 'Demo Bureau of Statistics, June 2026',
      chart: {
        kind: 'bars', caption: 'Demo Bureau of Statistics, June 2026', reveal: 'sequential', title: 'Total intake, demo units',
        series: [
          { label: 'Australia', value: 14, highlight: true },
          { label: 'Canada', value: 12 },
          { label: 'New Zealand', value: 9 },
          { label: 'United Kingdom', value: 7 },
        ],
      },
    },
    {
      id: 'd3', kind: 'layer', seconds: 7, storyboardSeconds: 7,
      narration: 'Divide by population and the order swaps.',
      on_screen: 'Per person, the order swaps',
      lower_third: 'Demo Bureau of Statistics, June 2026',
      chart: {
        kind: 'rank_swap', caption: 'Demo Bureau of Statistics, June 2026', reveal: 'swap',
        primary_label: 'Absolute', alt_label: 'Per person',
        series: [
          { label: 'Australia', value: 14, highlight: true },
          { label: 'Canada', value: 12 },
          { label: 'New Zealand', value: 9 },
          { label: 'United Kingdom', value: 7 },
        ],
        alt_series: [
          { label: 'Australia', value: 8.8, highlight: true },
          { label: 'Canada', value: 9.6 },
          { label: 'New Zealand', value: 17.2 },
          { label: 'United Kingdom', value: 1.1 },
        ],
      },
    },
    {
      id: 'd4', kind: 'layer', seconds: 6, storyboardSeconds: 6,
      narration: 'And the trend has been flat for a decade.',
      on_screen: 'Flat for a decade',
      chart: {
        kind: 'line', caption: 'Demo Central Bank, Q2 2026', reveal: 'all_at_once', title: 'Demo rate, per cent',
        series: [
          { label: '2016', value: 3.1 }, { label: '2018', value: 3.4 }, { label: '2020', value: 2.9 },
          { label: '2022', value: 3.3 }, { label: '2024', value: 3.2 }, { label: '2026', value: 3.1, highlight: true },
        ],
      },
    },
    {
      id: 'd5', kind: 'turn', seconds: 5, storyboardSeconds: 5,
      narration: 'So the lead is a function of size, not of policy.',
      on_screen: 'Size, not policy',
      chart: {
        kind: 'timeline', caption: 'Demo Bureau of Statistics, June 2026', reveal: 'sequential',
        series: [
          { label: '2022', value: 6 }, { label: '2023', value: 7 }, { label: '2024', value: 9 },
          { label: '2025', value: 12 }, { label: '2026', value: 14, highlight: true },
        ],
      },
    },
    {
      id: 'd6', kind: 'one_number', seconds: 5, storyboardSeconds: 5,
      narration: 'Eight point eight per person.',
      on_screen: 'The number that holds it',
      lower_third: 'Demo Bureau of Statistics, June 2026',
    },
    {
      id: 'd7', kind: 'caveat', seconds: 5, storyboardSeconds: 5,
      narration: 'The caveat: per-person figures flatter small countries with large diasporas.',
      on_screen: 'Per-person figures flatter small countries',
    },
    {
      id: 'd8', kind: 'sources', seconds: 4, storyboardSeconds: 4,
      narration: 'Sources: the Demo Bureau of Statistics and the Demo Central Bank.',
      on_screen: 'Demo Bureau of Statistics. Demo Central Bank.',
    },
  ],
};
