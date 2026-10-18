/**
 * "Bars over time" videos: one column per period, built left to right, each column split into coloured segments
 * (e.g. the share of a financial year each party was in office). A spec carries everything the composition draws:
 * the series, the segments, data-derived captions, the caveat and the sources. Specs are built in code from stored
 * official series (lib/bars-video.ts), so every figure on screen comes from the data.
 */
import type { RaceFormat } from '@/lib/race-video-types';

export const BARS_COMPOSITION_ID = 'BarBuild';
export const BARS_FPS = 30;

export type BarsGroup = { key: string; label: string; colour: string };
export type BarsBar = {
  period: string;
  /** Up is positive (the `axis.up` side). Null: no figure for this period (drawn as a gap, explained on screen). */
  value: number | null;
  /** Shares of the column, in the order they are stacked out from zero; they sum to 1. */
  segments: { group: string; share: number }[];
  /** The value as a share of something (e.g. % of GDP), for captions and the page. */
  pct?: number | null;
};
export type BarsSpec = {
  key: string;
  title: string;
  subtitle: string;
  /** Values are in $ millions; labels show $ billion. */
  unit: 'aud_m';
  /** Plain words for each side of zero ("Borrowed" above, "Surplus" below). */
  axis: { up: string; down: string; unitLabel: string };
  groups: BarsGroup[];
  /** A line under the legend (e.g. what a two-colour bar means). */
  legendNote?: string;
  bars: BarsBar[];
  /** Data-derived captions, each tied to the bar where it becomes true. */
  captions: { bar: number; text: string }[];
  /** The caveat card: one line each. */
  caveat: string[];
  sources: { org: string; dataset: string; url?: string }[];
  /** Extra lines for the sources card (what is excluded, how years are split). */
  notes: string[];
  takeaways: string[];
};
export type BarsProps = { spec: BarsSpec; format: RaceFormat; musicFile: string | null };

export const BARS_INTRO_SECONDS = 2.5;
/** Seconds per bar: about 25 seconds of building, never faster than 0.8s or slower than 1.5s a bar. */
export const barStepSeconds = (bars: number) => Math.min(1.5, Math.max(0.8, 25 / Math.max(1, bars)));
/** A bar grows over this share of its step. */
export const BAR_GROW_SHARE = 0.6;
export const BARS_HOLD_SECONDS = 4;
export const BARS_CAVEAT_SECONDS = 5.5;
export const BARS_SOURCES_SECONDS = 6;
export const BARS_OUTRO_SECONDS = 3.5;

export const barsBuildEnd = (s: BarsSpec) => BARS_INTRO_SECONDS + barStepSeconds(s.bars.length) * s.bars.length;
export const barsCaveatStart = (s: BarsSpec) => barsBuildEnd(s) + BARS_HOLD_SECONDS;
export const barsSourcesStart = (s: BarsSpec) => barsCaveatStart(s) + BARS_CAVEAT_SECONDS;
export const barsOutroStart = (s: BarsSpec) => barsSourcesStart(s) + BARS_SOURCES_SECONDS;
export const barsSeconds = (s: BarsSpec) => barsOutroStart(s) + BARS_OUTRO_SECONDS;
export const barsFrames = (s: BarsSpec) => Math.round(barsSeconds(s) * BARS_FPS);
/** The poster: the finished chart, halfway through the hold. */
export const barsPosterFrame = (s: BarsSpec) => Math.round((barsBuildEnd(s) + BARS_HOLD_SECONDS / 2) * BARS_FPS);

/** $ millions as the bars label them: $ billion, one decimal, or whole when space is tight. */
export function barLabel(vMillions: number, whole = false): string {
  const bn = Math.abs(vMillions) / 1000;
  return whole ? `${Math.round(bn)}` : bn.toFixed(1);
}
/** $ millions in a caption: "$44.8bn". */
export const bnText = (vMillions: number) => `$${(Math.abs(vMillions) / 1000).toFixed(1)}bn`;

export const DEMO_BARS: BarsSpec = {
  key: 'bars:demo', title: 'Demo bars', subtitle: 'Made-up values for the composition preview', unit: 'aud_m',
  axis: { up: 'Up', down: 'Down', unitLabel: '$ billion' },
  groups: [{ key: 'a', label: 'Group A', colour: '#e5534b' }, { key: 'b', label: 'Group B', colour: '#4a90e2' }],
  bars: [
    { period: '2020', value: -5000, segments: [{ group: 'a', share: 1 }] },
    { period: '2021', value: 12000, segments: [{ group: 'a', share: 0.4 }, { group: 'b', share: 0.6 }] },
    { period: '2022', value: null, segments: [] },
    { period: '2023', value: 30000, segments: [{ group: 'b', share: 1 }] },
  ],
  captions: [{ bar: 1, text: '2021: up $12.0bn' }],
  caveat: ['Demo caveat.'], sources: [{ org: 'Demo', dataset: 'None' }], notes: [], takeaways: [],
};
