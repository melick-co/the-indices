'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createFoundrySession } from './actions';
import type { SessionListRow } from '@/lib/session-work';

const INTENT_LABEL: Record<string, string> = {
  investigate: 'Investigate',
  brainstorm: 'Brainstorm',
  refine: 'Refine',
  precedents: 'Precedents',
};

export default function SessionList({ sessions }: { sessions: SessionListRow[] }) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const router = useRouter();

  function create() {
    start(async () => {
      const r = await createFoundrySession();
      if (r.ok) router.push(`/foundry/work/${r.sessionId}`);
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const hay = `${s.title ?? ''} ${s.question ?? ''} ${s.intent ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, query]);

  const working = filtered.filter((s) => s.hasWork);
  const emptyDrafts = filtered.filter((s) => !s.hasWork);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h3 id="sessions" className="section-head" style={{ margin: 0, borderBottom: 'none' }}>Sessions</h3>
        <button type="button" className="btn-accent" onClick={create} disabled={pending}>
          {pending ? 'Creating…' : '+ New session'}
        </button>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a session by title or question"
        aria-label="Find a session"
        style={search}
      />
      {working.map((s) => <SessionLink key={s.session_id} session={s} />)}
      {!working.length && (
        <p style={meta}>
          {query.trim()
            ? 'No sessions match that search.'
            : 'No sessions with turns yet. Start one with a question, article link, or notes file.'}
        </p>
      )}
      {emptyDrafts.length > 0 && (
        <details style={{ marginTop: '2rem' }}>
          <summary style={{ ...meta, cursor: 'pointer', marginBottom: '0.6rem' }}>
            {emptyDrafts.length} empty draft{emptyDrafts.length === 1 ? '' : 's'} — no turns yet
          </summary>
          {emptyDrafts.map((s) => <SessionLink key={s.session_id} session={s} />)}
        </details>
      )}
    </section>
  );
}

function SessionLink({ session: s }: { session: SessionListRow }) {
  return (
    <Link href={`/foundry/work/${s.session_id}`}
      style={{ display: 'block', padding: '.85rem 0', borderBottom: '1px solid var(--rule)',
        textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <b style={{ fontSize: '.95rem' }}>
            {s.parent_session_id && <span style={forkBadge}>↳ </span>}
            {s.title || 'Untitled session'}
          </b>
          {s.question && (
            <div style={meta}>{s.question.slice(0, 100)}{s.question.length > 100 ? '…' : ''}</div>
          )}
          {s.intent && (
            <div style={{ ...meta, color: 'var(--ink-soft)' }}>{INTENT_LABEL[s.intent] ?? s.intent}</div>
          )}
        </div>
        <div style={{ ...meta, textAlign: 'right', flexShrink: 0 }}>
          <div>{statusLabel(s.status)}</div>
          <div>{s.turnCount > 0 ? `${s.turnCount} turn${s.turnCount === 1 ? '' : 's'}` : 'No turns'}</div>
          <div>{new Date(s.updated_at ?? s.created_at).toLocaleDateString('en-AU')}</div>
          {s.linked_pitch ? (
            <div style={{ color: 'var(--verify)' }}>Banked · on the board</div>
          ) : s.hasWork ? (
            <div>Draft — not on the board</div>
          ) : null}
          {(Boolean(s.monitoring?.tracked) || Boolean(s.monitoring?.accepted)) && (
            <div style={{ color: 'var(--verify)' }}>Tracked</div>
          )}
        </div>
      </div>
    </Link>
  );
}

function statusLabel(status: string) {
  if (status === 'draft') return 'Draft';
  if (status === 'running') return 'Running…';
  if (status === 'complete') return 'Complete';
  return status;
}

const meta: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-faint)', marginTop: '.25rem',
};
const forkBadge: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem', color: 'var(--ink-soft)',
};
const search: React.CSSProperties = {
  width: '100%',
  maxWidth: '28rem',
  marginBottom: '1.4rem',
  padding: '0.55rem 0',
  border: 0,
  borderBottom: '1px solid var(--rule)',
  background: 'transparent',
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '.82rem',
  letterSpacing: '.04em',
  color: 'inherit',
  outline: 'none',
  boxShadow: 'none',
  borderRadius: 0,
};
