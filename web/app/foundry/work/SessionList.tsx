'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createFoundrySession } from './actions';

type SessionRow = {
  session_id: string;
  title: string | null;
  question: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  linked_pitch: string | null;
  monitoring: Record<string, unknown> | null;
  intent?: string | null;
  parent_session_id?: string | null;
  fork_from_message_id?: string | null;
};

const INTENT_LABEL: Record<string, string> = {
  investigate: 'Investigate',
  brainstorm: 'Brainstorm',
  refine: 'Refine',
  precedents: 'Precedents',
};

export default function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function create() {
    start(async () => {
      const r = await createFoundrySession();
      if (r.ok) router.push(`/foundry/work/${r.sessionId}`);
    });
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1rem' }}>
        <h3 id="sessions" className="section-head" style={{ margin: 0, borderBottom: 'none' }}>Sessions</h3>
        <button type="button" className="btn-accent" onClick={create} disabled={pending}>
          {pending ? 'Creating…' : '+ New session'}
        </button>
      </div>
      {sessions.map((s) => (
        <Link key={s.session_id} href={`/foundry/work/${s.session_id}`}
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
              <div>{new Date(s.updated_at ?? s.created_at).toLocaleDateString('en-AU')}</div>
              {s.linked_pitch && <div style={{ color: 'var(--verify)' }}>Banked</div>}
              {(Boolean(s.monitoring?.tracked) || Boolean(s.monitoring?.accepted)) && (
                <div style={{ color: 'var(--verify)' }}>Tracked</div>
              )}
            </div>
          </div>
        </Link>
      ))}
      {!sessions.length && (
        <p style={meta}>No sessions yet. Start one with a question, article link, or notes file.</p>
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
const forkBadge: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem', color: 'var(--ink-soft)',
};
