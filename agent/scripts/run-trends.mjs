// Feed trend watcher: cluster recent RSS items -> Claude hypotheses -> pitches.
// Run after RSS sweep (needs fresh items). Env: SUPABASE_*, ANTHROPIC_API_KEY
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import './lib/load-env.mjs';
import { detectTrends } from './lib/trend-detect.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const WINDOW_H = 72;
const MAX_HYPOTHESES = 5;

async function loadItems() {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_H * 3600000);
  const baselineStart = new Date(now - 2 * WINDOW_H * 3600000);

  const [{ data: recent }, { data: baseline }, { data: topics }] = await Promise.all([
    db.from('rss_items').select('item_id, feed_id, title, link, summary, published_at, matched_keywords, fetched_at, status')
      .neq('status', 'discarded')
      .gte('fetched_at', windowStart.toISOString())
      .order('published_at', { ascending: false })
      .limit(500),
    db.from('rss_items').select('item_id, feed_id, title, summary, matched_keywords, fetched_at, status')
      .neq('status', 'discarded')
      .gte('fetched_at', baselineStart.toISOString())
      .lt('fetched_at', windowStart.toISOString())
      .limit(500),
    db.from('tracked_topics').select('topic_id, label, keywords').eq('active', true),
  ]);

  return { recent: recent ?? [], baseline: baseline ?? [], topics: topics ?? [],
    windowStart, windowEnd: new Date() };
}

async function persistClusters(detected, windowStart, windowEnd) {
  let upserted = 0;
  for (const c of detected) {
    const row = {
      label: c.label,
      keywords: c.keywords,
      item_ids: c.item_ids,
      feed_ids: c.feed_ids,
      outlet_count: c.outlet_count,
      item_count: c.item_count,
      spike_score: c.spike_score,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      status: 'open',
      fingerprint: c.fingerprint,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await db.from('trend_clusters')
      .select('cluster_id, status, linked_pitch')
      .eq('fingerprint', c.fingerprint)
      .maybeSingle();
    if (existing) {
      await db.from('trend_clusters').update(row).eq('cluster_id', existing.cluster_id);
    } else {
      const { error } = await db.from('trend_clusters').insert(row);
      if (!error) upserted++;
    }
  }
  return upserted;
}

async function hypothesize() {
  const { data: clusters } = await db.from('trend_clusters')
    .select('*')
    .eq('status', 'open')
    .is('linked_pitch', null)
    .gte('item_count', 2)
    .order('spike_score', { ascending: false })
    .limit(8);
  if (!clusters?.length) return { hypothesized: 0, linked: 0, archived: 0 };

  const allItemIds = [...new Set(clusters.flatMap((c) => c.item_ids ?? []))];
  const { data: items } = await db.from('rss_items')
    .select('item_id, title, link, summary, published_at, matched_keywords')
    .in('item_id', allItemIds);

  const itemById = new Map((items ?? []).map((it) => [it.item_id, it]));
  const payload = clusters.map((c) => ({
    cluster_id: c.cluster_id,
    label: c.label,
    keywords: c.keywords,
    spike_score: c.spike_score,
    outlet_count: c.outlet_count,
    item_count: c.item_count,
    items: (c.item_ids ?? []).map((id) => itemById.get(id)).filter(Boolean)
      .map(({ item_id, title, link, summary, published_at, matched_keywords }) =>
        ({ item_id, title, link, summary, published_at, matched_keywords })),
  }));

  const { data: bank } = await db.from('pitches')
    .select('id, headline, state, detector, metric_ids');
  const charter = readFileSync(new URL('../EDITORIAL.md', import.meta.url), 'utf8');
  const prompt = readFileSync(new URL('../taste/trends-prompt.md', import.meta.url), 'utf8')
    .replace('{EDITORIAL.md}', charter)
    .replace('{JSON: id, headline, state, detector, metric_ids}', JSON.stringify(bank))
    .replace('{JSON: cluster_id, label, keywords, spike_score, outlet_count, item_count, items}',
      JSON.stringify(payload))
    .replace('{max_hypotheses}', String(MAX_HYPOTHESES));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let verdict;
  try { verdict = JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { console.error('unparseable trend verdict'); return { hypothesized: 0, linked: 0, archived: 0 }; }

  let hypothesized = 0;
  let linked = 0;
  let archived = 0;
  const clusterById = new Map(clusters.map((c) => [c.cluster_id, c]));

  for (const d of verdict.decisions ?? []) {
    const cluster = clusterById.get(d.cluster_id);
    if (!cluster) continue;

    if (d.action === 'link_to_pitch' && d.pitch_id) {
      await db.from('trend_clusters').update({
        status: 'hypothesized',
        linked_pitch: d.pitch_id,
        updated_at: new Date().toISOString(),
      }).eq('cluster_id', cluster.cluster_id);
      await db.from('pitches').update({ last_evaluated: new Date(0).toISOString() })
        .eq('id', d.pitch_id).in('state', ['dormant', 'rejected', 'watchlist']);
      linked++;
    } else if (d.action === 'investigate' && hypothesized < MAX_HYPOTHESES) {
      const fingerprint = `trend_hyp:${cluster.fingerprint}`;
      const { count } = await db.from('pitches')
        .select('*', { count: 'exact', head: true })
        .contains('trigger_rows', { fingerprint });
      if ((count ?? 0) > 0) {
        await db.from('trend_clusters').update({
          status: 'hypothesized',
          updated_at: new Date().toISOString(),
        }).eq('cluster_id', cluster.cluster_id);
        archived++;
        continue;
      }
      const { data: pitch } = await db.from('pitches').insert({
        headline: d.headline_draft ?? cluster.label,
        hook: d.hook ?? `${cluster.item_count} items across ${cluster.outlet_count} outlets`,
        mechanism: null,
        caveat: d.kill_condition ?? null,
        chart_hint: null,
        detector: 'trend_hypothesis',
        trigger_rows: {
          fingerprint,
          cluster_id: cluster.cluster_id,
          cluster_label: cluster.label,
          keywords: cluster.keywords,
          spike_score: cluster.spike_score,
          item_ids: cluster.item_ids,
          archetype: d.archetype ?? null,
          data_needed: d.data_needed ?? null,
          related_pitch_id: d.related_pitch_id ?? null,
        },
        metric_ids: d.metric_ids ?? [],
        state: 'candidate',
      }).select('id').single();
      await db.from('trend_clusters').update({
        status: 'hypothesized',
        linked_pitch: pitch?.id ?? null,
        updated_at: new Date().toISOString(),
      }).eq('cluster_id', cluster.cluster_id);
      hypothesized++;
    } else {
      await db.from('trend_clusters').update({
        status: 'archived',
        updated_at: new Date().toISOString(),
      }).eq('cluster_id', cluster.cluster_id);
      archived++;
    }
  }
  return { hypothesized, linked, archived };
}

async function main() {
  const { recent, baseline, topics, windowStart, windowEnd } = await loadItems();
  const detected = detectTrends(recent, baseline, topics);
  const upserted = await persistClusters(detected, windowStart, windowEnd);
  const hyp = await hypothesize();
  const summary = {
    recentItems: recent.length,
    clustersDetected: detected.length,
    clustersUpserted: upserted,
    ...hyp,
  };
  await db.from('agent_runs').insert({ notes: 'trends: ' + JSON.stringify(summary) });
  console.log(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
