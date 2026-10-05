import type { ReelChartFrame, ReelScene, ReelStyle } from '@/lib/reel-types';

/** Runway promptText cap (UTF-16 code units) on gen4_image / gen4.5. */
export const RUNWAY_PROMPT_MAX = 1000;

export type RunwayPromptKind = 'still' | 'chart' | 'clip' | 'chart_video';

function seriesLine(chart: ReelChartFrame): string {
  const primary = chart.series
    .map((p) => `${p.label} ${p.value}${p.highlight ? ' (highlight)' : ''}`)
    .join('; ');
  const alt = chart.alt_series?.length
    ? ` | alt (${chart.alt_label ?? 'alternate'}): ${chart.alt_series
      .map((p) => `${p.label} ${p.value}${p.highlight ? ' (highlight)' : ''}`)
      .join('; ')}`
    : '';
  return `${chart.primary_label ? `${chart.primary_label}: ` : ''}${primary}${alt}`;
}

/**
 * The locked chart block. This is packed first and is never dropped: the
 * renderer may not invent, round, or recompute figures.
 */
export function chartLockBlock(chart: ReelChartFrame): string {
  return [
    'CHART TO RENDER EXACTLY — do not alter, round, or compute new values',
    `kind: ${chart.kind} · reveal ${chart.reveal}${chart.title ? ` · titled "${chart.title}"` : ''}`,
    `caption: ${chart.caption}`,
    `series: ${seriesLine(chart)}`,
  ].join('\n');
}

function clipUtf16(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const breakAt = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf(' '));
  return (breakAt > max * 0.6 ? sliced.slice(0, breakAt) : sliced).trimEnd();
}

function pack(keep: string, optional: string[], max: number): string {
  let out = keep;
  for (const part of optional) {
    if (!part) continue;
    const next = out ? `${out}\n${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

/**
 * The rule a picture is made under. The cut (lib/reel-cut.ts) burns the on-screen line, the lower
 * third and every chart itself, so a picture that carries its own lettering ends up with two
 * versions of the text on top of each other, one of them the model's misspelling. Measured on the
 * second real cut, 5 October 2026: "Rents alcoay falling", "Sepulibution", a chart behind a chart.
 */
export const NO_TEXT_RULE =
  'NO TEXT OF ANY KIND in the frame: no lettering, captions, titles, straps, numbers, charts, graphs, '
  + 'logos, screens or interface. Titles and charts are added afterwards over this picture. '
  + 'Keep the top third and bottom quarter of the frame quiet (plain wall, soft background).';

/**
 * Whether a picture was made under the no-text rule. Earlier pictures were prompted with the
 * script and came back with the model's own lettering; a cut then burned the real text on top, and
 * a clip animated from one carries the lettering into the moving picture. Anything that puts a
 * picture behind text, or animates one, checks this first.
 */
export function madeWithoutText(row: { prompt_text: string | null }): boolean {
  return Boolean(row.prompt_text && row.prompt_text.includes(NO_TEXT_RULE.slice(0, 24)));
}

/**
 * Style notes without the clauses about type, straps and charts, which a generator reads as things
 * to draw. Split on sentence and clause ends so "the charts move, not the camera" goes while
 * "Presenter holds still" stays.
 */
function pictureNotes(text: string): string {
  return text
    .split(/(?<=[.;])\s+/)
    .filter((clause) => !/mono|figure|label|strap|chart|caption|tabular|letter|text|third/i.test(clause))
    .map((clause) => clause.replace(/;$/, '.'))
    .join(' ');
}

/**
 * A prompt for the picture behind a scene (a still, or a clip animated from it). It carries the
 * visual direction, the presenter and the palette, and none of the script: the words are not the
 * generator's to draw.
 */
function picturePrompt(
  opts: { scene: ReelScene; storyTitle: string; style: ReelStyle; kind: RunwayPromptKind },
  max: number,
): string {
  const scene = opts.scene;
  const header = [
    `Caveat vertical news explainer, 9:16.`,
    `Story: ${opts.storyTitle}`,
    `Shot ${scene.kind.replace('_', ' ')} · ${scene.seconds}s`,
  ].join(' ');
  const motion = opts.kind === 'clip'
    ? 'Animate this first frame. Subtle motion only: the presenter holds, the camera holds, nothing is added to the frame.'
    : 'STILL FRAME, photographic, raw off-white paper tones.';
  const presenterNotes = pictureNotes(opts.style.presenter);
  const presenter = /^single presenter/i.test(presenterNotes)
    ? `PRESENTER: ${presenterNotes}`
    : `PRESENTER: Single presenter, piece to camera, framed centre. ${presenterNotes}`;
  const keep = pack(header, [NO_TEXT_RULE, `SCENE: ${scene.visual_prompt}`], max);
  return clipUtf16(
    pack(keep, [motion, presenter, `LOOK: ${pictureNotes(opts.style.look)}`], max),
    max,
  );
}

/**
 * One Runway prompt per shot, under the 1000 UTF-16-unit cap. Chart values
 * and the locked VO are packed first so truncation can only eat look notes.
 * Pictures (still, clip) take the no-text form above; chart shots keep the lock.
 */
export function compactRunwayPrompt(opts: {
  scene: ReelScene;
  storyTitle: string;
  style: ReelStyle;
  kind: RunwayPromptKind;
  maxChars?: number;
}): string {
  const max = opts.maxChars ?? RUNWAY_PROMPT_MAX;
  const scene = opts.scene;
  if (opts.kind === 'still' || opts.kind === 'clip') return picturePrompt(opts, max);
  const chart = scene.chart;
  const lock = chart ? chartLockBlock(chart) : '';

  const header = [
    `Caveat vertical news explainer, 9:16.`,
    `Story: ${opts.storyTitle}`,
    `Shot ${scene.kind.replace('_', ' ')} · ${scene.seconds}s`,
  ].join(' ');

  const lockedScript = [
    'LOCKED SCRIPT — do not rewrite',
    `VO: ${scene.narration}`,
    `ON SCREEN: ${scene.on_screen}`,
    scene.lower_third ? `LOWER THIRD: ${scene.lower_third}` : '',
  ].filter(Boolean).join('\n');

  const figuresRule = 'Do not invent, round up, or compute new figures. Use every value exactly as given. Do not redraw or change numbers already on screen.';

  let motion: string;
  if (opts.kind === 'chart') {
    motion = [
      'STILL FRAME of the chart on Swiss editorial grid, raw off-white paper, charcoal ink, IBM Plex Mono tabular figures, hairline rules, source caption burned in. No 3D, no gradients, no invented labels.',
      scene.visual_prompt,
    ].filter(Boolean).join(' ');
  } else if (opts.kind === 'chart_video') {
    motion = [
      'Animate THIS chart only. Camera holds. Bars or rank rows reveal to the values already printed. Do not change, redraw, or invent numbers. Soft transient on each reveal. Presenter still if visible.',
      `Reveal: ${chart?.reveal ?? 'sequential'}.`,
      scene.visual_prompt,
    ].filter(Boolean).join(' ');
  } else if (opts.kind === 'clip') {
    motion = [
      'Hold this first frame. Subtle motion only. Presenter still; charts move, not the camera. Do not change burned-in text or figures.',
      scene.visual_prompt,
    ].filter(Boolean).join(' ');
  } else {
    motion = [
      'STILL FRAME. Swiss editorial grid on raw off-white paper, charcoal ink, IBM Plex Mono, headroom for burned-in text, lower third at the bottom.',
      scene.visual_prompt,
    ].filter(Boolean).join(' ');
  }

  const look = `LOOK: ${opts.style.look} PRESENTER: ${opts.style.presenter}`;

  const keep = pack(
    header,
    [lock, lockedScript, figuresRule],
    max,
  );

  return clipUtf16(pack(keep, [motion, look], max), max);
}
