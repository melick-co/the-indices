import { createClient } from '@/lib/supabase-server';
import { mergeSessions, type RawSessionRow } from '@/lib/session-work';
import SessionList from './SessionList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work — Caveat Foundry' };

const SESSION_COLS = [
  'session_id', 'title', 'question', 'status', 'created_at', 'updated_at',
  'linked_pitch', 'monitoring', 'intent', 'parent_session_id', 'fork_from_message_id',
  'answer', 'messages',
].join(', ');

export default async function FoundryWorkPage() {
  const supabase = createClient();
  const base = () => supabase.from('research_sessions')
    .select(SESSION_COLS)
    .in('mode', ['foundry', 'brainstorm', 'ask'])
    .neq('status', 'archived');

  // Recent rows cover empty drafts. The other queries keep sessions with
  // actual writing from being buried when a burst of empty drafts is created.
  const [{ data: recent }, { data: withTurns }, { data: withAnswer }, { data: banked }] =
    await Promise.all([
      base().order('updated_at', { ascending: false }).limit(80),
      base().not('messages', 'eq', '[]').order('updated_at', { ascending: false }).limit(150),
      base().not('answer', 'is', null).order('updated_at', { ascending: false }).limit(80),
      base().not('linked_pitch', 'is', null).order('updated_at', { ascending: false }).limit(80),
    ]);

  const sessions = mergeSessions([
    recent as RawSessionRow[] | null,
    withTurns as RawSessionRow[] | null,
    withAnswer as RawSessionRow[] | null,
    banked as RawSessionRow[] | null,
  ]);

  return (
    <main style={{ paddingBottom: 'var(--spacing-84)' }}>
      <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>Work</h1>
      <p className="measure" style={{ marginBottom: 'var(--spacing-21)' }}>
        Agent chat sessions for investigation, brainstorming, and deep research.
        <strong> Save</strong> keeps the session on this list. It does not create a pitch.
        <strong> Bank</strong> (session header, or <code>/bank</code>) copies the last turn
        onto the Foundry board under Awaiting ranking — not Today&apos;s pitches.
      </p>
      <SessionList sessions={sessions} />
    </main>
  );
}
