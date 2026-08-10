// RSS watcher: fetch feeds -> dedup -> keyword prefilter -> Claude evaluation
// -> link to banked pitches or create new ideas. Schedule every 6-24h (cron/n8n).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const MAX_NEW_IDEAS = 3;

// Global watchlist: derived from our beat. Per-feed watch_keywords override.
const GLOBAL_KEYWORDS = [
  'inflation','cpi','wage','wages','minimum wage','fair work','rba','interest rate','cash rate',
  'house price','housing','mortgage','household debt','rent','productivity','gdp','recession',
  'migration','immigration','visa','tax','budget','superannuation','super','abs','oecd','imf',
  'unemployment','cost of living','bond yield','deficit','surplus'
];

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Minimal RSS/Atom parser: tolerant, no dependencies. */
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const pick = (tags) => {
      for (const t of tags) {
        const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
        if (m) return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ').trim();
      }
      return null;
    };
    const linkAttr = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    items.push({
      title: pick(['title']) ?? '(untitled)',
      link: pick(['link']) || linkAttr || null,
      summary: (pick(['description','summary','content:encoded','content']) ?? '').slice(0, 600),
      guid: pick(['guid','id']) || linkAttr || pick(['link']) || pick(['title']),
      published: pick(['pubDate','published','updated','dc:date']),
    });
  }
  return items;
}

async function fetchFeeds() {
  const { data: feeds } = await db.from('rss_feeds').select('*')
    .eq('active', true).lt('error_count', 5);
  let fetched = 0, inserted = 0;
  for (const f of feeds ?? []) {
    try {
      const res = await fetch(f.url, {
        headers: { 'user-agent': 'the-indices-agent/0.1', ...(f.etag ? { 'if-none-match': f.etag } : {}) },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 304) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text());
      fetched++;
      for (const it of items) {
        const row = {
          feed_id: f.feed_id, guid_hash: sha(String(it.guid)),
          title: it.title, link: it.link, summary: it.summary,
          published_at: it.published ? new Date(it.published).toISOString() : null,
        };
        const { error } = await db.from('rss_items').insert(row);
        if (!error) inserted++;                       // dup key = already seen, fine
      }
      await db.from('rss_feeds').update({
        last_fetched: new Date().toISOString(),
        etag: res.headers.get('etag'), error_count: 0,
      }).eq('feed_id', f.feed_id);
    } catch (e) {
      await db.from('rss_feeds').update({ error_count: f.error_count + 1 }).eq('feed_id', f.feed_id);
      console.error(`feed ${f.name ?? f.url}: ${e.message}`);
    }
  }
  return { fetched, inserted };
}

async function prefilter() {
  // Tracked topics from the studio extend the global watchlist, so adding a
  // topic there immediately changes what the news watcher notices.
  const { data: topics } = await db.from('tracked_topics')
    .select('keywords').eq('active', true);
  const topicWords = (topics ?? []).flatMap((t) => t.keywords ?? []);
  const GLOBAL = [...new Set([...GLOBAL_KEYWORDS, ...topicWords])];

  const { data: feeds } = await db.from('rss_feeds').select('feed_id, watch_keywords');
  const kwFor = new Map((feeds ?? []).map((f) => [f.feed_id, f.watch_keywords?.length ? f.watch_keywords : GLOBAL]));
  const { data: items } = await db.from('rss_items').select('*').eq('status', 'fetched').limit(500);
  let hits = 0;
  for (const it of items ?? []) {
    const hay = `${it.title} ${it.summary}`.toLowerCase();
    const matched = (kwFor.get(it.feed_id) ?? GLOBAL).filter((k) => hay.includes(k.toLowerCase()));
    await db.from('rss_items').update(
      matched.length ? { status: 'prefiltered', matched_keywords: matched } : { status: 'discarded', eval_notes: 'no keyword match' }
    ).eq('item_id', it.item_id);
    if (matched.length) hits++;
  }
  return hits;
}

async function evaluate() {
  const { data: items } = await db.from('rss_items').select('*').eq('status', 'prefiltered').limit(40);
  if (!items?.length) return { evaluated: 0 };
  const { data: bank } = await db.from('pitches')
    .select('id, headline, state, metric_ids, resurface_on');
  const charter = readFileSync(new URL('../EDITORIAL.md', import.meta.url), 'utf8');
  const prompt = readFileSync(new URL('../taste/rss-prompt.md', import.meta.url), 'utf8')
    .replace('{EDITORIAL.md}', charter)
    .replace('{JSON: id, headline, state, metric_ids, resurface_on}', JSON.stringify(bank))
    .replace('{JSON: item_id, title, summary, link, published_at, matched_keywords}',
      JSON.stringify(items.map(({ item_id, title, summary, link, published_at, matched_keywords }) =>
        ({ item_id, title, summary, link, published_at, matched_keywords }))))
    .replace('{max_new}', String(MAX_NEW_IDEAS));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY,
               'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }] }),
  });
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let verdict;
  try { verdict = JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { console.error('unparseable verdict'); return { evaluated: 0 }; }

  let linked = 0, converted = 0;
  for (const d of verdict.decisions ?? []) {
    if (d.action === 'link_to_pitch' && d.pitch_id) {
      await db.from('rss_items').update({ status: 'linked_to_pitch', linked_pitch: d.pitch_id,
        eval_notes: d.note ?? null }).eq('item_id', d.item_id);
      // news peg counts as a resurface trigger for parked ideas
      await db.from('pitches').update({ last_evaluated: new Date(0).toISOString() })
        .eq('id', d.pitch_id).in('state', ['dormant','rejected','watchlist']);
      linked++;
    } else if (d.action === 'convert_to_idea' && converted < MAX_NEW_IDEAS) {
      const { data: pitch } = await db.from('pitches').insert({
        headline: d.headline_draft ?? 'Untitled lead', hook: d.note ?? null,
        mechanism: null, caveat: d.what_would_kill_it ?? null, chart_hint: null,
        detector: 'rss_lead',
        trigger_rows: { rss_item: d.item_id, data_needed: d.data_needed ?? null },
        metric_ids: [], state: 'candidate',
      }).select('id').single();
      await db.from('rss_items').update({ status: 'converted_to_idea',
        linked_pitch: pitch?.id ?? null, eval_notes: d.archetype ?? null }).eq('item_id', d.item_id);
      converted++;
    } else {
      await db.from('rss_items').update({ status: 'discarded', eval_notes: d.reason ?? null })
        .eq('item_id', d.item_id);
    }
  }
  return { evaluated: verdict.decisions?.length ?? 0, linked, converted };
}

/** Inbox sweep: paste an RSS URL into the inbox (kind data_source or link) and it
    gets registered as a feed automatically. */
async function registerInboxFeeds() {
  const { data: items } = await db.from('inbox').select('*').eq('status', 'new')
    .in('kind', ['data_source','link']);
  let added = 0;
  for (const it of items ?? []) {
    const url = (it.url ?? '').trim();
    if (!url) continue;
    const looksRss = /rss|feed|atom|\.xml($|\?)/i.test(url);
    if (!looksRss) continue;
    const { error } = await db.from('rss_feeds').insert({ url, name: it.title ?? null, added_via: 'inbox' });
    if (!error || error.code === '23505') {
      await db.from('inbox').update({ status: 'ingested', processed_at: new Date().toISOString() })
        .eq('id', it.id);
      added++;
    }
  }
  return added;
}

async function main() {
  const feedsAdded = await registerInboxFeeds();
  const { fetched, inserted } = await fetchFeeds();
  const hits = await prefilter();
  const ev = await evaluate();
  const summary = { feedsAdded, feedsFetched: fetched, newItems: inserted,
    keywordHits: hits, ...ev };
  await db.from('agent_runs').insert({ notes: 'rss: ' + JSON.stringify(summary) });
  console.log(summary);
}
main().catch((e) => { console.error(e); process.exit(1); });
