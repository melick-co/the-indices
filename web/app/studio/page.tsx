import { createClient } from '@/lib/supabase-server';
import { loadStoryLinksByPitch } from '@/lib/stories-loader';
import StudioBoard from './StudioBoard';
import type { TopicSuggestion } from './SuggestionPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio — Caveat' };

export default async function Studio() {
  const supabase = createClient();

  const [{ data: pitches }, { data: runs }, { data: inbox }, { data: feedback },
    { data: events }, { data: metrics }, { data: news }, { data: trends },
    { data: suggestions }, storyByPitch] =
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
      supabase.from('topic_suggestions')
        .select('suggestion_id, source_kind, source_id, action, status, summary, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      loadStoryLinksByPitch(),
    ]);

  const emailFrom = new Map(
    (inbox ?? []).filter((i: { kind: string }) => i.kind === 'email')
      .map((i: { id: string; from_address?: string | null }) => [i.id, i.from_address ?? null]),
  );

  const suggestionRows: TopicSuggestion[] = (suggestions ?? []).map((s: {
    suggestion_id: string;
    source_kind: string;
    source_id: string | null;
    action: TopicSuggestion['action'];
    status: string;
    summary: string;
    payload: Record<string, unknown>;
    created_at: string;
  }) => ({
    suggestion_id: s.suggestion_id,
    source_kind: s.source_kind,
    source_id: s.source_id,
    action: s.action,
    status: s.status,
    summary: s.summary,
    payload: s.payload ?? {},
    created_at: s.created_at,
    from_address: s.source_id ? emailFrom.get(s.source_id) ?? null : null,
  }));

  return (
    <StudioBoard
      pitches={pitches ?? []} runs={runs ?? []}
      inbox={inbox ?? []} feedback={feedback ?? []}
      events={events ?? []} metrics={metrics ?? []} news={news ?? []}
      trends={trends ?? []} suggestions={suggestionRows}
      storyByPitch={storyByPitch}
    />
  );
}
