import type { SupabaseClient } from '@supabase/supabase-js';
import { numbersIn } from '../../agent/scripts/lib/figures.mjs';
import { loadObservations } from '@/lib/chart-from-data';
import type { StoryBody, StoryChartBlock, StoryEvidence, StoryOneNumber } from '@/lib/story-types';

/**
 * Publish gate for generated articles: every figure a reader sees must trace to
 * observations in the store for the story's metrics. Allowed besides the stored
 * values (with rounding and unit rescaling): changes between two points in
 * Australia's own series, Australia's gap to a peer in the same period, and
 * Australia's rank among peers. Anything else holds the story as a draft.
 */

const HOME = 'AUS';
// Pairwise changes are taken over Australia's most recent points only; long
// monthly series would otherwise produce hundreds of thousands of candidates.
const PAIR_WINDOW = 60;

/**
 * Allowed values, indexed for fast lookup. Close to the revision guard's rule:
 * within about 0.05 (one-decimal rounding) or equal after rounding to an integer,
 * against each value and its thousand/million/billion/percent rescalings.
 * Values arrive as numbers; signs are dropped because numbersIn drops them.
 */
class Allowed {
  private tenths = new Set<number>();
  private ints = new Set<number>();
  add(values: Iterable<number>) {
    for (const raw of values) {
      if (!Number.isFinite(raw)) continue;
      const v = Math.abs(raw);
      for (const a of [v, v / 1e3, v / 1e6, v / 1e9, v * 100]) {
        this.tenths.add(Math.round(a * 20));
        this.ints.add(Math.round(a));
      }
    }
  }
  has(n: number) {
    if (Number.isInteger(n) && this.ints.has(n)) return true;
    const k = Math.round(n * 20);
    return this.tenths.has(k) || this.tenths.has(k - 1) || this.tenths.has(k + 1);
  }
}

export type CheckableStory = {
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  one_number?: StoryOneNumber | null;
  evidence?: StoryEvidence | null;
  body: StoryBody;
};

export type FactCheck = {
  ok: boolean;
  issues: string[];
  unsupported: Array<{ where: string; value: number }>;
};

type Obs = { entity: string; period: string; value: number };

/** Values a reader could fairly derive from one metric's observations. */
function derivedFrom(obs: Obs[]): number[] {
  const out: number[] = [];
  const home = obs.filter((o) => o.entity === HOME).sort((a, b) => a.period.localeCompare(b.period)).slice(-PAIR_WINDOW);
  for (let i = 0; i < home.length; i++) {
    for (let j = i + 1; j < home.length; j++) {
      const a = home[i].value;
      const b = home[j].value;
      out.push(Math.abs(b - a));
      if (a) out.push(Math.abs((b / a - 1) * 100));
    }
  }
  const byPeriod = new Map<string, Obs[]>();
  for (const o of obs) byPeriod.set(o.period, [...(byPeriod.get(o.period) ?? []), o]);
  for (const rows of byPeriod.values()) {
    const me = rows.find((r) => r.entity === HOME);
    if (!me || rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    out.push(sorted.indexOf(me) + 1, rows.length);
    for (const r of rows) if (r !== me) out.push(Math.abs(me.value - r.value));
  }
  return out;
}

function storyTexts(story: CheckableStory): Array<{ where: string; text: string }> {
  const out = [
    { where: 'kicker', text: story.kicker },
    { where: 'headline', text: story.title },
    { where: 'hook', text: story.hook },
    { where: 'caveat', text: story.caveat },
  ];
  if (story.one_number) out.push({ where: 'one number', text: `${story.one_number.value} ${story.one_number.label}` });
  story.body.blocks.forEach((b, i) => {
    if (b.type === 'layers') b.items.forEach((t, k) => out.push({ where: `layer ${i + 1}.${k + 1}`, text: t }));
    else if (b.type === 'chart') out.push({ where: `chart ${i + 1} title`, text: (b as StoryChartBlock).title ?? '' });
    else if ('text' in b) out.push({ where: `${b.type} ${i + 1}`, text: b.text });
  });
  for (const [r, row] of (story.evidence?.table?.rows ?? []).entries()) {
    out.push({ where: `evidence row ${r + 1}`, text: row.join(' | ') });
  }
  return out;
}

export async function factCheckStory(
  db: SupabaseClient, story: CheckableStory, metricIds: string[],
): Promise<FactCheck> {
  const issues: string[] = [];
  const ids = [...new Set(metricIds.filter(Boolean))];
  if (!ids.length) issues.push('story is not linked to any stored metric');

  const allowed = new Allowed();
  for (const id of ids) {
    const obs = await loadObservations(db, id);
    if (!obs.length) issues.push(`metric ${id} has no observations`);
    allowed.add(obs.map((o) => o.value));
    allowed.add(derivedFrom(obs));
  }

  const unsupported: FactCheck['unsupported'] = [];
  for (const { where, text } of storyTexts(story)) {
    for (const n of numbersIn(text)) {
      if (!allowed.has(n)) unsupported.push({ where, value: n });
    }
  }
  for (const u of unsupported) issues.push(`${u.where}: ${u.value} is not in the stored data`);

  const charts = story.body.blocks.filter((b): b is StoryChartBlock => b.type === 'chart');
  if (!charts.length) issues.push('no chart');
  for (const c of charts) if (!c.bound) issues.push(`chart "${c.title ?? c.kind}" was not built from stored data`);

  for (const s of story.evidence?.sources ?? []) {
    if (s.tier !== 1 && s.tier !== 2) issues.push(`source "${s.metric}" is tier ${s.tier}; headline claims need tier 1 or 2`);
  }

  return { ok: issues.length === 0, issues, unsupported };
}
