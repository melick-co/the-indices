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
 * One Runway prompt per shot, under the 1000 UTF-16-unit cap. Chart values
 * and the locked VO are packed first so truncation can only eat look notes.
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
