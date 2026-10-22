import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { storeDocument } from '../../agent/scripts/lib/source-docs.mjs';
import { publisherOf } from '../../agent/scripts/lib/html-text.mjs';
import { fileClaimRequests, slug as requestSlug } from '../../agent/scripts/lib/claim-requests.mjs';
import { loadObservations } from '@/lib/chart-from-data';
import { inSource, norm, verifySourcedStatements } from '@/lib/source-check';
import { fetchLive, readOfficial } from '@/lib/official-fetch';
import {
  TERMS, afterUpsert, assess, baselineObs, changedFields, claimSentence, coversStart, decideStatus, dedupeCandidates, latestObs, measurability,
  mergeTouched, normaliseDraft, readingIssues, requestFor, type CommitmentDraft, type Obs, type Status,
} from '@/lib/scorecard';
import { OUTCOMES } from '@/lib/scorecard-outcomes';
import { SEED, SEED_SOURCES } from '@/lib/scorecard-seed';
import { seriesOf } from '@/lib/scorecard-loader';

/**
 * Scorecard maintenance (web/scripts/scorecard.ts, tasks scorecard / scorecard-dry-run; weekly and after releases):
 *   1. first run (no commitments stored): draft the list from official documents (the verified seed candidates, plus
 *      what the model finds in SEED_SOURCES); later runs: read the australia_inc beat's recent official items for new,
 *      changed or withdrawn commitments;
 *   2. the strict check on every new or changed commitment and, each run, on every stored one: the quote must be in
 *      the document's own text (mechanical), and the source check (lib/source-check.ts) must confirm the quote and the
 *      target read from it. Fail closed: anything short of that is 'held';
 *   3. ratings for live commitments, from the stored series; a change is logged (The Bottom Line reads the log);
 *   4. official series the scorecard needs but the store lacks are requested from the source scout.
 * Nothing is approved by an editor; everything is logged in scorecard_log and shown on the newsdesk.
 */

type Log = (line: string) => void;
type Stored = CommitmentDraft & { id: string; status: Status; rating: string | null; check: Record<string, unknown> };
type CheckResult = {
  quote_found: boolean; audited: boolean; confirmed: boolean; issues: string[]; checked_at: string; title?: string | null;
  /** Which copy the quote was checked against: the live page, or the stored copy (with the date it was fetched). */
  verified_against?: 'live' | 'cache' | null; document_fetched_at?: string | null; document_note?: string | null;
  /** Our reading of the quote and the reason for the pace start (methodology, shown on the page). */
  basis?: { target_text: string | null; deadline_text: string | null; start_basis: string | null };
};

const BEAT_DAYS = 8;
const MAX_ITEMS = 25;

// ---------------------------------------------------------------------------------------------------- the strict check

/** An official document, live or from the stored copy (lib/official-fetch.ts). Dry runs store nothing. */
async function readDoc(db: SupabaseClient, url: string, dry: boolean): Promise<{ title?: string | null; body?: string; error?: string; via?: 'live' | 'cache'; fetched_at?: string; note?: string }> {
  const r = await readOfficial(db, url, { store: !dry });
  return r.ok ? { title: r.doc.title, body: r.doc.body, via: r.via, fetched_at: r.fetched_at, note: r.note } : { error: r.error };
}

/** The quote is really in the document: every fragment of it, compared on words and figures (inSource). */
export function quoteInDocument(quote: string, body: string): boolean {
  return inSource(quote, [norm(body)]);
}

const basisOf = (d: CommitmentDraft) => ({ target_text: d.target_text ?? null, deadline_text: d.deadline_text ?? null, start_basis: d.start_basis ?? null });

/**
 * The strict check. Mechanical first: the document is read (live, else its stored copy), the quote is in its text, and
 * the target and deadline we read are the quote's own words. Then the source check judges only the quote with those
 * words (claimSentence): never our start date or baseline, which are methodology.
 */
export async function strictCheck(db: SupabaseClient, d: CommitmentDraft, dry: boolean): Promise<CheckResult> {
  const issues: string[] = [];
  const checked_at = new Date().toISOString();
  const basis = basisOf(d);
  const doc = await readDoc(db, d.source_url, dry);
  if (doc.error || !doc.body) return { quote_found: false, audited: false, confirmed: false, issues: [doc.error ?? 'source could not be read: empty'], checked_at, basis };
  const where = { verified_against: doc.via ?? null, document_fetched_at: doc.fetched_at ?? null, document_note: doc.note ?? null };
  const quote_found = quoteInDocument(d.quote, doc.body);
  if (!quote_found) issues.push(`the quote is not in the document text (${doc.note})`);
  const reading = readingIssues(d);
  issues.push(...reading);
  const fail = { quote_found, audited: false, confirmed: false, checked_at, title: doc.title, basis, ...where };
  if (!quote_found || reading.length) return { ...fail, issues };
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return { ...fail, issues: [...issues, 'source check could not run: no ANTHROPIC_API_KEY'] };
  try {
    const story = {
      hook: claimSentence(d),
      evidence: { sources: [], footnotes: [{ n: 1, text: d.source_title ?? doc.title ?? d.source_url, url: d.source_url }] },
      body: { blocks: [] },
    };
    // The source check reads the same copy we just read, so a page the runner cannot reach is checked from its stored copy.
    const res = await verifySourcedStatements(db, story, { documents: new Map([[d.source_url, { url: d.source_url, title: doc.title ?? null, body: doc.body }]]) });
    issues.push(...res.issues);
    const audited = res.checked >= 1;
    return { ...fail, audited, confirmed: audited && res.issues.length === 0, issues };
  } catch (e) {
    return { ...fail, issues: [...issues, `source check failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ---------------------------------------------------------------------------------------------------- series

async function auSeries(db: SupabaseClient, metricId: string): Promise<Obs[]> {
  return (await loadObservations(db, metricId).catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
}

async function catalogue(db: SupabaseClient): Promise<{ text: string; ids: Set<string> }> {
  const { data } = await db.from('metrics').select('metric_id, name, unit').limit(3000);
  const rows = (data ?? []).filter((m) => !/^(fx_|pnl_)/.test(m.metric_id));
  return { text: rows.filter((m) => !/^pop_/.test(m.metric_id)).map((m) => `${m.metric_id}: ${m.name} (${m.unit ?? ''})`).join('\n'), ids: new Set(rows.map((m) => m.metric_id as string)) };
}

// ---------------------------------------------------------------------------------------------------- drafting

const DRAFT_RULES = `Rules (a commitment that breaks one is left out):
- Only the current federal government's own commitments with a NUMERIC target and a DEADLINE, stated in an official
  document (a minister's release, budget papers, legislation, a department's program page). Never a forecast, a
  projection, an aspiration without a number, or a party (non-government) document.
- "quote": the sentence stating the target, copied EXACTLY, character for character, from the document text given.
- "target_text": the words of the quote that state the target, copied exactly ("43% below 2005 levels"); its figure is
  target_value. "deadline_text": the words of the quote that state the deadline, copied exactly ("by 2030", "over five
  years, from 1 July 2024"). Both must appear in the quote as written.
- "start_basis": one sentence on why pace is counted from start_date ("The Accord period begins 1 July 2024, as the
  source states." or "Start of the government's first term, when the target was set."). This is our methodology, not
  something the document says, unless it does.
- Only targets an official statistical series can measure. "metric_id": an id from the catalogue below that measures
  exactly this target, or null; when null, "needs": {"series": "...", "org": "the official publisher"}.
- "method": cumulative_sum (a count summed over the period: homes built), level (a rate or level reached by the
  deadline: a bulk billing rate), share (a share reached: renewable share of generation), change (a % change from a
  reference level, with baseline_value = that level when the series gives it, else null).
- "start_date": when the commitment starts counting (the document says, e.g. "from 1 July 2024"), else the start of
  the government term in which it was made (21 May 2022 or 3 May 2025). "target_date": the deadline; "by 2030" is 2030-12-31 unless the document names a financial year
  (then 30 June). ISO dates.
- One entry per target: the same target stated in several documents is ONE commitment (use the clearest quote).
- Leave out targets due after 2031, and program outputs (contracted capacity, places funded, grants) that no official
  statistic measures.
- "title": a plain description of the target, no adjectives about the government. Australian English, no em dashes.`;

function draftPrompt(docs: Array<{ url: string; title: string; text: string }>, cat: string, existing: string[]) {
  return `You maintain the list of the Australian federal government's measurable commitments for a news site's
scorecard. Read the official documents below and list every commitment that fits the rules.

${DRAFT_RULES}

Already on the list (slugs): ${existing.join(', ') || 'none'}. List only new commitments, or one already listed whose
target, deadline or wording has changed (same slug).

Series catalogue (metric_id: name (unit)):
${cat}

Documents:
${docs.map((d) => `<document url="${d.url}" title="${d.title.replace(/"/g, "'")}">\n${d.text}\n</document>`).join('\n')}

Reply with JSON only:
{"commitments":[{"slug":"...","title":"...","quote":"...","source_url":"...","source_title":"...","source_date":"YYYY-MM-DD"|null,
"metric_id":"..."|null,"series_label":"...","needs":{"series":"...","org":"..."}|null,"target_value":0,"target_unit":"...",
"target_text":"...","deadline_text":"...","start_date":"YYYY-MM-DD","start_basis":"...","target_date":"YYYY-MM-DD",
"direction":"increase"|"decrease","baseline_value":null,"method":"..."}],
"withdrawn":[{"slug":"...","source_url":"...","quote":"the exact words saying the target was dropped or replaced"}]}`;
}

async function draftFrom(db: SupabaseClient, urls: string[], existing: string[], dry: boolean, log: Log) {
  const docs: Array<{ url: string; title: string; text: string }> = [];
  for (const url of urls) {
    const d = await readDoc(db, url, dry);
    if (d.error || !d.body) { log(`  could not read ${url} (${d.error ?? 'empty'})`); continue; }
    docs.push({ url, title: d.title ?? url, text: d.body.slice(0, 12_000) });
  }
  if (!docs.length) return { drafts: [] as CommitmentDraft[], withdrawn: [] as Array<{ slug: string; source_url: string; quote: string }> };
  if (!process.env.ANTHROPIC_API_KEY?.trim()) { log('  drafting skipped: no ANTHROPIC_API_KEY'); return { drafts: [], withdrawn: [] }; }
  const reply = await callClaudeJson(draftPrompt(docs, (await catalogue(db)).text, existing), { label: 'scorecard draft', maxTokens: 8000 }) as { commitments?: unknown[]; withdrawn?: unknown[] };
  const drafts: CommitmentDraft[] = [];
  for (const raw of reply.commitments ?? []) {
    const n = normaliseDraft(raw);
    if (!n.ok) { log(`  draft left out: ${n.reason} (${String((raw as { title?: string })?.title ?? '').slice(0, 80)})`); continue; }
    // A draft whose target or deadline is not the quote's own words never reaches the table.
    const reading = readingIssues(n.draft);
    if (reading.length) { log(`  draft left out: ${reading.join('; ')} (${n.draft.title})`); continue; }
    drafts.push(n.draft);
  }
  const withdrawn = (reply.withdrawn ?? []).filter((w): w is { slug: string; source_url: string; quote: string } =>
    !!w && typeof (w as { slug?: unknown }).slug === 'string' && typeof (w as { quote?: unknown }).quote === 'string' && typeof (w as { source_url?: unknown }).source_url === 'string');
  return { drafts, withdrawn };
}

/** Official items from the australia_inc beat in the last week: where new, changed and withdrawn commitments appear. */
async function beatUrls(db: SupabaseClient): Promise<string[]> {
  const { data: feeds, error } = await db.from('rss_feeds').select('feed_id').eq('beat', 'australia_inc');
  if (error || !feeds?.length) return [];
  const since = new Date(Date.now() - BEAT_DAYS * 864e5).toISOString();
  const { data } = await db.from('rss_items').select('link, title').in('feed_id', feeds.map((f) => f.feed_id)).gte('published_at', since)
    .order('published_at', { ascending: false }).limit(200);
  // Commitments are numbers with deadlines: read only items that mention a target-like phrase.
  const hits = (data ?? []).filter((r) => r.link && /\.gov\.au\b/.test(r.link) && /\btarget|\bby 20\d\d|\bmillion\b|per cent|\bpromise|\bcommit/i.test(r.title ?? ''));
  return [...new Set(hits.map((r) => r.link as string))].slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------------------------------- saving

async function logEntry(db: SupabaseClient, dry: boolean, log: Log, e: { commitment_id?: string | null; slug: string; kind: string; from_value?: string | null; to_value?: string | null; reason?: string; detail?: Record<string, unknown> }) {
  log(`  log ${e.kind}: ${e.slug}${e.from_value || e.to_value ? ` (${e.from_value ?? '-'} -> ${e.to_value ?? '-'})` : ''}${e.reason ? `: ${e.reason}` : ''}${dry ? ' (dry run)' : ''}`);
  if (dry) return;
  const { error } = await db.from('scorecard_log').insert({ commitment_id: e.commitment_id ?? null, slug: e.slug, kind: e.kind, from_value: e.from_value ?? null, to_value: e.to_value ?? null, reason: e.reason ?? null, detail: e.detail ?? {} });
  if (error) log(`  log not saved: ${error.message}`);
}

async function statusFor(db: SupabaseClient, d: CommitmentDraft, check: CheckResult): Promise<Status> {
  const covered = d.metric_id ? coversStart(d, await auSeries(db, d.metric_id)) : false;
  return decideStatus({ ...check, metric_id: d.metric_id, covered });
}

const rowOf = (d: CommitmentDraft, status: Status, check: CheckResult) => ({
  slug: d.slug, title: d.title, quote: d.quote, source_url: d.source_url, source_title: d.source_title ?? check.title ?? null, source_date: d.source_date,
  metric_id: d.metric_id, series_label: d.series_label, data_note: d.data_note, target_value: d.target_value, target_unit: d.target_unit,
  target_date: d.target_date, start_date: d.start_date, direction: d.direction, baseline_value: d.baseline_value, baseline_period: d.baseline_period,
  method: d.method, status, check,
});

/**
 * A new or changed commitment: check it, store it with the status the check allows, log what happened. Returns the
 * row as it now stands, or null when nothing was checked (unchanged) or saved.
 */
async function upsertDraft(db: SupabaseClient, d: CommitmentDraft, prev: Stored | undefined, opts: { dry: boolean; log: Log }): Promise<Stored | null> {
  const { dry, log } = opts;
  const changes = prev ? changedFields(prev, d) : [];
  if (prev && !changes.length) return null;
  const check = await strictCheck(db, d, dry);
  const status = await statusFor(db, d, check);
  log(`${prev ? 'changed' : 'new'}: ${d.title} -> ${status}${check.issues.length ? ` (${check.issues.join('; ')})` : ''}`);
  // A changed commitment that does not pass keeps the live version; the failed change is logged, not applied.
  if (prev && status === 'held' && prev.status !== 'held') {
    await logEntry(db, dry, log, { commitment_id: prev.id, slug: d.slug, kind: 'held', from_value: prev.status, to_value: prev.status, reason: `a change (${changes.join(', ')}) did not pass the strict check: ${check.issues.join('; ')}`, detail: { draft: d } });
    return prev;
  }
  let id = prev?.id ?? null;
  if (!dry) {
    const { data, error } = await db.from('scorecard_commitments').upsert(rowOf(d, status, check), { onConflict: 'slug' }).select('id').single();
    if (error) { log(`  not saved: ${error.message}`); return null; }
    id = data.id;
  }
  const kind = !prev ? (status === 'active' ? 'added' : status) : 'changed';
  await logEntry(db, dry, log, {
    commitment_id: id, slug: d.slug, kind, from_value: prev ? changes.map((k) => `${k}: ${String(prev[k as keyof CommitmentDraft] ?? '')}`).join('; ') : null,
    to_value: prev ? changes.map((k) => `${k}: ${String(d[k as keyof CommitmentDraft] ?? '')}`).join('; ') : status,
    reason: `${check.quote_found ? 'quote found in the document' : 'quote not found'}; ${check.confirmed ? 'source check confirmed it' : check.issues.join('; ') || 'not confirmed'}`,
    detail: { source_url: d.source_url, metric_id: d.metric_id, check },
  });
  // A change that also moves the status (a series arrived: awaiting_data -> active) is logged as that move too.
  if (prev && prev.status !== status) {
    await logEntry(db, dry, log, { commitment_id: id, slug: d.slug, kind: status === 'active' ? 'activated' : status, from_value: prev.status, to_value: status, reason: check.issues.join('; ') || 'passed the strict check', detail: { metric_id: d.metric_id, check } });
  }
  return afterUpsert<Stored>(prev, d, status, check as unknown as Stored['check'], id);
}

/** Withdrawn: retired only when the words saying so are found in an official document and confirmed. */
async function retire(db: SupabaseClient, w: { slug: string; source_url: string; quote: string }, prev: Stored | undefined, opts: { dry: boolean; log: Log }) {
  if (!prev || prev.status === 'retired') return;
  const doc = await readDoc(db, w.source_url, opts.dry);
  if (!/\.gov\.au\b/.test(w.source_url) || doc.error || !doc.body || !quoteInDocument(w.quote, doc.body)) {
    opts.log(`withdrawal of ${w.slug} not applied: the words were not found in an official document (${w.source_url})`);
    return;
  }
  if (!opts.dry) await db.from('scorecard_commitments').update({ status: 'retired' }).eq('id', prev.id);
  await logEntry(db, opts.dry, opts.log, { commitment_id: prev.id, slug: prev.slug, kind: 'removed', from_value: prev.status, to_value: 'retired', reason: `"${w.quote.slice(0, 300)}"`, detail: { source_url: w.source_url } });
}

/** Every stored commitment, each run: the quote re-checked against its document; status changes logged. */
async function reverify(db: SupabaseClient, rows: Stored[], opts: { dry: boolean; log: Log }) {
  for (const r of rows.filter((x) => x.status !== 'retired')) {
    const check = await strictCheck(db, r, opts.dry);
    const status = await statusFor(db, r, check);
    if (status !== r.status) {
      opts.log(`re-check ${r.slug}: ${r.status} -> ${status}${check.issues.length ? ` (${check.issues.join('; ')})` : ''}`);
      await logEntry(db, opts.dry, opts.log, { commitment_id: r.id, slug: r.slug, kind: status === 'active' ? 'activated' : status === 'held' ? 'held' : 'awaiting_data', from_value: r.status, to_value: status, reason: check.issues.join('; ') || 'passed the strict check', detail: { check } });
    }
    if (!opts.dry) await db.from('scorecard_commitments').update({ status, check }).eq('id', r.id);
    r.status = status;
  }
}

/** Ratings for live commitments; a change is logged with the reading behind it. */
async function rate(db: SupabaseClient, rows: Stored[], opts: { dry: boolean; log: Log }): Promise<number> {
  let changed = 0;
  for (const r of rows.filter((x) => x.status === 'active' && x.metric_id)) {
    const a = assess(r, await auSeries(db, r.metric_id!));
    opts.log(`rating ${r.slug}: ${a.rating}${a.latestPeriod ? ` (to ${a.latestPeriod}${a.pct != null ? `, ${a.pct.toFixed(1)}% of target` : ''}${a.ratio != null ? `, pace ratio ${a.ratio.toFixed(2)}` : ''})` : ''}`);
    if (a.rating === r.rating) continue;
    changed++;
    if (!opts.dry) await db.from('scorecard_commitments').update({ rating: a.rating }).eq('id', r.id);
    await logEntry(db, opts.dry, opts.log, {
      commitment_id: r.id, slug: r.slug, kind: 'rating', from_value: r.rating, to_value: a.rating, reason: a.note,
      detail: { title: r.title, metric_id: r.metric_id, series_label: r.series_label, latest_period: a.latestPeriod, progress: a.progress, pct: a.pct, pace_achieved: a.paceAchieved, pace_needed: a.paceNeeded, ratio: a.ratio },
    });
  }
  return changed;
}

/**
 * Official series the scorecard needs but the store lacks: one request per subject, under a fixed wording
 * (CANONICAL_REQUESTS), so differently worded drafts and repeated runs never file the same series twice; then
 * fileClaimRequests skips anything already pending, approved or recently rejected.
 */
async function requestSeries(db: SupabaseClient, rows: Array<CommitmentDraft & { status?: Status }>, catalogueIds: Set<string>, opts: { dry: boolean; log: Log }): Promise<number> {
  const requests: Array<{ key: string; row: Record<string, unknown> }> = [];
  const add = (key: string, series: string, org: string, why: string, url: string | null) => {
    if (!key || requests.some((r) => r.key === key || r.row.summary === series)) return;
    requests.push({ key, row: { action: 'register_data_source', status: 'pending', summary: series, payload: { series, org, tier: 1, why, url, origin: 'scorecard' } } });
  };
  for (const r of rows) {
    if (r.status === 'held' || r.status === 'retired' || r.status === 'active') continue;
    if (r.metric_id && catalogueIds.has(r.metric_id)) continue;
    const m = measurability(r, catalogueIds);
    const req = requestFor(r);
    if (m.ok && m.via === 'request' && req) add(req.key, req.series, req.org, `The government scorecard measures "${r.title}" with it.`, r.source_url);
  }
  // Outcomes whose series is missing or does not reach back to the first term's baseline.
  for (const d of OUTCOMES) {
    const obs = await seriesOf(db, d.primary).catch(() => [] as Obs[]);
    if (latestObs(obs) && baselineObs(obs, TERMS['2022'].date)) continue;
    if (d.key === 'debt') add('government-debt', 'General government gross debt, per cent of GDP, Australia, quarterly or annual', 'IMF', 'The government scorecard compares debt with the start of each term; the stored series does not reach back.', null);
  }
  if (!requests.length) return 0;
  try { return await fileClaimRequests(db, requests.map(({ row }) => ({ key: requestSlug(String(row.summary)), row })), { dry: opts.dry, log: opts.log }); } catch (e) { opts.log(`series requests failed: ${e instanceof Error ? e.message : e}`); return 0; }
}

// ---------------------------------------------------------------------------------------------------- the run

/** A stored row with numbers as numbers and our reading of the quote restored from check.basis. */
function toStored(r: Record<string, unknown>): Stored {
  const basis = ((r.check as { basis?: Record<string, string | null> } | null)?.basis ?? {});
  return {
    ...r, target_value: Number(r.target_value), baseline_value: r.baseline_value == null ? null : Number(r.baseline_value),
    target_text: basis.target_text ?? null, deadline_text: basis.deadline_text ?? null, start_basis: basis.start_basis ?? null,
  } as unknown as Stored;
}

/**
 * Candidates worth checking: duplicates removed (seeds first, then what is already stored, so a redraft of a stored
 * commitment is compared with it rather than added again), and only those an official statistic can measure.
 */
export function prepareCandidates(list: CommitmentDraft[], stored: CommitmentDraft[], catalogueIds: Set<string>, log: Log): CommitmentDraft[] {
  const storedSlugs = new Set(stored.map((r) => r.slug));
  // A candidate with a stored slug is a possible change: upsertDraft compares it with the stored row.
  const changes = list.filter((d) => storedSlugs.has(d.slug));
  const { kept, dropped } = dedupeCandidates([...stored, ...list.filter((d) => !storedSlugs.has(d.slug))]);
  for (const x of dropped) log(`  duplicate left out: ${x.draft.title} (same as ${x.duplicateOf})`);
  const out: CommitmentDraft[] = [];
  for (const d of [...changes, ...kept.filter((k) => !storedSlugs.has(k.slug))]) {
    if (out.some((o) => o.slug === d.slug)) continue;
    const m = measurability(d, catalogueIds);
    if (!m.ok) { log(`  left out: ${d.title} (${m.reason})`); continue; }
    out.push(d);
  }
  return out;
}

export async function runScorecard(db: SupabaseClient, opts: { dry: boolean; log: Log }) {
  const { dry, log } = opts;
  const { data, error } = await db.from('scorecard_commitments').select('*');
  if (error && !dry) { log(`scorecard_commitments: ${error.message} (has migration 49 run?)`); return { installed: false }; }
  if (error) log(`scorecard_commitments: ${error.message} (dry run continues as a first run)`);
  const stored = ((data ?? []) as Array<Record<string, unknown>>).map(toStored);
  const bySlug = new Map(stored.map((r) => [r.slug, r]));
  const first = !stored.length;

  // 1. drafts: the seed candidates and the documents on a first run; the beat's recent official items after.
  const urls = first ? SEED_SOURCES : await beatUrls(db);
  log(first ? `first run: drafting from ${urls.length} official page(s) and ${SEED.length} seed candidate(s)` : `${urls.length} official item(s) on the beat to read for commitments`);
  const { drafts, withdrawn } = urls.length ? await draftFrom(db, urls, stored.map((r) => r.slug), dry, log) : { drafts: [], withdrawn: [] };
  const cat = await catalogue(db);
  // The seed list is always offered: a seed corrected in code (a new source, say) reaches its stored row as a change.
  const candidates = prepareCandidates([...SEED, ...drafts], stored, cat.ids, log);

  // 2. the strict check: new and changed commitments, withdrawals, then every other stored one again.
  const touched = new Map<string, Stored>();
  for (const d of candidates) { const r = await upsertDraft(db, d, bySlug.get(d.slug), opts); if (r) touched.set(d.slug, r); }
  for (const w of withdrawn) await retire(db, w, bySlug.get(w.slug), opts);
  const merged = mergeTouched(stored, touched);
  if (!first) await reverify(db, merged.recheck, opts);

  // 3. ratings, from the stored rows as they are now (in a dry run, as they would be).
  const { data: now } = dry ? { data: null } : await db.from('scorecard_commitments').select('*');
  const current = now ? (now as Array<Record<string, unknown>>).map(toStored) : merged.rows;
  const ratingChanges = await rate(db, current, opts);

  // 4. series requests.
  const requested = await requestSeries(db, first ? candidates.map((c) => ({ ...c, status: 'awaiting_data' as Status })) : current, cat.ids, opts);
  const summary = { first, candidates: candidates.length, withdrawn: withdrawn.length, rating_changes: ratingChanges, requested };
  if (!dry) await db.from('agent_runs').insert({ notes: `scorecard: ${JSON.stringify(summary)}` });
  return { installed: true, ...summary };
}

/**
 * The quotes-only check: no database, no model. Reads each seed candidate's live document (browser-like headers, with
 * retries) and reports whether its quote is in the text and its target and deadline are the quote's own words.
 */
export async function checkSeedQuotes(log: Log): Promise<boolean> {
  let ok = true;
  for (const d of SEED) {
    const doc = await fetchLive(d.source_url);
    const found = !!doc.body && quoteInDocument(d.quote, doc.body);
    const reading = readingIssues(d);
    ok &&= found && !reading.length;
    log(`${found ? 'found    ' : 'NOT FOUND'} ${d.slug} (${doc.error ?? doc.title ?? ''})${reading.length ? `; ${reading.join('; ')}` : ''}`);
  }
  return ok;
}

/**
 * Seed the stored copies (source_documents) from a machine that can reach the official pages, for when the runner
 * cannot: every seed and stored commitment's source and the first-run reading list, fetched live and stored. The next
 * run checks quotes against these copies and records that it did, with the date they were fetched. Official
 * publishers only.
 */
export async function cacheSources(db: SupabaseClient, log: Log): Promise<{ stored: number; failed: number }> {
  const { data } = await db.from('scorecard_commitments').select('source_url');
  const urls = [...new Set([...SEED.map((d) => d.source_url), ...(data ?? []).map((r) => r.source_url as string), ...SEED_SOURCES])];
  let stored = 0, failed = 0;
  for (const url of urls) {
    if (!publisherOf(url)) { log(`skipped (not an official publisher): ${url}`); continue; }
    const doc = await fetchLive(url);
    if (doc.error || !doc.body) { failed++; log(`could not read ${url} (${doc.error ?? 'empty'})`); continue; }
    const res = await storeDocument(db, { url, title: doc.title ?? null, body: doc.body });
    stored++;
    log(`${res}: ${url} (${doc.title ?? ''}, ${doc.body.length} characters)`);
  }
  return { stored, failed };
}

/** Rating changes logged in the last hours, for The Bottom Line (empty before migration 49). */
export async function recentRatingChanges(db: SupabaseClient, hours = 36) {
  try {
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    const { data, error } = await db.from('scorecard_log').select('slug, from_value, to_value, reason, detail, created_at').eq('kind', 'rating').gte('created_at', since).order('created_at', { ascending: false }).limit(10);
    if (error) return [];
    return (data ?? []).map((r) => ({
      commitment: String((r.detail as { title?: string })?.title ?? r.slug), from: r.from_value as string | null, to: r.to_value as string,
      series: String((r.detail as { series_label?: string })?.series_label ?? (r.detail as { metric_id?: string })?.metric_id ?? ''),
      metric_id: ((r.detail as { metric_id?: string })?.metric_id ?? null) as string | null,
      latest_period: ((r.detail as { latest_period?: string })?.latest_period ?? null) as string | null,
    }));
  } catch { return []; }
}
