'use client';

import { useTransition } from 'react';
import { approveSourceSuggestion, rejectSourceSuggestion } from './actions';

export type SourceSuggestion = {
  suggestion_id: string;
  action: 'register_data_source' | 'register_rss_feed';
  status: string;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  session_id: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  register_data_source: 'Data source',
  register_rss_feed: 'RSS feed',
};

export default function SourceSuggestionsPanel({ suggestions }: { suggestions: SourceSuggestion[] }) {
  const [pending, start] = useTransition();
  const pendingItems = suggestions.filter((s) => s.status === 'pending');

  return (
    <section style={{ marginTop: '3rem' }}>
      <h3 className="section-head">
        Source suggestions · approve before farming ({pendingItems.length} pending)
      </h3>
      <p style={{ ...meta, textTransform: 'none', letterSpacing: 0, marginBottom: '1rem' }}>
        When the agent discovers tier 1/2 sources during research, they appear here for approval
        before entering the data source registry or RSS watcher.
      </p>
      {pendingItems.map((s) => (
        <article key={s.suggestion_id} style={card}>
          <div style={meta}>
            {ACTION_LABEL[s.action] ?? s.action}
            {' · '}{fmtDate(s.created_at)}
          </div>
          <b style={{ fontSize: '.95rem', display: 'block', margin: '.4rem 0' }}>
            {s.summary ?? 'Untitled source'}
          </b>
          <SourceDetail action={s.action} payload={s.payload} />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn-accent" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending}
              onClick={() => start(async () => { await approveSourceSuggestion(s.suggestion_id); })}>
              Approve
            </button>
            <button type="button" className="studio-btn-outline" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending}
              onClick={() => start(async () => { await rejectSourceSuggestion(s.suggestion_id); })}>
              Reject
            </button>
          </div>
        </article>
      ))}
      {!pendingItems.length && (
        <p style={meta}>No pending source suggestions from agent research yet.</p>
      )}
    </section>
  );
}

function SourceDetail({ action, payload }: { action: string; payload: Record<string, unknown> }) {
  if (action === 'register_data_source') {
    return (
      <div style={detail}>
        {payload.name ? <div>{String(payload.name)} ({String(payload.org ?? '')})</div> : null}
        {payload.url ? <div>{String(payload.url)}</div> : null}
        {payload.tier ? <div>Tier {String(payload.tier)} · {String(payload.cadence ?? 'irregular')}</div> : null}
        {payload.why ? <div>{String(payload.why)}</div> : null}
      </div>
    );
  }
  if (action === 'register_rss_feed') {
    return (
      <div style={detail}>
        {payload.url ? <div>{String(payload.url)}</div> : null}
        {payload.name ? <div>{String(payload.name)}</div> : null}
        {payload.why ? <div>{String(payload.why)}</div> : null}
      </div>
    );
  }
  return null;
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const meta: React.CSSProperties = {
  fontFamily: 'var(--font-ops, Inter, sans-serif)', fontSize: 12, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--ink-faint)',
};
const detail: React.CSSProperties = {
  fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.43, marginTop: 8,
};
const card: React.CSSProperties = {
  border: '1px solid #e5e5e5', padding: 20, marginBottom: 12, background: '#fff',
  borderRadius: 24, boxShadow: '0 0 0 1px rgba(23,23,23,0.05), 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
};
