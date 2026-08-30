import { createClient } from '@/lib/supabase-server';
import SessionList from './SessionList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Brainstorm — Caveat Studio' };

export default async function BrainstormPage() {
  const supabase = createClient();
  const { data: sessions } = await supabase.from('research_sessions')
    .select('session_id, title, question, status, created_at, updated_at, linked_pitch, monitoring')
    .eq('mode', 'brainstorm')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(50);

  return (
    <main style={{ paddingBottom: 'var(--spacing-84)' }}>
      <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>Brainstorm</h1>
      <p className="measure" style={{ marginBottom: 'var(--spacing-42)' }}>
        Build ideas from a prompt, links, or files. Sessions are saved so you can return,
        refine, bank angles as pitches, and opt into source monitoring.
      </p>
      <SessionList sessions={sessions ?? []} />
    </main>
  );
}
