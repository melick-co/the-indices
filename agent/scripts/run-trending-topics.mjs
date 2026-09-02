/**
 * Daily trending topics: RSS top-10 (1d + 7d) and X top-10 (AU + global).
 * Run at end of day (Australia/Sydney). Env: SUPABASE_*, ANTHROPIC_API_KEY,
 * optional TWITTER_* for X trends.
 *
 *   node scripts/run-trending-topics.mjs
 */
import { createClient } from '@supabase/supabase-js';
import './lib/load-env.mjs';
import { sydneyDate, sydneyDateRange } from './lib/sydney-time.mjs';
import { rankRssTopics } from './lib/topic-rank.mjs';
import { fetchXTrends, aggregateXTopics, xConfigured } from './lib/x-trends.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

async function loadRssItems() {
  const lookback = new Date(Date.now() - 22 * 24 * 3600000);
  const { data, error } = await db.from('rss_items')
    .select('item_id, feed_id, title, link, summary, published_at, fetched_at, matched_keywords, status')
    .neq('status', 'discarded')
    .gte('fetched_at', lookback.toISOString())
    .order('published_at', { ascending: false })
    .limit(1500);
  if (error) throw error;
  return data ?? [];
}

async function loadTrackedTopics() {
  const { data } = await db.from('tracked_topics')
    .select('topic_id, label, keywords')
    .eq('active', true);
  return data ?? [];
}

async function upsertSnapshot(row) {
  const { error } = await db.from('trending_snapshots').upsert({
    ...row,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'source,region,window_type,period_end' });
  if (error) throw error;
}

async function loadXDailySnapshots(region, periodEnd) {
  const dates = sydneyDateRange(periodEnd, 7);
  const { data } = await db.from('trending_snapshots')
    .select('period_end, topics')
    .eq('source', 'x')
    .eq('region', region)
    .eq('window_type', '1d')
    .in('period_end', dates)
    .order('period_end', { ascending: false });
  return data ?? [];
}

async function main() {
  const periodEnd = sydneyDate(1);
  const [items, topics] = await Promise.all([loadRssItems(), loadTrackedTopics()]);
  const baselineItems = items;

  const summary = { period_end: periodEnd, rss: {}, x: {} };

  for (const windowType of ['1d', '7d']) {
    const { topics: ranked, item_count } = await rankRssTopics(
      items, baselineItems, topics, periodEnd, windowType,
    );
    await upsertSnapshot({
      source: 'rss',
      region: 'au',
      window_type: windowType,
      period_end: periodEnd,
      topics: ranked,
      item_count,
    });
    summary.rss[windowType] = { topics: ranked.length, items: item_count };
  }

  for (const region of ['au', 'global']) {
    try {
      const { configured, topics: xTopics } = await fetchXTrends(region);
      await upsertSnapshot({
        source: 'x',
        region,
        window_type: '1d',
        period_end: periodEnd,
        topics: xTopics,
        item_count: xTopics.length,
      });
      summary.x[region] = { configured, topics: xTopics.length };

      if (configured && xTopics.length) {
        const daily = await loadXDailySnapshots(region, periodEnd);
        const todaySnap = { period_end: periodEnd, topics: xTopics };
        const merged = [todaySnap, ...daily.filter((d) => d.period_end !== periodEnd)];
        const aggregated = aggregateXTopics(merged.slice(0, 7));
        await upsertSnapshot({
          source: 'x',
          region,
          window_type: '7d',
          period_end: periodEnd,
          topics: aggregated,
          item_count: aggregated.length,
        });
      }
    } catch (e) {
      console.error(`X ${region}:`, e.message);
      summary.x[region] = { error: e.message };
    }
  }

  if (!xConfigured()) {
    summary.x_note = 'X API credentials not configured — add TWITTER_* to agent/.env';
  }

  await db.from('agent_runs').insert({ notes: 'trending-topics: ' + JSON.stringify(summary) });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
