import { createClient } from '@/lib/supabase-server';
import StudioBoard from './StudioBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio — Caveat' };

export default async function Studio() {
  const supabase = createClient();

  const [{ data: pitches }, { data: runs }, { data: inbox }, { data: feedback },
    { data: events }, { data: metrics }] =
    await Promise.all([
      supabase.from('pitches').select('*')
        .order('state').order('rank_value', { ascending: false, nullsFirst: false })
        .order('first_seen', { ascending: false }),
      supabase.from('agent_runs').select('*').order('ran_at', { ascending: false }).limit(6),
      supabase.from('inbox').select('*').order('created_at', { ascending: false }).limit(12),
      supabase.from('pitch_feedback').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('pitch_events').select('*').order('at', { ascending: false }).limit(400),
      supabase.from('metrics').select('metric_id, name, unit, basis, source_org, source_tier, source_url, source_published, period'),
    ]);

  return (
    <StudioBoard
      pitches={pitches ?? []} runs={runs ?? []}
      inbox={inbox ?? []} feedback={feedback ?? []}
      events={events ?? []} metrics={metrics ?? []}
    />
  );
}
