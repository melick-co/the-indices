/**
 * Draft this week's Rub (Column 8). It never publishes: an editor approves it at /foundry/rub.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/rub-draft.ts            # scheduled: skips if a column is already waiting
 *   npx tsx --import ./scripts/node-shims.mjs scripts/rub-draft.ts --force    # draft one now (Foundry button, workflow dispatch)
 *   npx tsx --import ./scripts/node-shims.mjs scripts/rub-draft.ts --dry-run  # print the draft and its check; save nothing
 *
 * 1. A peg: what is trending this week (trending_snapshots) and the latest published stories, leaving out subjects
 *    the existing columns already cover (their keywords).
 * 2. A word or number people use loosely, and the stored series (metrics catalogue) that settle it.
 * 3. One column in the house voice, with the published columns as style exemplars and the series' stored readings
 *    as the only admissible figures.
 * 4. The strict check (lib/rub-check.ts): column rules, the stories' figure check and claim audit. Fails closed.
 *    One revision round feeds the issues back to the model, then it is checked again from scratch.
 * 5. Saved as 'pending' (passed) or 'draft' (failed, with its issues). Never 'published'.
 *
 * Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY.
 */
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import { RUBS } from '@/content/the-rub/seed';
import { createClient } from '@/lib/supabase-server';
import { loadTrendingPage, type TrendingPageData } from '@/lib/trending-topics';
import { CHARTER } from '@/lib/research-agent';
import { strictCheckRub } from '@/lib/rub-check';
import {
  CLOSING_LINE, MAX_PARAGRAPHS, MAX_WORDS, MIN_PARAGRAPHS, MIN_WORDS, slugify, statusFor, type RubCheck,
} from '@/lib/rub-rules';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force') || dryRun;
const SITE = 'https://caveat.news';

type Existing = { slug: string; title: string; keywords: string[]; status: string; created_at?: string; paragraphs?: unknown; published?: string | null };
type Plan = {
  peg: string; peg_kind: 'trend' | 'story'; story_slug?: string | null; word: string; why_loose: string;
  metric_ids: string[]; keywords: string[]; angle: string; figure_metric_id?: string;
};
type Draft = { title: string; slug?: string; keywords?: string[]; paragraphs: string[] };

// Set in main() once the environment is checked (the service client needs SUPABASE_SERVICE_ROLE_KEY).
let db: ReturnType<typeof createClient>;

function trendTopics(t: TrendingPageData) {
  const out: { topic: string; window: string; url?: string | null; headlines: string[] }[] = [];
  const add = (s: TrendingPageData['rss_day'], window: string, n: number) => {
    for (const x of (s?.topics ?? []).slice(0, n)) {
      out.push({ topic: x.topic, window, url: x.url ?? x.sample_headlines?.[0]?.link ?? null, headlines: (x.sample_headlines ?? []).slice(0, 2).map((h) => h.title) });
    }
  };
  add(t.rss_week, 'week (news)', 12);
  add(t.x_au_week, 'week (X, Australia)', 6);
  add(t.rss_day, 'today (news)', 6);
  return out;
}

async function loadExisting(): Promise<{ rows: Existing[]; tableReady: boolean }> {
  const { data, error } = await db.from('rubs').select('slug, title, keywords, status, created_at, paragraphs, published').order('created_at', { ascending: false });
  if (error) return { rows: RUBS.map((r) => ({ ...r, status: 'published' })), tableReady: false };
  return { rows: (data ?? []) as Existing[], tableReady: true };
}

async function recentStories() {
  const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const { data } = await db.from('stories').select('slug, title, hook, published').eq('status', 'published').gte('published', since)
    .order('published', { ascending: false }).limit(12);
  return (data ?? []) as { slug: string; title: string; hook: string; published: string }[];
}

async function metricCatalogue() {
  const { data } = await db.from('metrics').select('metric_id, name, unit, source_org, source_tier, period');
  return ((data ?? []) as { metric_id: string; name: string; unit: string; source_org: string; source_tier: number; period: string }[])
    .filter((m) => m.source_tier === 1 || m.source_tier === 2);
}

const exemplars = (rows: Existing[]) => {
  const published = rows.filter((r) => r.status === 'published' && Array.isArray(r.paragraphs));
  const pool = published.length ? published : RUBS.map((r) => ({ ...r, status: 'published' }));
  return pool.slice(0, 6).map((r) => `<column title="${r.title}">\n${(r.paragraphs as string[]).join('\n\n')}\n</column>`).join('\n\n');
};

const RULES = `COLUMN RULES (all are checked; a column that breaks one is held):
- ${MIN_PARAGRAPHS} to ${MAX_PARAGRAPHS} paragraphs, ${MIN_WORDS} to ${MAX_WORDS} words in total (aim for about 150, like the
  published columns), then a final paragraph that is exactly:
  "${CLOSING_LINE}"
- A contrarian title of 14 words or fewer, usually two short sentences: the loose claim, then the correction.
- Measured, pedantic, dry; the voice of a fussy engineer-presenter (James May) who likes the word "precise". First
  person is allowed. No exclamation marks, no "ladies and gentlemen", no "Now look".
- It corrects one word or number people use loosely, and lands on a checkable caveat.
- Every figure, change, rank, record or comparison must come from the REFERENCE below, by simple arithmetic at most.
  Name the period. Fewer figures is better than an unsupported one; a column may make its point with one number.
- Evergreen: it should still read correctly in a year. Mention the news peg lightly, not as a news report.
- Australian English. No em dashes or en dashes used as dashes. No footnote markers.`;

async function plan(rows: Existing[], trends: ReturnType<typeof trendTopics>, stories: Awaited<ReturnType<typeof recentStories>>, metrics: Awaited<ReturnType<typeof metricCatalogue>>): Promise<Plan> {
  const covered = [...new Set(rows.filter((r) => r.status !== 'rejected').flatMap((r) => r.keywords ?? []))];
  const prompt = `${CHARTER}

You are choosing this week's subject for The Rub, Column 8 of The Caveat: a short evergreen column that takes a word
or number Australians use loosely and pins it down with a stored official series.

<trending_this_week>
${JSON.stringify(trends)}
</trending_this_week>

<recent_caveat_stories>
${JSON.stringify(stories.map((s) => ({ slug: s.slug, title: s.title, hook: s.hook, published: s.published })))}
</recent_caveat_stories>

<already_covered_keywords>
${covered.join(', ')}
</already_covered_keywords>

<metrics_catalogue>
${metrics.map((m) => `- ${m.metric_id}: ${m.name} (${m.unit}, ${m.source_org}, ${m.period})`).join('\n')}
</metrics_catalogue>

Pick ONE peg from the trending topics or recent stories (prefer what is trending this week). Then pick a word or number
in that conversation that people use loosely (a level read as a change, a total read per person, a nominal figure
read as real, an average read as typical, a policy rate read as a household rate, and so on). Avoid subjects the
covered keywords already handle. Choose 1 to 3 metric_ids from the catalogue (exact ids) whose stored Australian
readings settle the point.

The loose number itself must be measured by one of those series: the column may only state figures our series hold, so
a peg whose number we cannot check (an insurer's premium survey, a private price index, a poll) is no use however hot
it is. Name that series as figure_metric_id. If no trending subject has its number in the catalogue, take a recent
Caveat story instead, or a subject from the catalogue that people misread all the time (a level read as a change, a
total read per person, nominal read as real).

Respond ONLY with JSON:
{"peg":"the topic as people are discussing it","peg_kind":"trend|story","figure_metric_id":"the catalogue series that measures the loose number itself","story_slug":"slug if the peg is a Caveat story, else null","word":"the loose word or number","why_loose":"one sentence","metric_ids":["..."],"keywords":["4-7 lowercase keywords for matching future trends"],"angle":"two sentences: the correction and the caveat it lands on"}`;
  const p = await callClaudeJson(prompt, { label: 'rub plan', maxTokens: 2000 }) as Plan;
  const known = new Set(metrics.map((m) => m.metric_id));
  p.metric_ids = (p.metric_ids ?? []).filter((id) => known.has(id)).slice(0, 3);
  if (!p.metric_ids.length) throw new Error(`rub plan: none of the chosen series is in the metrics catalogue (${JSON.stringify(p)})`);
  // The loose number has to be one our series measure; otherwise the column can only gesture at it and fails the check.
  const figure = p.figure_metric_id;
  if (!figure || !known.has(figure)) throw new Error(`rub plan: the loose number "${p.word}" is not measured by any stored series; no draft this week`);
  if (!p.metric_ids.includes(figure)) p.metric_ids = [figure, ...p.metric_ids].slice(0, 3);
  return p;
}

async function write(p: Plan, rows: Existing[], reference: unknown): Promise<Draft> {
  const prompt = `${CHARTER}

You write The Rub, Column 8 of The Caveat. Here are published columns, for voice and shape only (do not reuse their
subjects or lines):

${exemplars(rows)}

This week's brief:
<brief>
${JSON.stringify(p)}
</brief>

<reference>
${JSON.stringify(reference)}
</reference>

The reference holds, per metric_id, Australia's latest reading and earlier readings (newest first). It is the only
admissible source for any figure.

${RULES}

Respond ONLY with JSON:
{"title":"...","keywords":["..."],"paragraphs":["...","...","...","${CLOSING_LINE}"]}`;
  return await callClaudeJson(prompt, { label: 'rub draft', maxTokens: 4000 }) as Draft;
}

async function revise(d: Draft, issues: string[], reference: unknown): Promise<Draft> {
  const prompt = `${CHARTER}

A draft of The Rub (Column 8 of The Caveat) failed its pre-publish checks. Rewrite it so it passes, keeping its
subject, voice and point.

<findings>
${issues.map((i) => `- ${i}`).join('\n')}
</findings>

<reference>
${JSON.stringify(reference)}
</reference>

<draft>
${JSON.stringify(d)}
</draft>

${RULES}
- Correct a wrong figure to the reference value, or drop the figure and make the point in words. Do not add figures
  from memory.

Respond ONLY with the full column as JSON: {"title":"...","keywords":["..."],"paragraphs":[...]}`;
  return await callClaudeJson(prompt, { label: 'rub revision', maxTokens: 4000 }) as Draft;
}

const tidy = (d: Draft): Draft => ({
  title: String(d.title ?? '').trim(),
  keywords: [...new Set((d.keywords ?? []).map((k) => String(k).toLowerCase().trim()).filter(Boolean))],
  paragraphs: (Array.isArray(d.paragraphs) ? d.paragraphs : []).map((x) => String(x ?? '').trim()).filter(Boolean),
});

function uniqueSlug(title: string, taken: Set<string>) {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is not set: the Rub cannot be drafted or checked.');
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  db = createClient();
  const { rows, tableReady } = await loadExisting();
  if (!tableReady && !dryRun) throw new Error('The rubs table is not there yet: run agent/supabase/47_the_rub.sql in the Supabase SQL editor.');
  if (!force) {
    const week = Date.now() - 6 * 864e5;
    const waiting = rows.find((r) => r.status === 'pending' && r.created_at && Date.parse(r.created_at) > week);
    if (waiting) {
      console.log(`A column is already waiting for approval ("${waiting.title}", /foundry/rub). Nothing drafted.`);
      return;
    }
  }

  const [trending, stories, metrics] = await Promise.all([loadTrendingPage(), recentStories(), metricCatalogue()]);
  const trends = trendTopics(trending);
  if (!metrics.length) throw new Error('The metrics catalogue is empty: nothing could settle a column.');
  // A peg whose number no stored series measures is refused; one more try before giving up for the week.
  const p = await plan(rows, trends, stories, metrics).catch(async (e) => {
    console.log(`${e instanceof Error ? e.message : e}; planning again.`);
    return plan(rows, trends, stories, metrics);
  });
  console.log(`Peg: ${p.peg} (${p.peg_kind}). Loose word: ${p.word}. Series: ${p.metric_ids.join(', ')}`);
  const reference = await buildReference(db, p.metric_ids);

  let draft = tidy(await write(p, rows, reference));
  let check: RubCheck = await strictCheckRub(db, draft, p.metric_ids);
  const rounds: { issues: string[] }[] = [];
  if (!check.ok) {
    console.log(`Check failed (${check.issues.length}): ${check.issues.join(' | ')}\nRevising once.`);
    rounds.push({ issues: check.issues });
    draft = tidy(await revise(draft, check.issues, reference));
    check = await strictCheckRub(db, draft, p.metric_ids);
  }

  const status = statusFor(check);
  const story = p.story_slug ? stories.find((s) => s.slug === p.story_slug) : null;
  const trend = trends.find((t) => t.topic === p.peg);
  const source = {
    kind: p.peg_kind,
    peg: p.peg,
    word: p.word,
    why_loose: p.why_loose,
    angle: p.angle,
    story: story ? { slug: story.slug, title: story.title, url: `${SITE}/stories/${story.slug}` } : null,
    trend: trend ?? null,
    links: [story ? `${SITE}/stories/${story.slug}` : null, trend?.url ?? null].filter(Boolean),
    trending_period_end: trending.period_end,
    revisions: rounds,
    drafted_at: new Date().toISOString(),
  };
  const keywords = draft.keywords?.length ? draft.keywords : p.keywords.map((k) => k.toLowerCase());
  const slug = uniqueSlug(draft.title, new Set(rows.map((r) => r.slug)));
  const row = { slug, title: draft.title, keywords, peg: p.peg, paragraphs: draft.paragraphs, metric_ids: p.metric_ids, status, check, source };

  console.log(`\n${draft.title}\n\n${draft.paragraphs.join('\n\n')}\n`);
  console.log(`Check: ${check.ok ? 'passed' : 'failed'}${check.audited ? ' (claim audit ran)' : ' (claim audit did not run)'}`);
  for (const i of check.issues) console.log(`  - ${i}`);
  for (const w of check.warnings) console.log(`  (note) ${w}`);
  if (dryRun) {
    console.log(`\nDry run: would save /the-rub/${slug} as '${status}'. Nothing saved.`);
    return;
  }
  const { error } = await db.from('rubs').insert(row);
  if (error) throw new Error(`Could not save the draft: ${error.message}`);
  console.log(`\nSaved as '${status}': review it at ${SITE}/foundry/rub. It goes live only when an editor approves it.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
