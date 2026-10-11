/**
 * Economists' commentary, read against the data.
 *
 *   node scripts/run-economist-review.mjs            fetch the feeds, review what's new
 *   node scripts/run-economist-review.mjs --dry-run  fetch the feeds and list what is new; store and review nothing
 *
 * 1. Feeds in config/economists.json are fetched; new items from the last 14 days go into economist_notes
 *    (approved senders' emails arrive there from the inbound webhook).
 * 2. For each new note the model reads the piece and returns: whether it is about the Australian economy, a summary,
 *    the claims (attributed: forecasts, views, figures), the series each checkable claim is about (chosen from the
 *    catalogue of stored series), and a possible Caveat angle.
 * 3. For each claim tied to a series, the latest official readings are fetched and the model gives a verdict
 *    (agrees, disagrees, partly, too early for a forecast) with a one-line note citing the figures it was shown.
 * Economists' views are tier-3 context: never headline figures. Nothing here publishes; the Pitches tab shows them.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import './lib/load-env.mjs';
import { callClaudeJson } from './lib/claude.mjs';

const dry = process.argv.includes('--dry-run');
const CONFIG = JSON.parse(readFileSync(new URL('../config/economists.json', import.meta.url), 'utf8'));
const MAX_NEW_PER_FEED = 6;
const MAX_REVIEWS = 14;
const DAYS = 14;

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------------------------------- feeds

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (html) => decode(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]).trim() : ''; };

/** RSS items or Atom entries: title, link, id, date, author, text. */
function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const link = tag(b, 'link') || (b.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const text = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const author = tag(b, 'dc:creator') || tag(tag(b, 'author') ? b.match(/<author\b[\s\S]*?<\/author>/i)?.[0] ?? '' : '', 'name') || '';
    return {
      title: strip(tag(b, 'title')), link: link.trim(), id: (tag(b, 'guid') || tag(b, 'id') || link).trim(),
      date: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'),
      author: strip(author), text: strip(text),
    };
  }).filter((i) => i.title && (i.link || i.id));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'caveat-economist-reader (+https://the-indices.vercel.app/methodology)' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

/** A page's readable text, for items whose feed carries only a teaser. */
async function pageText(url) {
  try {
    const html = await fetchText(url);
    const main = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html;
    return strip(main).slice(0, 12000);
  } catch { return ''; }
}

async function collectFeeds() {
  const since = Date.now() - DAYS * 864e5;
  let added = 0;
  for (const f of CONFIG.feeds) {
    let items = [];
    try { items = parseFeed(await fetchText(f.url)); } catch (e) { console.log(`${f.id}: feed failed (${e.message})`); continue; }
    const fresh = items
      .filter((i) => { const t = Date.parse(i.date); return !Number.isFinite(t) || t >= since; })
      .filter((i) => !f.keywords || f.keywords.some((k) => `${i.title} ${i.text}`.toLowerCase().includes(k.toLowerCase())))
      .slice(0, MAX_NEW_PER_FEED);
    const { data: known } = await db.from('economist_notes').select('external_id').eq('source_id', f.id).in('external_id', fresh.map((i) => i.id).concat(['_']));
    const seen = new Set((known ?? []).map((k) => k.external_id));
    for (const i of fresh.filter((x) => !seen.has(x.id))) {
      const body = i.text.length >= 800 ? i.text.slice(0, 12000) : (await pageText(i.link)) || i.text;
      const row = {
        source_id: f.id, source_kind: 'feed', org: f.org, author: i.author || null, title: i.title, url: i.link || null,
        external_id: i.id, published_at: Number.isFinite(Date.parse(i.date)) ? new Date(i.date).toISOString() : null, body,
      };
      if (dry) { console.log(`  + ${f.id}: ${i.title}`); added++; continue; }
      const { error } = await db.from('economist_notes').insert(row);
      if (error) { console.log(`  ${f.id}: not stored (${error.message})`); if (/does not exist|schema cache/.test(error.message)) return added; }
      else added++;
    }
    console.log(`${f.id}: ${items.length} in feed, ${fresh.length} recent and on topic`);
  }
  return added;
}

// ---------------------------------------------------------------------------------------------------- review

async function catalogue() {
  const { data } = await db.from('metrics').select('metric_id, name, unit, category');
  return (data ?? []).filter((m) => !['exchange_rates'].includes(m.category)).map((m) => `${m.metric_id}: ${m.name} (${m.unit ?? ''})`).join('\n');
}

async function latest(metricId) {
  const { data } = await db.from('observations').select('entity, period, value').eq('metric_id', metricId).eq('entity', 'AUS').order('period', { ascending: false }).limit(6);
  return (data ?? []).reverse();
}

function extractPrompt(note, cat) {
  return `You are the research desk at Caveat, an Australian data-journalism site that checks claims against official data.
Read this piece of economic commentary and reply with JSON only.

Source: ${note.org ?? note.source_id}${note.author ? ` (author: ${note.author})` : ''}
Title: ${note.title}
Published: ${note.published_at ?? 'unknown'}
Text:
${(note.body ?? '').slice(0, 10000)}

Return:
{"relevant": true|false,            // is it about the Australian economy (prices, rates, jobs, wages, housing, growth, budget, migration, productivity, trade)?
 "author": "the economist the views belong to, by name, if the piece names one, else null",
 "summary": "two plain sentences: what the piece argues",
 "claims": [                         // up to 6, the substantive ones
   {"text": "the claim in one sentence, attributed (\\"X says…\\")",
    "kind": "forecast" | "view" | "figure",
    "figure": "the number it states, as written, or null",
    "horizon": "for forecasts: when it is meant to be true, else null",
    "metric_id": "the stored series this claim can be checked against, from the catalogue below, or null"}],
 "angle": "a possible Caveat story in one sentence (where the data could confirm, complicate or contradict the claims), or null"}

Rules: attribute every view to its author or organisation; never state a view as fact. Use only metric_ids from the catalogue; null when none fits exactly. Australian English, no em dashes.

Catalogue of stored series:
${cat}`;
}

function verdictPrompt(claims) {
  return `For each claim, compare it with the official readings given (latest last). Reply with JSON only:
{"verdicts": [{"i": index, "verdict": "agrees" | "disagrees" | "partly" | "too early" | "unclear", "note": "one sentence citing the figures shown"}]}
"too early" is for forecasts whose period has not arrived. Use only the figures given; no outside knowledge. Australian English.

${JSON.stringify(claims, null, 1)}`;
}

async function review(note, cat) {
  const out = await callClaudeJson(extractPrompt(note, cat), { label: `economist ${note.id}`, maxTokens: 4000 });
  if (!out.relevant) return { status: 'dismissed', relevant: false, summary: out.summary ?? null, claims: [], angle: null, author: out.author ?? note.author };
  const known = new Set(cat.split('\n').map((l) => l.split(':')[0]));
  const claims = (out.claims ?? []).slice(0, 6).map((c) => ({ ...c, metric_id: c.metric_id && known.has(c.metric_id) ? c.metric_id : null }));
  const checkable = [];
  for (const [i, c] of claims.entries()) {
    if (!c.metric_id) { c.verdict = 'no series'; continue; }
    const rows = await latest(c.metric_id);
    if (!rows.length) { c.verdict = 'no series'; continue; }
    checkable.push({ i, claim: c.text, kind: c.kind, horizon: c.horizon, series: c.metric_id, readings: rows.map((r) => `${r.period}: ${r.value}`) });
  }
  if (checkable.length) {
    const v = await callClaudeJson(verdictPrompt(checkable), { label: `economist verdicts ${note.id}`, maxTokens: 2000 }).catch(() => ({ verdicts: [] }));
    for (const r of v.verdicts ?? []) if (claims[r.i]) { claims[r.i].verdict = r.verdict; claims[r.i].data_note = r.note; }
  }
  return { status: 'reviewed', relevant: true, summary: out.summary ?? null, claims, angle: out.angle ?? null, author: out.author ?? note.author };
}

async function main() {
  const added = await collectFeeds();
  console.log(`${added} new note(s).`);
  const cat = await catalogue();
  const { data: notes } = dry
    ? { data: [] }
    : await db.from('economist_notes').select('id, source_id, org, author, title, body, published_at').eq('status', 'new').order('created_at').limit(MAX_REVIEWS);
  let done = 0;
  for (const n of notes ?? []) {
    try {
      const r = await review(n, cat);
      await db.from('economist_notes').update({ ...r, reviewed_at: new Date().toISOString(), error: null }).eq('id', n.id);
      console.log(`${r.status.padEnd(9)} ${n.org}: ${n.title}${r.claims?.length ? ` (${r.claims.length} claims, ${r.claims.filter((c) => !['no series', 'unclear'].includes(c.verdict)).length} checked)` : ''}`);
      done++;
    } catch (e) {
      await db.from('economist_notes').update({ status: 'failed', error: String(e.message ?? e).slice(0, 400) }).eq('id', n.id);
      console.log(`failed    ${n.title}: ${e.message}`);
    }
  }
  if (!dry) await db.from('agent_runs').insert({ notes: `economist-review: ${JSON.stringify({ added, reviewed: done })}` });
}

main().catch((e) => { console.error(e); process.exit(1); });
