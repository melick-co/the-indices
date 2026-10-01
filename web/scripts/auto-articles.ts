/**
 * Daily auto-articles: turn the best pitches into broadsheet articles.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/auto-articles.ts            # run (from web/)
 *   npx tsx --import ./scripts/node-shims.mjs scripts/auto-articles.ts --dry-run  # list only, change nothing
 *   ... --no-publish   # write and check everything, but leave articles as drafts
 *   ... --pitch=<id>   # only these pitches (repeatable, or AUTO_ARTICLE_PITCHES); ignores the retry window and
 *                      # rewrites an existing draft, but never touches a published story
 *
 * Policy (agreed Oct 2026):
 * - Only pitches scoring 5 on every rubric dimension.
 * - One more Strengthen pass first; if the score drops below all 5s, stop.
 * - Write the article (charts filled from stored data), then publish only if
 *   the fact check passes. Otherwise it is held as a draft on the News Desk.
 * - At most MAX_PER_DAY published per Sydney day. A pitch tried in the last
 *   RETRY_DAYS is not retried, so a held draft waits for the editor.
 * - A pitch that already has a story (draft or published) is left alone.
 */
import { createClient } from '@/lib/supabase-server';
import { strengthenPitch } from '@/lib/strengthen-pitch';
import { goLiveFromPitch, publishStoryFromPitch } from '@/lib/generate-story';
import { generateHeroImage } from '@/lib/hero-image';
import { generateHeroVideo } from '@/lib/hero-video';
import type { FoundryEvent } from '@/lib/foundry-agent';

const DIMS = ['surprise', 'checkability', 'mechanism', 'visual', 'timing'] as const;
const ELIGIBLE_STATES = ['candidate', 'pitched', 'approved', 'watchlist'];
const MAX_PER_DAY = 2;
const RETRY_DAYS = 7;

type Pitch = {
  id: string;
  headline: string;
  state: string;
  score: Record<string, unknown> | null;
  rank_value: number | null;
  trigger_rows: Record<string, unknown> | null;
};
type AutoMark = { attempted_at: string; day: string; outcome: string; slug?: string; issues?: string[] };

const dryRun = process.argv.includes('--dry-run');
const noPublish = process.argv.includes('--no-publish');
const onlyPitches = [
  ...process.argv.filter((a) => a.startsWith('--pitch=')).map((a) => a.slice('--pitch='.length)),
  ...(process.env.AUTO_ARTICLE_PITCHES ?? '').split(/[\s,]+/),
].filter(Boolean);
const db = createClient();
const sydneyDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const allFives = (s: Pitch['score']) => !!s && DIMS.every((d) => Number(s[d]) === 5);
const markOf = (p: Pitch) => (p.trigger_rows?.auto_article ?? null) as AutoMark | null;
const log = (msg: string) => console.log(msg);
const onEvent = (e: FoundryEvent) => {
  const ev = e as { type: string; label?: string };
  if (ev.label && (ev.type === 'tool_start' || ev.type === 'tool_result')) log(`    · ${ev.label}`);
};

async function mark(id: string, patch: Partial<AutoMark>) {
  const { data } = await db.from('pitches').select('trigger_rows').eq('id', id).single();
  const rows = (data?.trigger_rows ?? {}) as Record<string, unknown>;
  const prior = (rows.auto_article ?? {}) as Partial<AutoMark>;
  await db.from('pitches').update({ trigger_rows: { ...rows, auto_article: { ...prior, ...patch } } }).eq('id', id);
}

/**
 * When an article is held because a claim needs a series the store does not
 * have, file a source suggestion so the daily source scout tries to load it.
 */
async function requestMissingSeries(p: Pitch, issues: string[]) {
  const wanted = new Map<string, string>();
  for (const issue of issues) {
    if (!issue.startsWith('claim not supported')) continue;
    const series = issue.match(/\bno ([a-z0-9 ,()'-]{4,80}?) series\b/i)?.[1]?.trim();
    if (series && !wanted.has(series.toLowerCase())) wanted.set(series.toLowerCase(), issue);
    if (wanted.size >= 3) break;
  }
  for (const [series, issue] of wanted) {
    if (dryRun) continue;
    await db.from('source_suggestions').insert({
      action: 'register_data_source',
      status: 'pending',
      summary: `Auto-article held: needs ${series}`,
      payload: { series, tier: 1, why: `Article for "${p.headline.slice(0, 120)}" was held: ${issue.slice(0, 300)}` },
    });
    log(`  Requested series for the source scout: ${series}`);
  }
}

async function candidates(today: string) {
  const { data, error } = await db.from('pitches')
    .select('id, headline, state, score, rank_value, trigger_rows, metric_ids')
    .in('state', ELIGIBLE_STATES);
  if (error) throw new Error(error.message);
  const pitches = (data ?? []) as Pitch[];

  const { data: storyRows } = await db.from('stories').select('pitch_id, status');
  const hasStory = new Set((storyRows ?? [])
    .filter((s) => !onlyPitches.length || s.status === 'published')
    .map((s) => s.pitch_id).filter(Boolean));

  const { data: published } = await db.from('pitches').select('trigger_rows').eq('state', 'published');
  const publishedToday = (published ?? []).filter((p) => {
    const m = (p.trigger_rows as Record<string, unknown> | null)?.auto_article as AutoMark | undefined;
    return m?.outcome === 'published' && m.day === today;
  }).length;

  const cutoff = Date.now() - RETRY_DAYS * 864e5;
  const fives = pitches.filter((p) => allFives(p.score));
  const eligible = fives
    .filter((p) => !onlyPitches.length || onlyPitches.includes(p.id))
    .filter((p) => !hasStory.has(p.id))
    .filter((p) => { const m = markOf(p); return onlyPitches.length > 0 || !m || Date.parse(m.attempted_at) < cutoff; })
    .sort((a, b) => (b.rank_value ?? 0) - (a.rank_value ?? 0));

  for (const p of fives.filter((f) => !eligible.includes(f))) {
    const m = markOf(p);
    const why = hasStory.has(p.id) ? 'already has a story' : m ? `tried ${m.day} (${m.outcome})` : 'filtered by --pitch';
    log(`  skip  ${why.padEnd(30)} id ${p.id}  ${p.headline.slice(0, 70)}`);
  }
  return { fives: fives.length, eligible, slots: Math.max(0, MAX_PER_DAY - publishedToday), publishedToday };
}

/** True for the first article published today: it gets the paid hero video. */
let heroVideoDue = false;

async function runOne(p: Pitch, today: string): Promise<AutoMark> {
  const started: AutoMark = { attempted_at: new Date().toISOString(), day: today, outcome: 'running' };
  await mark(p.id, started);

  log('  Strengthening…');
  try {
    const r = await strengthenPitch(p.id, onEvent);
    log(`  Strengthen: ${r.strengthened ? 'strengthened' : 'no material change'}`);
  } catch (e) {
    log(`  Strengthen failed (${e instanceof Error ? e.message : e}); writing from the current brief.`);
  }

  const { data: after } = await db.from('pitches').select('score, state').eq('id', p.id).single();
  if (!allFives(after?.score as Pitch['score'])) {
    log(`  Score after strengthening is ${JSON.stringify(after?.score)}; not all 5s, so no article.`);
    return { ...started, outcome: 'downgraded' };
  }

  const now = new Date().toISOString();
  if (after?.state !== 'approved') {
    await db.from('pitches').update({ state: 'approved', state_changed: now, last_evaluated: now }).eq('id', p.id);
  }

  log('  Writing article…');
  const draft = await publishStoryFromPitch(p.id, onEvent, { audit: true });
  log(`  Draft: /stories/${draft.slug} "${draft.title}"`);
  const { data: written } = await db.from('stories').select('hook, body').eq('pitch_id', p.id).single();
  const lede = (written?.body?.blocks ?? []).find((b: { type: string }) => b.type === 'paragraph') as { text?: string } | undefined;
  log(`  Standfirst: ${written?.hook ?? ''}`);
  if (lede?.text) log(`  Lede: ${lede.text.slice(0, 400)}`);

  if (!draft.check.ok) {
    log(`  Held for review (${draft.check.issues.length} issue(s)):`);
    for (const i of draft.check.issues.slice(0, 12)) log(`    - ${i}`);
    await requestMissingSeries(p, draft.check.issues);
    return { ...started, outcome: 'held', slug: draft.slug, issues: draft.check.issues.slice(0, 20) };
  }

  log(`  Claims audited: ${draft.check.claims?.length ?? 0}, all supported.`);
  if (noPublish) {
    log('  Fact check passed; --no-publish, so left as a draft.');
    return { ...started, outcome: 'passed-unpublished', slug: draft.slug };
  }

  const { data: story } = await db.from('stories').select('slug, title, hook, kicker, one_number').eq('pitch_id', p.id).single();
  let heroGenerationId: string | null = null;
  if (story) {
    try { heroGenerationId = (await generateHeroImage(db, story, (m) => log(`  ${m}`)))?.generationId ?? null; }
    catch (e) { log(`  Hero image failed (${e instanceof Error ? e.message : e}); publishing without one.`); }
  }
  if (story && heroVideoDue) {
    heroVideoDue = false;
    try { await generateHeroVideo(db, story, { heroGenerationId, log: (m) => log(`  ${m}`) }); }
    catch (e) { log(`  Hero video failed (${e instanceof Error ? e.message : e}); publishing without one.`); }
  }

  const live = await goLiveFromPitch(p.id);
  log(`  Published: ${live.storyUrl}`);
  return { ...started, outcome: 'published', slug: live.slug };
}

async function main() {
  const today = sydneyDay();
  const { fives, eligible, slots, publishedToday } = await candidates(today);
  log(`${fives} pitch(es) score all 5s; ${eligible.length} eligible; ${publishedToday} auto-published today; ${slots} slot(s) left.`);
  for (const p of eligible) {
    log(`  ${p.state.padEnd(9)} rank ${p.rank_value ?? '-'}  ${p.headline.slice(0, 90)}`);
    log(`            id ${p.id}  metrics ${JSON.stringify((p as Pitch & { metric_ids?: string[] }).metric_ids ?? [])}`);
  }
  if (dryRun || !slots || !eligible.length) {
    if (dryRun) log('Dry run: nothing written.');
    return;
  }

  heroVideoDue = publishedToday === 0;
  const results: Array<{ headline: string } & AutoMark> = [];
  let published = 0;
  for (const p of eligible) {
    if (published >= slots) break;
    log(`\n${p.headline}`);
    let result: AutoMark;
    try {
      result = await runOne(p, today);
    } catch (e) {
      result = { attempted_at: new Date().toISOString(), day: today, outcome: 'failed', issues: [e instanceof Error ? e.message : String(e)] };
      log(`  Failed: ${result.issues![0]}`);
    }
    await mark(p.id, result);
    results.push({ headline: p.headline, ...result });
    if (result.outcome === 'published' || result.outcome === 'passed-unpublished') published++;
  }

  const summary = results.map((r) => `${r.outcome}: ${r.headline.slice(0, 80)}${r.slug ? ` (/stories/${r.slug})` : ''}`);
  await db.from('agent_runs').insert({
    pitched: published,
    quiet_day: published === 0,
    notes: `auto-articles: ${summary.join(' | ')}`.slice(0, 2000),
  });
  const held = results.filter((r) => r.outcome === 'held').length;
  log(noPublish
    ? `\nDone. ${published} passed every check (left as drafts), ${held} held for review.`
    : `\nDone. ${published} published, ${held} held for review.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
