import type { Race } from '@/lib/visuals-race';

/** The bar-race video: one composition, three shapes. */
export const RACE_COMPOSITION_ID = 'BarRace';
export const RACE_FPS = 30;
export type RaceFormat = '9:16' | '16:9' | '1:1';
export const RACE_SIZE: Record<RaceFormat, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};
export type RaceProps = { race: Race; format: RaceFormat; musicFile: string | null };

export const INTRO_SECONDS = 2.5;
export const OUTRO_SECONDS = 3.5;
/** The final standings hold before the end card, so a change on the last period has time to show. */
export const HOLD_SECONDS = 2.5;
/** Seconds per period: about 30 seconds of racing, never faster than 0.5s or slower than 1.4s a step (a 66-year race runs about 41s in all). */
export const stepSeconds = (frames: number) => Math.min(1.4, Math.max(0.5, 30 / Math.max(1, frames - 1)));
/** The stacked ending: columns build left to right, then the finished chart holds as the end frame. */
export const stackBuildSeconds = (frames: number) => Math.min(8, Math.max(4, frames * 0.2));
export const STACK_HOLD_SECONDS = 5;
export const STACK_FADE_SECONDS = 0.6;
/** When the race's own part ends (the stacked ending, or the end card, starts here). */
export const raceEndSeconds = (r: Race) => INTRO_SECONDS + stepSeconds(r.frames.length) * (r.frames.length - 1) + HOLD_SECONDS;
export const raceSeconds = (r: Race) => raceEndSeconds(r) + (r.stack ? stackBuildSeconds(r.frames.length) + STACK_HOLD_SECONDS : OUTRO_SECONDS);
export const raceFrames = (r: Race) => Math.round(raceSeconds(r) * RACE_FPS);

export const DEMO_RACE: Race = {
  key: 'race:demo', title: 'Demo race', subtitle: 'Made-up values for the composition preview', unit: 'persons', topN: 5,
  labels: { a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot' },
  frames: [
    { period: '2020', values: { a: 100, b: 80, c: 60, d: 40, e: 20, f: 10 } },
    { period: '2021', values: { a: 110, b: 120, c: 70, d: 45, e: 30, f: 50 } },
    { period: '2022', values: { a: 115, b: 140, c: 90, d: 60, e: 55, f: 95 } },
  ],
  captions: [{ frame: 1, text: '2021: Bravo overtakes Alpha for first place' }], takeaways: [], source: { org: 'Demo', dataset: 'None' },
};
