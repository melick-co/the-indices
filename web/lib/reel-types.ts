/**
 * Reel brief shape: a vertical news-style explainer generated from a finished story and handed
 * to an external video generator.
 *
 * The editorial promise is that every figure on screen resolves to a named, tiered source, so the
 * generator is never trusted with arithmetic. Chart values are traced back to the story's own
 * evidence here in code, and anything that cannot be traced is marked rather than quietly shipped.
 */

import type { ChartKind, ChartSeriesPoint, Story } from '@/lib/story-types';

export const REEL_FORMAT = {
  aspect: '9:16' as const,
  width: 1080,
  height: 1920,
  fps: 30,
};

/** A news read sits near this pace, which is what turns a duration into a word budget. */
export const WORDS_PER_SECOND = 2.6;

export const SCENE_SECONDS = { min: 3, max: 9 };
export const REEL_SECONDS = { min: 20, max: 75 };

/** Burned-in text has to survive a phone screen with platform chrome over it. */
export const ON_SCREEN_CHARS = 70;
export const LOWER_THIRD_CHARS = 48;

/**
 * Scene order carries the layered reveal from EDITORIAL.md: open on the familiar frame, shift it
 * one layer at a time, then close on the corrected frame and the number that holds it.
 */
export type ReelSceneKind =
  | 'cold_open'
  | 'frame'
  | 'layer'
  | 'turn'
  | 'one_number'
  | 'caveat'
  | 'sources';

export const SCENE_KINDS: ReelSceneKind[] = [
  'cold_open', 'frame', 'layer', 'turn', 'one_number', 'caveat', 'sources',
];

/** How the chart should animate on, so the reveal matches the narration beat. */
export type ReelReveal = 'all_at_once' | 'sequential' | 'swap';

export type ReelChartFrame = {
  kind: ChartKind;
  title?: string;
  /** Must name the publisher and the period the figures come from. */
  caption: string;
  series: ChartSeriesPoint[];
  alt_series?: ChartSeriesPoint[];
  primary_label?: string;
  alt_label?: string;
  reveal: ReelReveal;
  /** Set by validation when a value could not be traced to the story evidence. */
  unverified?: boolean;
  unverified_note?: string;
};

export type ReelScene = {
  id: string;
  kind: ReelSceneKind;
  seconds: number;
  /** Anchor read, Australian English. */
  narration: string;
  /** Burned-in headline text for the scene. */
  on_screen: string;
  /** News-style strap along the bottom. */
  lower_third?: string;
  chart?: ReelChartFrame;
  /** Direction for the generator, used for framing and for scenes with no chart to hold. */
  visual_prompt: string;
};

export type ReelStyle = {
  /** Presenter framing and delivery, e.g. a piece to camera in a spare studio. */
  presenter: string;
  /** Palette, typography and grid, so the reel reads as ours. */
  look: string;
  /** Delivery notes: pace, tone, what to avoid. */
  voice: string;
  /** Music and sound direction. */
  audio: string;
};

export type ReelSpec = {
  format: typeof REEL_FORMAT;
  style: ReelStyle;
  scenes: ReelScene[];
  total_seconds: number;
  /** One flat brief, for generators that take a single prompt rather than a scene list. */
  shot_list: string;
};

export type StoryReel = {
  storySlug: string;
  status: 'draft' | 'ready' | 'archived';
  spec: ReelSpec;
  warnings: string[];
  totalSeconds: number;
  generationNote: string;
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Words a scene of this length can carry at a news read pace. */
export function wordBudget(seconds: number): number {
  return Math.floor(seconds * WORDS_PER_SECOND);
}

function numbersIn(text: string): number[] {
  // Strips grouping commas so "1,234.5" reads as one number rather than two.
  const matches = text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/g);
  return (matches ?? []).map(Number).filter((n) => Number.isFinite(n));
}

/**
 * Every number the story itself puts on the record: chart series, evidence table cells, the
 * headline number and the prose. A reel may restate these and nothing else.
 */
export function collectStoryNumbers(story: Story): number[] {
  const found: number[] = [];

  for (const block of story.body?.blocks ?? []) {
    if (block.type === 'chart') {
      for (const p of block.series ?? []) found.push(p.value);
      for (const p of block.alt_series ?? []) found.push(p.value);
      if (block.caption) found.push(...numbersIn(block.caption));
      if (block.title) found.push(...numbersIn(block.title));
    } else if (block.type === 'layers') {
      for (const item of block.items) found.push(...numbersIn(item));
    } else {
      found.push(...numbersIn(block.text));
    }
  }

  const table = story.evidence?.table;
  if (table) {
    for (const row of table.rows) for (const cell of row) found.push(...numbersIn(cell));
    for (const head of table.head) found.push(...numbersIn(head));
  }
  for (const s of story.evidence?.sources ?? []) found.push(...numbersIn(s.period));

  found.push(...numbersIn(story.oneNumber?.value ?? ''));
  found.push(...numbersIn(story.oneNumber?.label ?? ''));
  found.push(...numbersIn(story.title));
  found.push(...numbersIn(story.hook));
  found.push(...numbersIn(story.caveat));

  return [...new Set(found)];
}

/** Rescalings that are a change of unit rather than a change of fact, e.g. 0.088 shown as 8.8%. */
const SCALES = [1, 100, 0.01, 1000, 0.001, 1e6, 1e-6];

/**
 * True when `value` restates one of the story's own numbers. Rounding is allowed, since a reel
 * rounds to what survives scrutiny, as is a change of unit.
 */
export function tracesToStory(value: number, known: number[]): boolean {
  return known.some((k) =>
    SCALES.some((scale) => {
      const target = k * scale;
      const tolerance = Math.max(0.05, Math.abs(target) * 0.01);
      return Math.abs(value - target) <= tolerance;
    }),
  );
}

function checkChart(
  chart: ReelChartFrame,
  known: number[],
  sceneRef: string,
  warnings: string[],
): ReelChartFrame {
  const untraced: number[] = [];
  for (const p of [...(chart.series ?? []), ...(chart.alt_series ?? [])]) {
    if (!tracesToStory(p.value, known)) untraced.push(p.value);
  }

  if (!chart.caption?.trim()) {
    warnings.push(`${sceneRef}: chart has no source caption`);
  }
  if (chart.kind === 'rank_swap' && !(chart.alt_series ?? []).length) {
    warnings.push(`${sceneRef}: rank_swap chart needs alt_series to swap against`);
  }
  if (!(chart.series ?? []).length) {
    warnings.push(`${sceneRef}: chart has no series`);
  }

  if (!untraced.length) return chart;

  const note = `Not traceable to the story evidence: ${untraced.join(', ')}`;
  warnings.push(`${sceneRef}: ${note}`);
  return { ...chart, unverified: true, unverified_note: note };
}

/**
 * Checks a generated reel against the story it came from and against the format's limits.
 *
 * Returns the scenes with untraceable charts marked, plus every problem found. Warnings are
 * reported rather than thrown so the editor sees the whole brief and what is wrong with it; the
 * ready gate is what stops a flawed reel from shipping.
 */
export function validateReel(
  scenes: ReelScene[],
  story: Story,
): { scenes: ReelScene[]; warnings: string[] } {
  const warnings: string[] = [];
  const known = collectStoryNumbers(story);

  if (!scenes.length) return { scenes, warnings: ['Reel has no scenes'] };

  const checked = scenes.map((scene, i) => {
    const ref = `Scene ${i + 1} (${scene.kind})`;

    if (scene.seconds < SCENE_SECONDS.min || scene.seconds > SCENE_SECONDS.max) {
      warnings.push(
        `${ref}: ${scene.seconds}s is outside the ${SCENE_SECONDS.min}-${SCENE_SECONDS.max}s range`,
      );
    }

    const words = wordCount(scene.narration);
    const budget = wordBudget(scene.seconds);
    if (words > budget) {
      warnings.push(
        `${ref}: narration is ${words} words but ${scene.seconds}s only carries about ${budget}`,
      );
    }
    if (!words) warnings.push(`${ref}: no narration`);

    if (scene.on_screen.length > ON_SCREEN_CHARS) {
      warnings.push(
        `${ref}: on-screen text is ${scene.on_screen.length} chars, over the ${ON_SCREEN_CHARS} that fit`,
      );
    }
    if (scene.lower_third && scene.lower_third.length > LOWER_THIRD_CHARS) {
      warnings.push(
        `${ref}: lower third is ${scene.lower_third.length} chars, over the ${LOWER_THIRD_CHARS} that fit`,
      );
    }

    // The charter bans em dashes, and burned-in text is the most visible place they show up.
    if (/[—–]/.test(`${scene.narration} ${scene.on_screen} ${scene.lower_third ?? ''}`)) {
      warnings.push(`${ref}: contains an em or en dash, which the charter rules out`);
    }

    // Any number the narration or burned-in text asserts is held to the same standard as a chart.
    for (const n of numbersIn(`${scene.narration} ${scene.on_screen}`)) {
      if (!tracesToStory(n, known)) {
        warnings.push(`${ref}: states ${n}, which is not traceable to the story evidence`);
      }
    }

    if (!scene.visual_prompt?.trim()) warnings.push(`${ref}: no visual direction`);

    return scene.chart
      ? { ...scene, chart: checkChart(scene.chart, known, ref, warnings) }
      : scene;
  });

  const kinds = checked.map((s) => s.kind);
  if (kinds[0] !== 'cold_open') warnings.push('Reel should open on a cold_open scene');
  if (kinds[kinds.length - 1] !== 'sources') warnings.push('Reel should close on a sources scene');
  for (const required of ['one_number', 'caveat', 'sources'] as ReelSceneKind[]) {
    const n = kinds.filter((k) => k === required).length;
    if (n === 0) warnings.push(`Reel is missing its ${required} scene`);
    if (n > 1) warnings.push(`Reel has ${n} ${required} scenes, expected one`);
  }
  if (kinds.filter((k) => k === 'layer').length < 2) {
    warnings.push('Reel needs at least two layer scenes to build the reveal');
  }
  const caveatAt = kinds.indexOf('caveat');
  const sourcesAt = kinds.indexOf('sources');
  if (caveatAt >= 0 && sourcesAt >= 0 && caveatAt > sourcesAt) {
    warnings.push('The caveat should land before the sources card');
  }
  if (!checked.some((s) => s.chart)) {
    warnings.push('No scene carries a chart, so nothing on screen validates the finding');
  }

  const total = checked.reduce((sum, s) => sum + s.seconds, 0);
  if (total < REEL_SECONDS.min || total > REEL_SECONDS.max) {
    warnings.push(
      `Reel runs ${total}s, outside the ${REEL_SECONDS.min}-${REEL_SECONDS.max}s a reel holds`,
    );
  }

  // The sources card is the receipt, so it has to name real publishers from the story.
  const orgs = new Set((story.evidence?.sources ?? []).map((s) => s.org).filter(Boolean));
  const sourcesScene = checked.find((s) => s.kind === 'sources');
  if (sourcesScene && orgs.size) {
    const named = [...orgs].some((org) =>
      `${sourcesScene.on_screen} ${sourcesScene.narration}`.toLowerCase().includes(org.toLowerCase()),
    );
    if (!named) {
      warnings.push(
        `Sources card names none of the story's publishers (${[...orgs].join(', ')})`,
      );
    }
  }

  return { scenes: checked, warnings };
}

/**
 * The scene list flattened into one brief. Built here rather than asked of the model so it can
 * never drift from the scenes that were actually validated.
 */
export function buildShotList(scenes: ReelScene[], style: ReelStyle, story: Story): string {
  const lines: string[] = [
    `VERTICAL NEWS EXPLAINER REEL — ${REEL_FORMAT.width}x${REEL_FORMAT.height} (${REEL_FORMAT.aspect}), ${REEL_FORMAT.fps}fps`,
    `Story: ${story.title}`,
    `Total runtime: ${scenes.reduce((s, x) => s + x.seconds, 0)}s across ${scenes.length} scenes`,
    '',
    `PRESENTER: ${style.presenter}`,
    `LOOK: ${style.look}`,
    `VOICE: ${style.voice}`,
    `AUDIO: ${style.audio}`,
    '',
    'SCENES',
  ];

  scenes.forEach((scene, i) => {
    lines.push('', `${i + 1}. [${scene.kind.toUpperCase()}] ${scene.seconds}s`);
    lines.push(`   VO: ${scene.narration}`);
    lines.push(`   ON SCREEN: ${scene.on_screen}`);
    if (scene.lower_third) lines.push(`   LOWER THIRD: ${scene.lower_third}`);
    lines.push(`   VISUAL: ${scene.visual_prompt}`);
    if (scene.chart) {
      const c = scene.chart;
      const pts = c.series.map((p) => `${p.label} ${p.value}`).join('; ');
      lines.push(`   CHART: ${c.kind}, reveal ${c.reveal}${c.title ? `, titled "${c.title}"` : ''}`);
      lines.push(`   CHART DATA: ${pts}`);
      if (c.alt_series?.length) {
        const alt = c.alt_series.map((p) => `${p.label} ${p.value}`).join('; ');
        lines.push(`   CHART ALT (${c.alt_label ?? 'alternate'}): ${alt}`);
      }
      lines.push(`   CHART SOURCE: ${c.caption}`);
    }
  });

  return lines.join('\n');
}
