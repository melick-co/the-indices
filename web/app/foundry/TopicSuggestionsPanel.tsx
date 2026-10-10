'use client';

import { useTransition } from 'react';
import { approveSuggestion, rejectSuggestion } from './actions';

export type TopicSuggestion = {
  suggestion_id: string;
  source_kind: string;
  source_id: string | null;
  action: 'update_topic' | 'new_topic' | 'story_idea';
  status: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
  from_address?: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  update_topic: 'Update topic',
  new_topic: 'New topic',
  story_idea: 'Story idea',
};

export default function SuggestionPanel({ suggestions }: { suggestions: TopicSuggestion[] }) {
  const [pending, start] = useTransition();
  const pendingItems = suggestions.filter((s) => s.status === 'pending');

  return (
    <section style={{ marginTop: '3rem' }}>
      <h3 className="section-head">
        Email suggestions · approve before the watcher changes ({pendingItems.length} pending)
      </h3>
      <p style={{ ...meta, textTransform: 'none', letterSpacing: 0, marginBottom: '1rem' }}>
        Forward newsletters and alerts to your newsroom address. The review agent proposes topic
        updates and story ideas here — nothing applies until you approve.
      </p>
      {pendingItems.map((s) => (
        <article key={s.suggestion_id} style={card}>
          <div style={meta}>
            {ACTION_LABEL[s.action] ?? s.action}
            {' · '}{fmtDate(s.created_at)}
            {s.from_address ? ` · ${s.from_address}` : ''}
          </div>
          <b style={{ fontSize: '.95rem', display: 'block', margin: '.4rem 0' }}>{s.summary}</b>
          <SuggestionDetail action={s.action} payload={s.payload} />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn-accent" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending}
              onClick={() => start(async () => { await approveSuggestion(s.suggestion_id); })}>
              Approve
            </button>
            <button type="button" className="studio-btn-outline" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending}
              onClick={() => start(async () => { await rejectSuggestion(s.suggestion_id); })}>
              Reject
            </button>
          </div>
        </article>
      ))}
      {!pendingItems.length && (
        <p style={meta}>
          No pending suggestions. Set up inbound email and run the review agent, or POST a test
          payload to <code style={{ fontSize: '.75rem' }}>/api/inbox/email</code>.
        </p>
      )}
    </section>
  );
}

function SuggestionDetail({ action, payload }: { action: string; payload: Record<string, unknown> }) {
  if (action === 'update_topic') {
    return (
      <div style={detail}>
        {payload.topic_label ? <div>Topic: {String(payload.topic_label)}</div> : null}
        {Array.isArray(payload.add_keywords) && payload.add_keywords.length ? (
          <div>Add keywords: {(payload.add_keywords as string[]).join(' · ')}</div>
        ) : null}
        {payload.note ? <div>{String(payload.note)}</div> : null}
      </div>
    );
  }
  if (action === 'new_topic') {
    return (
      <div style={detail}>
        {payload.label ? <div>Label: {String(payload.label)}</div> : null}
        {Array.isArray(payload.keywords) ? (
          <div>Keywords: {(payload.keywords as string[]).join(' · ')}</div>
        ) : null}
        {payload.why ? <div>{String(payload.why)}</div> : null}
      </div>
    );
  }
  if (action === 'story_idea') {
    return (
      <div style={detail}>
        {payload.headline_draft ? <div>{String(payload.headline_draft)}</div> : null}
        {payload.hook ? <div style={{ opacity: .85 }}>{String(payload.hook)}</div> : null}
        {payload.data_needed ? <div>Check: {String(payload.data_needed)}</div> : null}
        {payload.kill_condition ? <div>Kill if: {String(payload.kill_condition)}</div> : null}
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
