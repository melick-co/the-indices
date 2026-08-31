import { createClient } from '@/lib/supabase-server';
import SessionList from './SessionList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work — Caveat Foundry' };

export default async function FoundryWorkPage() {
  const supabase = createClient();
  const { data: sessions } = await supabase.from('research_sessions')
    .select('session_id, title, question, status, created_at, updated_at, linked_pitch, monitoring, intent, parent_session_id, fork_from_message_id')
    .in('mode', ['foundry', 'brainstorm', 'ask'])
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(60);

  return (
    <main style={{ paddingBottom: 'var(--spacing-84)' }}>
      <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>Work</h1>
      <p className="measure" style={{ marginBottom: 'var(--spacing-42)' }}>
        Agent chat sessions for investigation, brainstorming, and deep research.
        Each turn shows live tool steps, hypothesis scores, and follow-up prompts.
      </p>
      <SessionList sessions={sessions ?? []} />
    </main>
  );
}
