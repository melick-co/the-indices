import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { parseFeed, sha } from '../../agent/scripts/lib/rss-parse.mjs';
import { ensureDocument } from '../../agent/scripts/lib/source-docs.mjs';
import { decodeEntities, fetchDocument } from '../../agent/scripts/lib/html-text.mjs';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import { numbersIn } from '../../agent/scripts/lib/figures.mjs';
import { adoptedForRecheck, claimRequests, fileClaimRequests, findClaim, markRechecked, normaliseNeeds } from '../../agent/scripts/lib/claim-requests.mjs';
import { CHARTER } from '@/lib/research-agent';
import { factCheckStory } from '@/lib/fact-check';
import { auditClaims } from '@/lib/claim-audit';
import { verifySourcedStatements } from '@/lib/source-check';
import { pdfText } from '@/lib/pdf-text';
import { sydneyDay } from '@/lib/dates';
import {
  BOTTOM_LINE_TOPICS, chartPathFor, dataFigures, decide, figuresMissingFrom, filterLinks, isOfficialUrl, isSourcedSentence,
  dropFlaggedSentences, findListedLink, itemIssues, linkablePaths, matchesTopics, normaliseDraft, normaliseLinks, sentenceText, shouldWrite, toCheckable, validateDraft,
  VERDICTS, type BottomLineCheck, type BottomLineDraft, type IncClaim, type IncKind, type IncLink, type KnownPaths, type SourceRef, type Verdict,
} from '@/lib/australia-inc';

/**
 * Australia Inc. pipeline (web/scripts/australia-inc.ts, task australia-inc):
 *   1. fetch the government feeds (rss_feeds.beat = 'australia_inc') so the morning run sees last night's releases;
 *   2. pick the announcements and news that matter to the nation's bottom line, summarise each and check its claims
 *      against stored series (the economist reviewer's method: catalogue prompt, then verdicts against the latest
 *      readings with changes computed in code); upsert inc_items;
 *   3. write today's Bottom Line and run the strict check, fail closed: published only if everything passes.
 * Claims on an official statistic the store does not hold ask the source scout for it (requestMissingSeries); once the
 * scout adopts the series, the next run re-checks those claims against it (recheckAdopted, at the start of the run).
 */

const HOURS = 36;
/** Government releases come every few days, not hourly: the beat feeds are read further back (covered urls are skipped). */
const BEAT_HOURS = 96;
const MAX_CANDIDATES = 40;
const MAX_PICKS = 8;
const UA = 'Mozilla/5.0 (compatible; caveat-australia-inc/0.1; +https://caveat.news/methodology)';

type Log = (line: string) => void;
type Candidate = {
  rss_item_id: string | null; title: string; url: string; summary: string; published_at: string | null;
  publisher: string; official: boolean; beat: boolean;
};
export type ItemRow = {
  id?: string; rss_item_id: string | null; title: string; url: string; publisher: string; published_at: string | null;
  kind: IncKind; summary: string; claims: IncClaim[]; links: IncLink[]; status: 'new' | 'published';
};

// ---------------------------------------------------------------------------------------------------- helpers

/**
 * An official item whose feed link is dead: look for it on the page that lists it (the link's parent path, as the
 * site writes it, then in lower case) and return the address the site actually uses.
 */
export async function repairOfficialLink(url: string, title: string): Promise<string | null> {
  const parent = url.replace(/\/[^/]+\/?$/, '');
  for (const listing of [...new Set([parent, parent.toLowerCase()])]) {
    try {
      const res = await fetch(listing, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const found = findListedLink(await res.text(), title, res.url || listing);
      if (found && found !== url && (await urlResolves(found))) return found;
    } catch { /* try the next form */ }
  }
  return null;
}

/** True when the address answers 200 (HEAD, or GET where HEAD is refused). */
export async function urlResolves(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (res.status === 200) return true;
      if (![403, 405, 501].includes(res.status)) return false;
    } catch { if (method === 'GET') return false; }
  }
  return false;
}

async function sourceText(url: string, fallback: string): Promise<string> {
  const doc = await fetchDocument(url, { pdfText }) as { body?: string; error?: string };
  return `${fallback}\n${doc.body ?? ''}`.slice(0, 20_000);
}

async function catalogue(db: SupabaseClient) {
  const { data } = await db.from('metrics').select('metric_id, name, unit, category');
  const rows = (data ?? []).filter((m) => m.category !== 'exchange_rates');
  return { text: rows.map((m) => `${m.metric_id}: ${m.name} (${m.unit ?? ''})`).join('\n'), ids: new Set(rows.map((m) => m.metric_id as string)), names: new Map(rows.map((m) => [m.metric_id as string, m.name as string])) };
}

async function latest(db: SupabaseClient, metricId: string) {
  const { data } = await db.from('observations').select('period, value').eq('metric_id', metricId).eq('entity', 'AUS').order('period', { ascending: false }).limit(9);
  const rows = (data ?? []).reverse();
  // Each reading with its change from the one before, worked out here so the model doesn't have to count.
  return rows.slice(1).map((r, k) => ({ period: r.period as string, value: Number(r.value), change: +(Number(r.value) - Number(rows[k].value)).toPrecision(6) }));
}

// ---------------------------------------------------------------------------------------------------- 1. feeds

export async function fetchBeatFeeds(db: SupabaseClient, dry: boolean, log: Log): Promise<Candidate[]> {
  const { data: feeds, error } = await db.from('rss_feeds').select('feed_id, url, name, publisher, error_count')
    .eq('beat', 'australia_inc').eq('active', true).lt('error_count', 5);
  if (error) { log(`feeds: ${error.message} (has migration 46 run?)`); return []; }
  const since = Date.now() - HOURS * 3600e3;
  const fresh: Candidate[] = [];
  for (const f of feeds ?? []) {
    try {
      const res = await fetch(f.url, { headers: { 'user-agent': 'the-indices-agent/0.1' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text());
      let added = 0;
      for (const it of items) {
        const t = it.published ? Date.parse(it.published) : NaN;
        const published_at = Number.isFinite(t) ? new Date(t).toISOString() : null;
        if (dry) {
          if (it.link && (!Number.isFinite(t) || t >= since)) fresh.push({ rss_item_id: null, title: it.title, url: it.link, summary: it.summary, published_at, publisher: f.publisher ?? f.name ?? '', official: isOfficialUrl(it.link), beat: true });
          continue;
        }
        const { error: e } = await db.from('rss_items').insert({ feed_id: f.feed_id, guid_hash: sha(String(it.guid)), title: it.title, link: it.link, summary: it.summary, published_at });
        if (!e) added++; // a duplicate key is an item already stored
      }
      if (!dry) await db.from('rss_feeds').update({ last_fetched: new Date().toISOString(), error_count: 0 }).eq('feed_id', f.feed_id);
      log(`feed ${f.name}: ${items.length} items${dry ? '' : `, ${added} new`}`);
    } catch (e) {
      if (!dry) await db.from('rss_feeds').update({ error_count: (f.error_count ?? 0) + 1 }).eq('feed_id', f.feed_id);
      log(`feed ${f.name}: failed (${e instanceof Error ? e.message : e})`);
    }
  }
  return fresh;
}

/** Items from the last ~36 hours: everything from the government feeds, plus general news on bottom-line topics. */
export async function loadCandidates(db: SupabaseClient, extra: Candidate[]): Promise<Candidate[]> {
  const since = new Date(Date.now() - HOURS * 3600e3).toISOString();
  const beatSince = new Date(Date.now() - BEAT_HOURS * 3600e3).toISOString();
  let { data: feeds, error } = await db.from('rss_feeds').select('feed_id, name, publisher, beat');
  // Before migration 46 there is no beat column: general news only.
  if (error) ({ data: feeds } = await db.from('rss_feeds').select('feed_id, name, publisher').then((r) => ({ data: (r.data ?? []).map((f) => ({ ...f, beat: null })) })));
  const feedOf = new Map((feeds ?? []).map((f) => [f.feed_id as string, f]));
  const { data: items } = await db.from('rss_items').select('item_id, feed_id, title, link, summary, published_at, fetched_at')
    .gte('fetched_at', beatSince).order('fetched_at', { ascending: false }).limit(800);
  const fromDb: Candidate[] = (items ?? []).flatMap((it) => {
    const f = feedOf.get(it.feed_id);
    if (!it.link || !f) return [];
    const beat = f.beat === 'australia_inc';
    if (it.published_at && it.published_at < (beat ? beatSince : since)) return [];
    if (!beat && it.fetched_at < since) return [];
    if (!beat && !matchesTopics(`${it.title} ${it.summary ?? ''}`)) return [];
    return [{ rss_item_id: it.item_id, title: it.title, url: it.link, summary: it.summary ?? '', published_at: it.published_at, publisher: f.publisher ?? f.name ?? '', official: isOfficialUrl(it.link), beat }];
  });
  // Feeds carry HTML entities ("&#8217;"); readers see the characters.
  const all = [...extra, ...fromDb].map((c) => ({ ...c, title: decodeEntities(c.title), summary: decodeEntities(c.summary) }));
  const urls = [...new Set(all.map((c) => c.url))];
  const { data: known } = await db.from('inc_items').select('url').in('url', urls.length ? urls : ['_']);
  const covered = new Set((known ?? []).map((k) => k.url));
  const seen = new Set<string>();
  return all.filter((c) => !covered.has(c.url) && !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => Number(b.beat) - Number(a.beat) || String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))
    .slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------------------------------- 2. commentary

function pickPrompt(cands: Candidate[]) {
  return `${CHARTER}

You run Australia Inc., Caveat's running commentary on how the country is being run: what government announced and
what is making news about the nation's bottom line (${BOTTOM_LINE_TOPICS.join(', ')}).

From the items below, pick up to ${MAX_PICKS} that matter to the nation's bottom line: budgets, tax, spending, debt,
productivity, housing, energy prices, wages, migration, interest rates, inflation, trade, regulation. Skip
appointments, ceremonies, condolences, sport and anything that does not change the national accounts or the cost of
living. Prefer official announcements; take a news item only when it adds something the announcements don't.

Items (official = an Australian government body):
${JSON.stringify(cands.map((c, i) => ({ i, publisher: c.publisher, official: c.official, title: c.title, summary: c.summary.slice(0, 400), published: c.published_at })), null, 1)}

Reply with JSON only: {"picks": [{"i": index, "kind": "announcement" | "release" | "news", "why": "a few words"}]}
announcement: a government decision or statement. release: an official publication (report, costing, audit, statistics). news: a news outlet's report.`;
}

function extractPrompt(c: Candidate, text: string, cat: string) {
  return `${CHARTER}

Summarise this item for Australia Inc., Caveat's running commentary on the nation's bottom line, and extract its
checkable claims. Reply with JSON only.

Publisher: ${c.publisher}${c.official ? ' (official)' : ' (news outlet, tier 3)'}
Title: ${c.title}
Published: ${c.published_at ?? 'unknown'}
Text:
${text.slice(0, 10_000)}

Return:
{"summary": "one or two plain sentences, attributed to ${c.publisher} or the person named (\\"The Treasurer said…\\"). Only figures that appear in the text above.",
 "claims": [                        // up to 4, the substantive ones that a national statistic could test
   {"text": "the claim in one sentence, attributed", "metric_id": "the stored series measuring exactly the claim's quantity, from the catalogue, or null",
    "needs": null | {"series": "plain name of the statistic incl. basis, e.g. 'Unemployment rate, trend, Australia, monthly'", "org": "the official publisher", "why": "a few words"}}]}

Rules: attribute every statement; never state a government claim as fact. A metric_id must measure the claim's own
quantity on the same basis, not a related one: the same measure (nominal vs real, an index vs a rate, a private index
such as Cotality vs an official one), the same frequency and period (since April vs quarterly), the same adjustment
(trend vs seasonally adjusted). When in doubt, null: an unchecked claim is fine, a false contradiction is not. Australian English ("per cent", "labour", "organise"). No em dashes.
needs: only when metric_id is null and the claim states an official Australian statistic that the ABS, the RBA,
Treasury or the Parliamentary Budget Office, or an international official body (OECD, IMF, World Bank, BIS) would
publish as a recurring series: name that series. Otherwise null: opinions, forecasts, promises, private data (Cotality,
CoreLogic, PropTrack, bank or Westpac-Melbourne Institute surveys, polls) and one-off figures such as a company's results.

Catalogue of stored series:
${cat}`;
}

function verdictPrompt(claims: unknown[], published: string | null) {
  return `For each claim (made ${published ? `on ${published.slice(0, 10)}` : 'recently'}), compare it with the official readings given (latest last; each with its change from the reading before).
Reply with JSON only, writing the note first and choosing the verdict that the note supports:
{"verdicts": [{"i": index, "note": "at most 25 words, citing only the figures shown", "verdict": "agrees" | "disagrees" | "partly" | "too early" | "unclear"}]}
agrees: the readings bear out the claim, including when the claim rounds a reading (4.65 stated as 4.6 or 4.7 agrees).
disagrees: ONLY when the readings measure exactly what the claim measures, for the same period and on the same basis,
and clearly contradict it beyond rounding. partly: some parts hold, some don't.
too early: a forecast or promise whose period has not arrived.
unclear: the readings measure something different (real vs nominal, a different index or publisher, a different
period, frequency or adjustment) or cannot settle it. When in doubt between disagrees and unclear, choose unclear.
Use only the figures given; no outside knowledge. Australian English, no em dashes.

${JSON.stringify(claims, null, 1)}`;
}

type Catalogue = Awaited<ReturnType<typeof catalogue>>;

/**
 * Verdicts for the claims tied to a stored series, in place: the latest readings (changes worked out in code), then the
 * verdict prompt; a note may cite only the figures it was shown. `only` limits the check to one claim (a re-check).
 * A claim left without a verdict was not checked: it shows no series.
 */
export async function checkClaims(db: SupabaseClient, claims: IncClaim[], published: string | null, cat: Catalogue, label: string, only?: number) {
  const checkable: Array<{ i: number; claim: string; series: string; readings: string[] }> = [];
  const allowed = new Map<number, number[]>();
  for (const [i, k] of claims.entries()) {
    if (only != null && i !== only) continue;
    if (!k.metric_id) continue;
    const rows = await latest(db, k.metric_id);
    if (!rows.length) { k.metric_id = null; continue; }
    checkable.push({ i, claim: k.text, series: `${k.metric_id} (${cat.names.get(k.metric_id) ?? ''})`, readings: rows.map((r) => `${r.period}: ${r.value} (change ${r.change >= 0 ? '+' : ''}${r.change})`) });
    allowed.set(i, rows.flatMap((r) => [r.value, r.change]));
  }
  if (checkable.length) {
    const v = await callClaudeJson(verdictPrompt(checkable, published), { label, maxTokens: 2000 }).catch(() => ({ verdicts: [] })) as { verdicts?: Array<{ i: number; verdict: string; note?: string }> };
    for (const r of v.verdicts ?? []) {
      const k = claims[r.i];
      if (!k || !allowed.has(r.i) || !VERDICTS.includes(r.verdict as Verdict) || r.verdict === 'unclear') continue;
      // The note may cite only the readings it was shown (or the claim's own figures).
      const shown = [...(allowed.get(r.i) ?? []), ...numbersIn(k.text)];
      const stray = numbersIn(r.note ?? '').filter((n) => !shown.some((a) => Math.abs(Math.abs(a) - n) < 0.051));
      if (stray.length) continue;
      k.verdict = r.verdict as Verdict;
      k.note = r.note ?? null;
    }
  }
  for (const [i, k] of claims.entries()) if ((only == null || i === only) && k.verdict === 'no series') k.metric_id = null;
}

/** Summaries and checked claims for the items that matter. */
export async function reviewItems(db: SupabaseClient, cands: Candidate[], log: Log): Promise<ItemRow[]> {
  if (!cands.length) return [];
  const cat = await catalogue(db);
  const picked = await callClaudeJson(pickPrompt(cands), { label: 'australia-inc picks', maxTokens: 3000 }) as { picks?: Array<{ i: number; kind?: string }> };
  const out: ItemRow[] = [];
  for (const p of (picked.picks ?? []).slice(0, MAX_PICKS)) {
    const c = cands[p.i];
    if (!c) continue;
    if (!(await urlResolves(c.url))) {
      const repaired = c.official ? await repairOfficialLink(c.url, c.title) : null;
      if (!repaired) { log(`skip (link does not resolve): ${c.title}`); continue; }
      log(`link repaired from the publisher's listing: ${c.title}`);
      c.url = repaired;
    }
    const text = await sourceText(c.url, `${c.title}\n${c.summary}`);
    try {
      const x = await callClaudeJson(extractPrompt(c, text, cat.text), { label: `australia-inc item ${p.i}`, maxTokens: 3000 }) as { summary?: string; claims?: Array<{ text?: string; metric_id?: string | null; needs?: unknown }> };
      const claims: IncClaim[] = (x.claims ?? []).slice(0, 4)
        .filter((k): k is { text: string; metric_id?: string | null; needs?: unknown } => typeof k.text === 'string' && k.text.trim().length > 0)
        // A claim's figures must be the source's own.
        .filter((k) => figuresMissingFrom(k.text, text).length === 0)
        .map((k) => {
          const metric_id = k.metric_id && cat.ids.has(k.metric_id) ? k.metric_id : null;
          // What the source scout could look for when no stored series measures the claim (official statistics only).
          const needs = metric_id ? null : normaliseNeeds(k.needs);
          return { text: k.text.trim(), metric_id, verdict: 'no series' as Verdict, note: null, ...(needs ? { needs } : {}) };
        });
      await checkClaims(db, claims, c.published_at, cat, `australia-inc verdicts ${p.i}`);
      const summary = (x.summary ?? '').trim();
      const problems = itemIssues(summary, c.publisher, text);
      const links: IncLink[] = [{ label: c.publisher || 'Source', url: c.url, kind: 'source' }];
      for (const k of claims) {
        const chart = chartPathFor(k.metric_id);
        if (chart && !links.some((l) => l.url === chart.path)) links.push({ label: chart.label, url: chart.path, kind: 'chart' });
      }
      out.push({
        rss_item_id: c.rss_item_id, title: c.title, url: c.url, publisher: c.publisher, published_at: c.published_at,
        kind: (['announcement', 'release', 'news'].includes(p.kind ?? '') ? p.kind : c.official ? 'announcement' : 'news') as IncKind,
        // A contradiction goes live only after an editor has seen it: a wrong "disagrees" is the costliest mistake here.
        summary, claims, links, status: problems.length || claims.some((k) => k.verdict === 'disagrees') ? 'new' : 'published',
      });
      const contradicts = claims.some((k) => k.verdict === 'disagrees');
      log(`${problems.length ? `held (${problems.join('; ')})` : contradicts ? 'held for the editor (our data disagrees)' : 'covered'}: ${c.publisher}: ${c.title} (${claims.filter((k) => k.verdict !== 'no series').length}/${claims.length} claims checked)`);
    } catch (e) {
      log(`failed: ${c.title}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

export async function saveItems(db: SupabaseClient, rows: ItemRow[]): Promise<ItemRow[]> {
  if (!rows.length) return [];
  const { data, error } = await db.from('inc_items').upsert(rows, { onConflict: 'url' }).select('id, url');
  if (error) throw new Error(`inc_items: ${error.message}`);
  const ids = new Map((data ?? []).map((d) => [d.url as string, d.id as string]));
  return rows.map((r) => ({ ...r, id: ids.get(r.url) }));
}

// ---------------------------------------------------------------------------------------------------- claims to the source scout

/** Claims on an official statistic we do not hold: ask the source scout for the series (capped, deduplicated). */
export async function requestMissingSeries(db: SupabaseClient, items: ItemRow[], opts: { dry: boolean; log: Log }): Promise<number> {
  const requests = items.flatMap((i) => claimRequests(i.claims, { origin: 'australia_inc', url: i.url, item_id: i.id, title: i.title }));
  if (!requests.length) return 0;
  try {
    return await fileClaimRequests(db, requests, { dry: opts.dry, log: opts.log });
  } catch (e) {
    opts.log(`claim requests failed: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

/**
 * Claims that asked the source scout for a series it has since adopted: tie each to the new series, check it once with
 * the same readings and verdict prompt, and save. A new 'disagrees' holds the item for the editor, as at review time.
 */
export async function recheckAdopted(db: SupabaseClient, opts: { dry: boolean; log: Log }): Promise<number> {
  const { dry, log } = opts;
  const adopted = await adoptedForRecheck(db, 'australia_inc');
  if (!adopted.length) return 0;
  const cat = await catalogue(db);
  let done = 0;
  for (const s of adopted) {
    const itemId = s.payload?.item_id;
    if (!itemId) { if (!dry) await markRechecked(db, s, 'no item id'); continue; }
    // The loaders add the series to the catalogue and store its readings; until they have, try again next run.
    if (!cat.ids.has(s.metric_id) || !(await latest(db, s.metric_id)).length) { log(`re-check ${s.metric_id}: not loaded yet`); continue; }
    const { data: item } = await db.from('inc_items').select('id, title, claims, links, status, published_at').eq('id', itemId).maybeSingle();
    const claims = ((item?.claims ?? []) as IncClaim[]).map((k) => ({ ...k }));
    const i = findClaim(claims, s.payload);
    if (!item || i < 0) { if (!dry) await markRechecked(db, s, 'claim no longer on the item'); continue; }
    if (claims[i].metric_id) { if (!dry) await markRechecked(db, s, `already tied to ${claims[i].metric_id}`); continue; }
    claims[i] = { ...claims[i], metric_id: s.metric_id, verdict: 'no series', note: null };
    await checkClaims(db, claims, item.published_at, cat, `australia-inc re-check ${item.id}`, i);
    const k = claims[i];
    const links = [...((item.links ?? []) as IncLink[])];
    const chart = chartPathFor(k.metric_id);
    if (chart && !links.some((l) => l.url === chart.path)) links.push({ label: chart.label, url: chart.path, kind: 'chart' });
    // A contradiction goes live only after an editor has seen it.
    const status = k.verdict === 'disagrees' ? 'new' : item.status;
    const result = `${k.verdict}${k.metric_id ? ` against ${k.metric_id}` : ''}`;
    log(`re-checked ${item.title}: "${k.text.slice(0, 80)}" -> ${result}${status !== item.status ? ' (held for the editor)' : ''}${dry ? ' (dry run)' : ''}`);
    if (!dry) {
      const { error } = await db.from('inc_items').update({ claims, links, status }).eq('id', item.id);
      if (error) { log(`  not saved: ${error.message}`); continue; }
      await markRechecked(db, s, result);
    }
    done++;
  }
  return done;
}

// ---------------------------------------------------------------------------------------------------- 3. the bottom line

function writePrompt(day: string, sources: Array<SourceRef & { summary: string; claims: IncClaim[] }>, reference: unknown, stories: Array<{ slug: string; title: string }>, issues: string[] = [], previous?: BottomLineDraft) {
  return `${CHARTER}

Write today's Bottom Line (${day}), the brief daily intro to Australia Inc.: Caveat's running commentary on how the
country is being run. It tells a busy reader, in under two minutes, what is in the news and what government announced
about the nation's bottom line, and what our data says about it.

Shape: a headline (at most 12 words, a plain statement), then 3 to 5 short paragraphs, 180 to 250 words in all.
Each paragraph is a list of sentences; each sentence names the source it reports (its number below) or null when it
states only stored data.

Rules (a sentence that breaks one holds the whole brief):
- Attribute every claim: "The Treasurer said…", "the Parliamentary Budget Office estimated…". Never state a
  government claim as fact.
- Figures come from exactly two places: the stored reference below (sentence source null; figures exactly as listed,
  or a simple change between two listed readings), or an OFFICIAL source's own text (sentence cites it and says who
  said it). A news outlet's figures are NEVER repeated, not even approximately ("fallen sharply", not "7.1 per cent"):
  report what the outlet reported without the number.
- Read the stored series before describing a trend: say a rate is rising only if its listed readings rise, and name
  a cycle (easing, tightening) only when the readings show it. Prefer one series per point; do not stack every figure.
- Do not mention data sets, checks or "reference data" at all: the reader sees findings, not plumbing.
- Lead with government announcements and official releases where there are any; news coverage comes after.
- At most 250 words. Count them. Cut a paragraph rather than run over.
- Where a claim has a verdict, say what our data shows ("ABS figures show…", "the latest readings show…").
- If you give an inflation figure, give headline CPI and the trimmed mean together and say that the trimmed mean is
  the RBA's preferred measure of underlying inflation. Otherwise leave inflation figures out.
- Australian English ("per cent", "labour", "organise"). No em dashes. No hype. Do not mention how Caveat checks.
- Links: give each paragraph 1 to 3 links. kind "source" for a source's own page (its url below), "chart" for a
  Caveat chart or dashboard (only these paths: ${linkablePaths().join(', ')}), "story" for a Caveat story
  (/stories/<slug> from the list below). The label must be words that appear in the paragraph, so the link can sit
  inline.

Sources (official = an Australian government body):
${JSON.stringify(sources.map((s) => ({ n: s.n, publisher: s.publisher, official: s.official, title: s.title, url: s.url, summary: s.summary, claims: s.claims })), null, 1)}

Stored reference (latest reading and earlier readings, newest first, per series):
${JSON.stringify(reference)}

Caveat stories that may be relevant:
${JSON.stringify(stories)}
${issues.length ? `\nYour previous draft was held for these problems. Fix every one; cut a sentence rather than keep a problem.\n${issues.map((i) => `- ${i}`).join('\n')}\nPrevious draft:\n${JSON.stringify(previous)}\n` : ''}
Reply with JSON only:
{"headline": "…", "paragraphs": [{"sentences": [{"text": "…", "source": 1 | null}], "links": [{"label": "…", "url": "…", "kind": "source" | "chart" | "story"}]}]}`;
}

export type BottomLineResult = {
  day: string; draft: BottomLineDraft; check: BottomLineCheck; status: 'published' | 'held';
  paragraphs: Array<{ text: string; links: IncLink[] }>; items: Array<{ id?: string; title: string; url: string; publisher: string }>;
};

/** Every check that fits a brief, fail closed. */
export async function checkBottomLine(db: SupabaseClient, draft: BottomLineDraft, sources: SourceRef[], metricIds: string[], known: KnownPaths)
  : Promise<{ check: BottomLineCheck; links: IncLink[][] }> {
  const { issues, warnings } = validateDraft(draft, sources);

  // Links: internal pages must exist, external ones must answer 200. A link that fails is dropped, not published.
  const external = new Map<string, boolean>();
  for (const url of new Set(draft.paragraphs.flatMap((p) => p.links.map((l) => l.url)).filter((u) => !u.startsWith('/')))) external.set(url, await urlResolves(url));
  const links = draft.paragraphs.map((p, i) => {
    const { kept, dropped } = filterLinks(p.links, known, external);
    for (const d of dropped) warnings.push(`paragraph ${i + 1}: link dropped, it does not resolve (${d.url})`);
    return kept;
  });
  // The page a sourced sentence reports must itself resolve.
  for (const s of sources) {
    if (draft.paragraphs.some((p) => p.sentences.some((x) => x.source === s.n)) && !(await urlResolves(s.url))) issues.push(`source ${s.n} (${s.url}) does not resolve`);
  }

  // Figures that must come from stored data: the publish gate's figure check.
  const ids = [...new Set(metricIds)];
  if (dataFigures(draft, sources).length) {
    const fc = await factCheckStory(db, toCheckable(draft, sources, { dataOnly: true }), ids);
    // A brief has no chart: the gate's chart rules are for stories.
    issues.push(...fc.issues.filter((i) => i !== 'no chart'));
    warnings.push(...(fc.warnings ?? []));
  }

  // The strict part: claim audit against stored data, and sourced statements against their documents.
  const story = toCheckable(draft, sources);
  let auditRan = false;
  let sourcesRan = false;
  let claims: BottomLineCheck['claims'];
  if (!process.env.ANTHROPIC_API_KEY?.trim()) issues.push('claim audit could not run: no ANTHROPIC_API_KEY');
  else {
    try {
      const audit = await auditClaims(db, story, ids);
      claims = audit.claims;
      for (const c of audit.unsupported) issues.push(`claim not supported by stored data: "${c.claim}" (${c.evidence})`);
      auditRan = true;
    } catch (e) { issues.push(`claim audit failed: ${e instanceof Error ? e.message : String(e)}`); }
    try {
      const src = await verifySourcedStatements(db, story);
      issues.push(...src.issues);
      // And, mechanically: every figure in a sourced sentence is in its document.
      for (const p of draft.paragraphs) {
        for (const s of p.sentences) {
          if (!isSourcedSentence(s, sources) || !numbersIn(s.text).length) continue;
          const ref = sources.find((x) => x.n === s.source)!;
          const doc = await ensureDocument(db, ref.url, { pdfText }) as { body?: string; error?: string };
          if (doc.error || !doc.body) { issues.push(`source: ${ref.url} could not be read (${doc.error ?? 'empty'})`); continue; }
          const missing = figuresMissingFrom(s.text, doc.body);
          if (missing.length) issues.push(`source: ${missing.join(', ')} not in ${ref.publisher}'s document ("${s.text.slice(0, 90)}")`);
        }
      }
      sourcesRan = true;
    } catch (e) { issues.push(`source check failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const audited = auditRan && sourcesRan;
  const { ok } = decide({ issues, audited });
  return { check: { ok, audited, issues, warnings, claims, checked_at: new Date().toISOString() }, links };
}

export async function writeBottomLine(db: SupabaseClient, newItems: ItemRow[], opts: { dry: boolean; log: Log; day?: string }): Promise<BottomLineResult | null> {
  const { log } = opts;
  const day = opts.day ?? sydneyDay();
  const since = new Date(Date.now() - HOURS * 3600e3).toISOString();
  const { data: stored } = await db.from('inc_items').select('id, title, url, publisher, published_at, summary, claims, status')
    .eq('status', 'published').gte('created_at', since).order('published_at', { ascending: false }).limit(12);
  const pool = [...newItems.filter((i) => i.status === 'published'), ...(stored ?? []) as ItemRow[]];
  const seen = new Set<string>();
  const items = pool.filter((i) => !seen.has(i.url) && seen.add(i.url)).slice(0, 12);
  if (!items.length) { log('bottom line: nothing published in the commentary in the last 36 hours; no brief today'); return null; }

  // A claim's request to the source scout (needs) is plumbing, not something the brief reports.
  const sources = items.map((i, k) => ({ n: k + 1, title: i.title, url: i.url, publisher: i.publisher ?? '', official: isOfficialUrl(i.url), summary: i.summary ?? '', claims: ((i.claims ?? []) as IncClaim[]).map(({ needs: _needs, ...rest }) => rest) }));
  const cat = await catalogue(db);
  const metricIds = [...new Set(['cash_rate_au', 'unemployment_rate_au', ...sources.flatMap((s) => s.claims.map((c) => c.metric_id).filter((x): x is string => Boolean(x)))])].filter((id) => cat.ids.has(id));
  const reference = await buildReference(db, metricIds, { history: 12 });
  const { data: storyRows } = await db.from('stories').select('slug, title').eq('status', 'published').order('published', { ascending: false }).limit(40);
  const stories = (storyRows ?? []) as Array<{ slug: string; title: string }>;
  const known: KnownPaths = { stories: new Set(stories.map((s) => s.slug)) };

  let draft = normaliseDraft(await callClaudeJson(writePrompt(day, sources, reference, stories), { label: 'bottom line', maxTokens: 4000 }));
  // One rewrite for the brief's own rules before the expensive checks.
  const first = validateDraft(draft, sources);
  if (first.issues.length) {
    log(`bottom line: rewriting for ${first.issues.length} issue(s)`);
    draft = normaliseDraft(await callClaudeJson(writePrompt(day, sources, reference, stories, first.issues, draft), { label: 'bottom line rewrite', maxTokens: 4000 }));
  }
  let { check, links } = await checkBottomLine(db, draft, sources, metricIds, known);
  // Up to two revision rounds with the full findings, then the verdict stands.
  for (let round = 1; round <= 2 && !check.ok && check.audited; round++) {
    log(`bottom line: held for ${check.issues.length} issue(s); revision ${round}`);
    const revised = normaliseDraft(await callClaudeJson(writePrompt(day, sources, reference, stories, check.issues, draft), { label: `bottom line revision ${round}`, maxTokens: 4000 }));
    const again = await checkBottomLine(db, revised, sources, metricIds, known);
    draft = revised; check = again.check; links = again.links;
  }
  // Held only for sentences that break the figures or wording rules: cut them, re-validate, and keep the day.
  if (!check.ok && check.audited) {
    const cut = dropFlaggedSentences(draft, links, check.issues);
    if (cut) {
      const again = validateDraft(cut.draft, sources);
      if (!again.issues.length) {
        log(`bottom line: cut ${cut.dropped.length} sentence(s) that broke the figures rule`);
        draft = cut.draft; links = cut.links;
        check = { ...check, ok: true, issues: [], warnings: [...check.warnings, ...again.warnings, ...cut.dropped.map((t) => `cut: ${t}`)] };
      }
    }
  }
  const { status } = decide(check);
  const used = new Set(draft.paragraphs.flatMap((p) => p.sentences.map((s) => s.source)).filter((n): n is number => n != null));
  const result: BottomLineResult = {
    day, draft, check, status,
    paragraphs: draft.paragraphs.map((p, i) => ({ text: sentenceText(p), links: normaliseLinks(links[i]) })),
    items: items.filter((_, k) => used.has(k + 1)).map((i) => ({ id: i.id, title: i.title, url: i.url, publisher: i.publisher })),
  };
  log(`bottom line ${day}: ${status}${check.issues.length ? `\n  ${check.issues.join('\n  ')}` : ''}`);
  if (opts.dry) return result;

  const { data: existing } = await db.from('bottom_lines').select('status').eq('day', day).maybeSingle();
  if (!shouldWrite(existing, { status })) { log('bottom line: today\'s published brief is kept; the re-run did not pass'); return result; }
  const { error } = await db.from('bottom_lines').upsert({
    day, status, headline: draft.headline, paragraphs: result.paragraphs, items: result.items, check,
    published_at: status === 'published' ? new Date().toISOString() : null,
  }, { onConflict: 'day' });
  if (error) throw new Error(`bottom_lines: ${error.message}`);
  return result;
}
