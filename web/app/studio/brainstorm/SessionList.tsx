'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrainstormSession } from './actions';

type SessionRow = {
  session_id: string;
  title: string | null;
  question: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  linked_pitch: string | null;
  monitoring: any;
};

export default function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function create() {
    start(async () => {
      const r = await createBrainstormSession();
      if (r.ok) router.push(`/studio/brainstorm/${r.sessionId}`);
    });
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1rem' }}>
        <h3 className="section-head" style={{ margin: 0 }}>Sessions</h3>
        <button type="button" className="btn-accent" onClick={create} disabled={pending}>
          {pending ? 'Creating…' : '+ New brainstorm'}
        </button>
      </div>
      {sessions.map((s) => (
        <Link key={s.session_id} href={`/studio/brainstorm/${s.session_id}`}
          style={{ display: 'block', padding: '.85rem 0', borderBottom: '1px solid var(--rule)',
            textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <b style={{ fontSize: '.95rem' }}>{s.title || 'Untitled brainstorm'}</b>
              {s.question && (
                <div style={meta}>{s.question.slice(0, 100)}{s.question.length > 100 ? '…' : ''}</div>
              )}
            </div>
            <div style={{ ...meta, textAlign: 'right', flexShrink: 0 }}>
              <div>{statusLabel(s.status)}</div>
              <div>{new Date(s.updated_at ?? s.created_at).toLocaleDateString('en-AU')}</div>
              {s.linked_pitch && <div style={{ color: 'var(--verify)' }}>Banked</div>}
              {s.monitoring?.accepted && <div style={{ color: 'var(--verify)' }}>Monitoring</div>}
            </div>
          </div>
        </Link>
      ))}
      {!sessions.length && (
        <p style={meta}>No brainstorms yet. Start one with a question, article link, or notes file.</p>
      )}
    </section>
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
const primary: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem', letterSpacing: '.08em',
  textTransform: 'uppercase', padding: '.6rem 1.2rem', cursor: 'pointer', borderRadius: 0,
  border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--paper)',
};
