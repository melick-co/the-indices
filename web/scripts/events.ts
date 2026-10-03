/**
 * The events store: decisions, releases and the watch list (agent/supabase/34_events.sql, web/lib/events.ts).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/events.ts --calendar   # add upcoming RBA meetings and ABS releases
 *   ... --backfill   # record past RBA decisions (and their factors) from stored statements
 *   ... --history    # record past ABS releases since 2022 (release date, figures, release page) as milestones
 *   ... --watch      # process events that have fallen due (see below)
 *   ... --list       # recent and upcoming events
 *
 * When a watched event falls due (policy, Oct 2026):
 *  1. Wait for it: the RBA statement or the ABS release page must be stored (the job loads them first).
 *     Not out yet: try again on the next run, for up to two days.
 *  2. Record the outcome: the decision and its factors (quotes verified against the statement), or the new
 *     values of the release's series and whether the move is significant.
 *  3. Update the figures in every published article that quotes an affected series (numbers, periods and
 *     direction words only; charts rebuilt from the store) and apply each update that passes every check, with
 *     an update note. If the new data changes an article's finding, it is not rewritten in place: a new article
 *     is written and published (as for breaking stories), and the original gets a note linking to it.
 *     At most REFRESH_PER_RUN articles per run; the rest go on the next run.
 *  4. Significant events (every RBA decision; big moves or new highs/lows in CPI, wages, jobs, GDP) get a
 *     breaking story: pitch, write and publish if it passes every check (outside the daily cap), with a hero
 *     image and, if none has run today, the narrated clip. Otherwise it is held as a draft.
 */
import { createClient } from '@/lib/supabase-server';
import {
  RELEASES, absCalendar, absHistory, absReleaseCalendar, eventsContext, expandRules, fedCalendar, rbaPublications, rbaTableCalendar, type WatchRule, refPeriodOf, releasePage, extractRbaDecision, rateAround, rbaCalendar, releaseOutcome, scheduleEvents, type EventRow,
} from '@/lib/events';
import { updateFigures } from '@/lib/refresh-story';
import { goLiveFromPitch, publishStoryFromPitch } from '@/lib/generate-story';
import { generateHeroImage } from '@/lib/hero-image';
import { generateHeroVideo } from '@/lib/hero-video';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { ensureDocument } from '../../agent/scripts/lib/source-docs.mjs';
import { pdfText } from '@/lib/pdf-text';
import type { FoundryEvent } from '@/lib/foundry-agent';
import type { StoryBlock } from '@/lib/story-types';

const REFRESH_PER_RUN = 3;
const GIVE_UP_AFTER_MS = 2 * 864e5;

const db = createClient();
const arg = (k: string) => process.argv.includes(k);
const log = (m: string) => console.log(m);
const onEvent = (e: FoundryEvent) => {
  const ev = e as { type: string; label?: string };
  if (ev.label && (ev.type === 'tool_start' || ev.type === 'tool_result')) log(`      · ${ev.label}`);
};
const sydneyDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const prettyDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function calendar() {
  const { data: pages } = await db.from('source_documents').select('url, body').eq('publisher', 'ABS').eq('kind', 'release');
  const year = new Date().getUTCFullYear();
  const rba = await rbaCalendar([year, year + 1]);
  const { data: rules } = await db.from('watch_rules').select('*').eq('active', true);
  const sources: Array<[string, Awaited<ReturnType<typeof absCalendar>>]> = [
    ['ABS release pages', absCalendar(pages ?? [])],
    ['ABS release calendar', await absReleaseCalendar(6)],
    ['RBA meetings', rba],
    ['RBA statements and minutes', rbaPublications(rba)],
    ['RBA statistical tables', await rbaTableCalendar()],
    ['US Federal Reserve', await fedCalendar()],
    ['watch rules', expandRules((rules ?? []) as WatchRule[], 60)],
  ];
  let added = 0;
  for (const [name, events] of sources) {
    const n = await scheduleEvents(db, events);
    added += n;
    log(`  ${name}: ${events.length} found, ${n} new`);
  }
  log(`Calendar: ${added} new on the watch list.`);
}

async function backfill() {
  const { data: docs } = await db.from('source_documents').select('url, title, body, published')
    .eq('publisher', 'RBA').eq('kind', 'statement').not('published', 'is', null).order('published');
  let added = 0;
  for (const doc of docs ?? []) {
    const key = `rba:decision:${doc.published}`;
    const { data: have } = await db.from('events').select('status, outcome').eq('event_key', key).maybeSingle();
    if (have && have.status !== 'scheduled') {
      // Already recorded: just make sure the rates match stored data (cheap; no model call).
      const { rate, previous } = await rateAround(db, doc.published);
      const outcome = { ...(have.outcome ?? {}), cash_rate: rate, previous_rate: previous };
      await db.from('events').update({ outcome, updated_at: new Date().toISOString() }).eq('event_key', key);
      log(`  ${doc.published}: ${(have.outcome as { decision?: string })?.decision ?? '?'} ${previous ?? '?'}% → ${rate ?? '?'}%`);
      continue;
    }
    const { outcome, factors, summary } = await extractRbaDecision(db, doc);
    const row = {
      event_key: key, kind: 'decision', institution: 'RBA', series: 'rba:decision',
      title: `RBA monetary policy decision, ${prettyDay(doc.published)}`,
      occurred_on: doc.published, status: 'processed', metric_ids: ['cash_rate_au'],
      outcome, factors, summary, source_url: doc.url, significance: 'none',
      actions: { note: 'backfilled; no triggers' }, processed_at: new Date().toISOString(),
    };
    const { error } = await db.from('events').upsert(row, { onConflict: 'event_key' });
    if (error) throw new Error(error.message);
    added++;
    log(`  ${doc.published}: ${(outcome.decision as string) ?? '?'} ${outcome.previous_rate ?? '?'}% → ${outcome.cash_rate ?? '?'}% (${factors.length} factor(s))`);
  }
  log(`Backfill: ${added} RBA decision(s) recorded.`);
}

async function history() {
  let total = 0;
  for (const rel of RELEASES.filter((r) => r.metric_ids.length)) {
    log(`${rel.series}:`);
    total += await absHistory(db, rel, 2022, log);
  }
  log(`History: ${total} past release(s) recorded.`);
}

async function list() {
  const { data: past } = await db.from('events').select('occurred_on, title, significance, status, outcome')
    .in('status', ['occurred', 'processed']).order('occurred_on', { ascending: false }).limit(10);
  const { data: next } = await db.from('events').select('scheduled_at, title, status')
    .in('status', ['scheduled', 'due']).order('scheduled_at').limit(15);
  log('Recent:');
  for (const e of past ?? []) log(`  ${e.occurred_on}  ${e.title}  [${e.significance ?? '-'}] ${JSON.stringify(e.outcome ?? {}).slice(0, 120)}`);
  log('Coming up (Sydney time):');
  for (const e of next ?? []) log(`  ${new Date(e.scheduled_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}  ${e.title}  (${e.status})`);
}

// ---------- watching ----------

async function notYet(e: EventRow, why: string) {
  const late = Date.now() - new Date(e.scheduled_at ?? 0).getTime() > GIVE_UP_AFTER_MS;
  await db.from('events').update({
    status: late ? 'cancelled' : 'due', attempts: e.attempts + 1, updated_at: new Date().toISOString(),
    actions: { ...(e.actions ?? {}), waiting: why },
  }).eq('event_id', e.event_id);
  log(`  ${late ? 'Gave up' : 'Not out yet'}: ${why}`);
}

/** Record what happened. Returns false when the release is not out yet. */
async function record(e: EventRow): Promise<boolean> {
  const day = e.event_key.split(':').pop()!;
  if (e.series === 'rba:decision') {
    const { data: doc } = await db.from('source_documents').select('url, title, body, published')
      .eq('publisher', 'RBA').eq('kind', 'statement').eq('published', day).maybeSingle();
    if (!doc) { await notYet(e, 'the decision statement is not stored yet'); return false; }
    const { outcome, factors, summary } = await extractRbaDecision(db, doc);
    Object.assign(e, { outcome, factors, summary, source_url: doc.url, occurred_on: day, significance: 'breaking', status: 'occurred' });
  } else if (!RELEASES.some((r) => r.series === e.series)) {
    // Everything else on the watch list: a reminder for private sources; for official ones, the publication
    // stored as a source document once it is out (a statement, minutes, a table or a release with no series).
    const official = (e as { official?: boolean }).official !== false;
    let summary = 'Reminder: unofficial source; check the report. Not citable under the house sourcing rules.';
    if (official && e.source_url && !/statistics\/tables\/#/.test(e.source_url)) {
      const doc = await ensureDocument(db, e.source_url, { pdfText }) as { error?: string };
      if (doc.error) { await notYet(e, `${e.source_url}: ${doc.error}`); return false; }
      summary = 'Published; stored as a source document.';
    } else if (official) {
      summary = e.metric_ids.length ? 'Released; the data load picks up its series.' : 'Released.';
    }
    Object.assign(e, {
      occurred_on: day, status: 'occurred', summary,
      significance: official && e.metric_ids.length ? 'refresh' : 'none',
    });
  } else {
    const rel = RELEASES.find((r) => r.series === e.series)!;
    const { data: page } = await db.from('source_documents').select('title').eq('url', rel.url).maybeSingle();
    const out = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!page?.title || !out(e.title).startsWith(out(page.title)) && !out(page.title).startsWith(out(e.title))) {
      await notYet(e, `the latest release page still shows "${page?.title ?? 'nothing'}"`);
      return false;
    }
    const ro = await releaseOutcome(db, rel.metric_ids, rel.thresholds);
    // Cite this release's own page ("…/sep-2026"), not latest-release, whose content moves on.
    const ref = refPeriodOf(e.title);
    const own = ref ? await releasePage(rel.url.replace(/\/latest-release$/, ''), ref.year, ref.month) : null;
    Object.assign(e, {
      outcome: { values: ro.values, reasons: ro.reasons }, occurred_on: day, source_url: own?.url ?? rel.url,
      significance: ro.significant ? 'breaking' : 'refresh', status: 'occurred',
      summary: ro.significant ? `Significant: ${ro.reasons.join('; ')}` : 'Routine release',
    });
  }
  await db.from('events').update({
    status: 'occurred', occurred_on: e.occurred_on, outcome: e.outcome, factors: e.factors, summary: e.summary,
    source_url: e.source_url, significance: e.significance, updated_at: new Date().toISOString(),
  }).eq('event_id', e.event_id);
  log(`  Recorded (${e.significance}): ${e.summary}`);
  return true;
}

/** Metric ids a published story quotes: saved ids, charts and the hero number. */
function storyMetrics(s: { evidence: { metric_ids?: string[] } | null; body: { blocks?: StoryBlock[] } | null; one_number: { metric_id?: string } | null }) {
  const ids = new Set(s.evidence?.metric_ids ?? []);
  for (const b of s.body?.blocks ?? []) {
    if (b.type === 'chart' && b.data) { ids.add(b.data.metric_id); if (b.data.alt_metric_id) ids.add(b.data.alt_metric_id); }
  }
  if (s.one_number?.metric_id) ids.add(s.one_number.metric_id);
  return ids;
}

/**
 * Keep the articles that quote the event's series current. Updates are figures only (numbers, periods,
 * direction words, charts rebuilt from the store); an article whose finding the new data changes is left as
 * it is, gets a note pointing to a new article, and the new article is written and published in its place.
 */
async function refreshAffected(e: EventRow) {
  const actions = (e.actions ?? {}) as {
    queue?: string[]; applied?: string[]; unchanged?: string[]; held?: string[];
    rewritten?: Array<{ slug: string; reason: string; new_slug?: string; outcome: string }>; breaking?: unknown;
  };
  if (!actions.queue) {
    const { data: stories } = await db.from('stories').select('slug, evidence, body, one_number').eq('status', 'published');
    actions.queue = (stories ?? [])
      .filter((s) => { const ids = storyMetrics(s as never); return e.metric_ids.some((m) => ids.has(m)); })
      .map((s) => s.slug);
    log(`  ${actions.queue.length} published article(s) quote the affected series.`);
  }
  actions.applied ??= [];
  actions.unchanged ??= [];
  actions.held ??= [];
  actions.rewritten ??= [];
  const note = `Updated ${prettyDay(e.occurred_on!)} after the ${e.title}: figures brought up to date with the latest official data and re-checked. The analysis is unchanged.`;
  for (const slug of actions.queue.splice(0, REFRESH_PER_RUN)) {
    log(`  Updating figures in /stories/${slug}`);
    try {
      const r = await updateFigures(slug, e, note);
      if (r.outcome === 'applied') { actions.applied.push(slug); log(`    Applied ${r.edits?.length ?? 0} figure edit(s).`); }
      else if (r.outcome === 'unchanged') { actions.unchanged.push(slug); log('    No figures superseded.'); }
      else if (r.outcome === 'held') { actions.held.push(slug); log(`    Held for the desk: ${r.reason}${r.issues?.length ? ` (${r.issues.length} issue(s))` : ''}`); }
      else {
        log(`    The new data changes the finding: ${r.reason}`);
        const follow = await followUpStory(e, slug, r.reason ?? '');
        actions.rewritten.push({ slug, reason: r.reason ?? '', new_slug: follow.slug, outcome: follow.outcome });
      }
    } catch (err) {
      actions.held.push(slug);
      log(`    Failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  e.actions = actions;
  return actions.queue.length === 0;
}

/**
 * The new article for a story whose finding an event changed. Published like a breaking story (checks must
 * pass; outside the daily cap); the original stays as published, with a note linking to the new article.
 */
async function followUpStory(e: EventRow, slug: string, reason: string) {
  const { data: old } = await db.from('stories').select('title, hook, pitch_id, evidence').eq('slug', slug).single();
  const { data: oldPitch } = old?.pitch_id ? await db.from('pitches').select('metric_ids').eq('id', old.pitch_id).maybeSingle() : { data: null };
  const context = await eventsContext(db, e.metric_ids);
  const pitch = await callClaudeJson(`Official data has changed the finding of a published article. Write the pitch for a NEW article for
The Caveat, an Australian data-journalism broadsheet, that reports what the data now shows. It is a fresh story,
not a correction: lead with the new finding, and mention once that it overturns or changes the earlier one.

<earlier_article slug="${slug}">
${old?.title}
${old?.hook}
</earlier_article>

<what_changed>
${e.title} (${e.occurred_on}): ${reason}
Outcome: ${JSON.stringify(e.outcome)}
</what_changed>

<context>
${context}
</context>

Respond ONLY with JSON:
{"headline":"a claim, 6-12 words","hook":"why it matters now, one sentence","mechanism":"one plain sentence on cause","caveat":"the strongest objection","chart_hint":"best chart","metric_ids":["stored metric ids the story should use"]}`,
  { label: 'follow-up pitch' }) as { headline: string; hook: string; mechanism: string; caveat: string; chart_hint: string; metric_ids?: string[] };
  const oldIds = ((old?.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  const { data: row, error } = await db.from('pitches').insert({
    headline: pitch.headline, hook: pitch.hook, mechanism: pitch.mechanism, caveat: pitch.caveat, chart_hint: pitch.chart_hint,
    detector: 'event', trigger_rows: { event_key: e.event_key, outcome: e.outcome, replaces: slug, reason }, state: 'approved',
    metric_ids: [...new Set([...(pitch.metric_ids ?? []), ...e.metric_ids, ...((oldPitch?.metric_ids as string[] | null) ?? []), ...oldIds])],
  }).select('id').single();
  if (error || !row) throw new Error(error?.message ?? 'pitch insert failed');
  log(`    New article pitch: ${pitch.headline}`);
  const result = await publishLive(row.id);
  if (result.outcome === 'published') {
    await db.from('stories').update({
      update_note: `Updated ${prettyDay(e.occurred_on!)}: the ${e.title} changed this article's finding. Read the new article: /stories/${result.slug}`,
      updated_on: sydneyDay(), updated_at: new Date().toISOString(),
    }).eq('slug', slug);
    log(`    The original now points to /stories/${result.slug}.`);
  }
  return result;
}

async function breakingStory(e: EventRow) {
  const context = await eventsContext(db, e.metric_ids);
  const pitch = await callClaudeJson(`An official event just happened. Write a news pitch for The Caveat, an Australian
data-journalism broadsheet that leads with the detail that changes the story.

<event>
${e.title} (${e.occurred_on})
Outcome: ${JSON.stringify(e.outcome)}
Factors given: ${JSON.stringify(e.factors)}
Source: ${e.source_url}
</event>

<context>
${context}
</context>

Lead with what is newsworthy in the stored data and the institution's own words; no speculation. Respond ONLY with JSON:
{"headline":"a claim, 6-12 words","hook":"why it matters now, one sentence","mechanism":"one plain sentence on cause","caveat":"the strongest objection","chart_hint":"best chart","metric_ids":["stored metric ids the story should use"]}`,
  { label: 'event pitch' }) as { headline: string; hook: string; mechanism: string; caveat: string; chart_hint: string; metric_ids?: string[] };
  const { data: row, error } = await db.from('pitches').insert({
    headline: pitch.headline, hook: pitch.hook, mechanism: pitch.mechanism, caveat: pitch.caveat, chart_hint: pitch.chart_hint,
    detector: 'event', trigger_rows: { event_key: e.event_key, outcome: e.outcome }, state: 'approved',
    metric_ids: [...new Set([...(pitch.metric_ids ?? []), ...e.metric_ids])],
  }).select('id').single();
  if (error || !row) throw new Error(error?.message ?? 'pitch insert failed');
  log(`  Breaking pitch: ${pitch.headline}`);
  return publishLive(row.id);
}

/** Write, check and publish an approved event pitch: hero image, the day's first narrated clip, then live. */
async function publishLive(pitchId: string) {
  const row = { id: pitchId };
  const draft = await publishStoryFromPitch(row.id, onEvent, { audit: true });
  if (!draft.check.ok) {
    log(`  Held as a draft (${draft.check.issues.length} issue(s)): /stories/${draft.slug}`);
    return { pitch_id: row.id, slug: draft.slug, outcome: 'held' };
  }
  const { data: story } = await db.from('stories').select('slug, title, hook, kicker, one_number').eq('pitch_id', row.id).single();
  let heroGenerationId: string | null = null;
  if (story) {
    try { heroGenerationId = (await generateHeroImage(db, story, (m) => log(`    ${m}`)))?.generationId ?? null; }
    catch (err) { log(`    Hero image failed: ${err instanceof Error ? err.message : err}`); }
    // The narrated clip is for the first story each Sydney day.
    const { data: today } = await db.from('stories').select('art').eq('status', 'published').eq('published', sydneyDay());
    const clipToday = (today ?? []).some((s) => JSON.stringify(s.art ?? '').includes('"clip"'));
    if (!clipToday) {
      try { await generateHeroVideo(db, story, { heroGenerationId, log: (m) => log(`    ${m}`) }); }
      catch (err) { log(`    Hero video failed: ${err instanceof Error ? err.message : err}`); }
    }
  }
  const live = await goLiveFromPitch(row.id);
  log(`  Published: ${live.storyUrl}`);
  return { pitch_id: row.id, slug: live.slug, outcome: 'published' };
}

async function watch() {
  const now = new Date().toISOString();
  const { data: due } = await db.from('events').select('*')
    .or(`and(status.in.(scheduled,due),scheduled_at.lte.${now}),status.eq.occurred`)
    .order('scheduled_at');
  const events = (due ?? []) as EventRow[];
  log(`${events.length} event(s) due or in progress.`);
  for (const e of events) {
    log(`\n${e.title} (${e.event_key})`);
    try {
      if (e.status !== 'occurred' && !(await record(e))) continue;
      const actions = (e.actions ?? {}) as Record<string, unknown>;
      if (e.significance === 'breaking' && !actions.breaking) {
        try { actions.breaking = await breakingStory(e); }
        catch (err) { actions.breaking = { outcome: 'failed', error: err instanceof Error ? err.message : String(err) }; log(`  Breaking story failed: ${actions.breaking && (actions.breaking as { error: string }).error}`); }
        e.actions = actions;
        await db.from('events').update({ actions: e.actions, updated_at: new Date().toISOString() }).eq('event_id', e.event_id);
      }
      // Only releases that move stored series refresh articles.
      const finished = e.significance === 'breaking' || e.significance === 'refresh' ? await refreshAffected(e) : true;
      await db.from('events').update({
        actions: e.actions, status: finished ? 'processed' : 'occurred',
        processed_at: finished ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('event_id', e.event_id);
      log(finished ? '  Done.' : '  More articles to refresh on the next run.');
    } catch (err) {
      log(`  Failed: ${err instanceof Error ? err.message : err}`);
      await db.from('events').update({ attempts: e.attempts + 1, updated_at: new Date().toISOString() }).eq('event_id', e.event_id);
    }
  }
}

async function main() {
  if (arg('--calendar')) await calendar();
  if (arg('--backfill')) await backfill();
  if (arg('--history')) await history();
  if (arg('--watch')) await watch();
  if (arg('--list') || !['--calendar', '--backfill', '--history', '--watch'].some(arg)) await list();
}

main().catch((e) => { console.error(e); process.exit(1); });
