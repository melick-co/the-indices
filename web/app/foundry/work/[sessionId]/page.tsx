import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import FoundryChat from '../FoundryChat';

export const dynamic = 'force-dynamic';

export default async function FoundrySessionPage({ params }: { params: { sessionId: string } }) {
  const supabase = createClient();
  const [{ data: session }, { data: dataSources }, { data: monitors }, { data: parent }] =
    await Promise.all([
      supabase.from('research_sessions').select('*').eq('session_id', params.sessionId).maybeSingle(),
      supabase.from('data_sources').select('source_id, name, org, cadence, active').order('name'),
      supabase.from('session_monitors').select('*').eq('session_id', params.sessionId).order('created_at'),
      supabase.from('research_sessions')
        .select('session_id, title, parent_session_id')
        .eq('session_id', params.sessionId)
        .maybeSingle(),
    ]);

  if (!session) notFound();

  let parentSession = null;
  if (session.parent_session_id) {
    const { data: p } = await supabase.from('research_sessions')
      .select('session_id, title').eq('session_id', session.parent_session_id).maybeSingle();
    parentSession = p;
  }

  const { data: forks } = await supabase.from('research_sessions')
    .select('session_id, title, fork_from_message_id, fork_branch_label')
    .eq('parent_session_id', params.sessionId)
    .neq('status', 'archived')
    .order('created_at');

  return (
    <FoundryChat
      session={session}
      dataSources={dataSources ?? []}
      monitors={monitors ?? []}
      parentSession={parentSession}
      forks={forks ?? []}
    />
  );
}
