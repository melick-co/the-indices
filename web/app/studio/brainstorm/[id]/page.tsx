import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import BrainstormWorkspace from '../BrainstormWorkspace';

export const dynamic = 'force-dynamic';

export default async function BrainstormSessionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: session }, { data: dataSources }, { data: monitors }] = await Promise.all([
    supabase.from('research_sessions').select('*').eq('session_id', params.id).maybeSingle(),
    supabase.from('data_sources').select('source_id, name, org, cadence, active').order('name'),
    supabase.from('session_monitors').select('*').eq('session_id', params.id).order('created_at'),
  ]);

  if (!session || session.mode !== 'brainstorm') notFound();

  return (
    <BrainstormWorkspace
      session={session}
      dataSources={dataSources ?? []}
      monitors={monitors ?? []}
    />
  );
}
