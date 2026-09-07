import { createClient } from '@/lib/supabase-server';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex, sortPitchesByTrend } from '@/lib/trend-weight';
import FoundryBoard from './FoundryBoard';
import type { SourceSuggestion } from './SourceSuggestionsPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Foundry — Caveat' };

export default async function FoundryPage() {
  const supabase = createClient();

  const [{ data: pitches }, { data: runs }, { data: inbox }, { data: feedback },
    { data: events }, { data: metrics }, { data: news }, { data: trends },
    { data: sourceSuggestions }, { data: storyRows }, trendingData] =
    await Promise.all([
      supabase.from('pitches').select('*')
        .order('state').order('rank_value', { ascending: false, nullsFirst: false })
        .order('first_seen', { ascending: false }),
      supabase.from('agent_runs').select('*').order('ran_at', { ascending: false }).limit(6),
      supabase.from('inbox').select('*').order('created_at', { ascending: false }).limit(12),
      supabase.from('pitch_feedback').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('pitch_events').select('*').order('at', { ascending: false }).limit(400),
      supabase.from('metrics').select('metric_id, name, unit, basis, source_org, source_tier, source_url, source_published, period'),
      supabase.from('rss_items')
        .select('item_id, title, link, summary, published_at, status, curated, curated_note, matched_keywords')
        .in('status', ['prefiltered', 'evaluated', 'linked_to_pitch', 'converted_to_idea'])
        .order('published_at', { ascending: false }).limit(40),
      supabase.from('trend_clusters')
        .select('cluster_id, label, keywords, item_count, outlet_count, spike_score, status, linked_pitch, window_end')
        .in('status', ['open', 'hypothesized'])
        .order('spike_score', { ascending: false })
        .limit(12),
      supabase.from('source_suggestions')
        .select('suggestion_id, session_id, action, status, summary, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('stories')
        .select('pitch_id, slug')
        .eq('status', 'published')
        .not('pitch_id', 'is', null),
      loadTrendingPage(),
    ]);

  const trendIndex = buildTrendIndex(trendingData);
  const orderedPitches = sortPitchesByTrend(pitches ?? [], trendIndex);

  const storyByPitch = Object.fromEntries(
    (storyRows ?? [])
      .filter((r: { pitch_id: string | null }) => r.pitch_id)
      .map((r: { pitch_id: string; slug: string }) => [r.pitch_id, r.slug]),
  );

  const suggestionRows: SourceSuggestion[] = (sourceSuggestions ?? []).map((s: {
    suggestion_id: string;
    session_id: string | null;
    action: SourceSuggestion['action'];
    status: string;
    summary: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }) => ({
    suggestion_id: s.suggestion_id,
    session_id: s.session_id,
    action: s.action,
    status: s.status,
    summary: s.summary,
    payload: s.payload ?? {},
    created_at: s.created_at,
  }));

  return (
    <FoundryBoard
      pitches={orderedPitches} runs={runs ?? []}
      inbox={inbox ?? []} feedback={feedback ?? []}
      events={events ?? []} metrics={metrics ?? []} news={news ?? []}
      trends={trends ?? []} sourceSuggestions={suggestionRows}
      storyByPitch={storyByPitch}
    />
  );
}
