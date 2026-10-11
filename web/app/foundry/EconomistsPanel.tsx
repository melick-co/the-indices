'use client';

import { useTransition } from 'react';
import { dismissNote, pitchNote } from './actions';

export type EconomistNote = {
  id: string; source_id: string; source_kind: string; org: string | null; author: string | null; title: string;
  url: string | null; published_at: string | null; status: string; summary: string | null; angle: string | null;
  claims: { text: string; kind?: string; figure?: string | null; horizon?: string | null; metric_id?: string | null; verdict?: string; data_note?: string }[];
};

const VERDICT: Record<string, { label: string; color: string }> = {
  agrees: { label: 'Data agrees', color: '#1a7f37' },
  disagrees: { label: 'Data disagrees', color: '#c0362c' },
  partly: { label: 'Partly', color: '#9a6700' },
  'too early': { label: 'Too early', color: 'var(--ink-faint)' },
  unclear: { label: 'Unclear', color: 'var(--ink-faint)' },
};

/** What economists are saying, read against the data (run-economist-review.mjs). Views are attributed context. */
export default function EconomistsPanel({ notes }: { notes: EconomistNote[] }) {
  const [pending, start] = useTransition();
  const open = notes.filter((n) => n.status === 'reviewed');
  const waiting = notes.filter((n) => n.status === 'new').length;

  return (
    <section style={{ marginTop: '3rem' }}>
      <h3 className="section-head">What economists are saying · checked against the data ({open.length})</h3>
      <p style={{ ...meta, textTransform: 'none', letterSpacing: 0, marginBottom: '1rem' }}>
        Research feeds and approved senders&apos; newsletters, read twice a day. Each claim is tested against the
        official series where one exists. Their views are attributed context, never a headline figure.
        {waiting ? ` ${waiting} waiting for review.` : ''}
      </p>
      {open.map((n) => (
        <article key={n.id} style={card}>
          <div style={meta}>
            {[n.author, n.org].filter(Boolean).join(' · ')}{n.published_at ? ` · ${fmtDate(n.published_at)}` : ''}
            {n.source_kind === 'email' ? ' · email' : ''}
          </div>
          <b style={{ fontSize: '.95rem', display: 'block', margin: '.4rem 0' }}>
            {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title}
          </b>
          {n.summary && <div style={detail}>{n.summary}</div>}
          {n.claims.length > 0 && (
            <ul style={{ ...detail, paddingLeft: 18, margin: '10px 0 0' }}>
              {n.claims.map((c, i) => {
                const v = c.verdict ? VERDICT[c.verdict] : undefined;
                return (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {c.text}
                    {v && <span style={{ ...tag, color: v.color, borderColor: v.color }}>{v.label}</span>}
                    {c.data_note && <div style={{ fontSize: 13, color: 'var(--ink-faint)' }}>{c.data_note}{c.metric_id ? ` (${c.metric_id})` : ''}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          {n.angle && <div style={{ ...detail, color: 'var(--ink)' }}><b>Angle:</b> {n.angle}</div>}
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn-accent" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending} onClick={() => start(async () => { await pitchNote(n.id); })}>
              Make this a pitch
            </button>
            <button type="button" className="studio-btn-outline" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}
              disabled={pending} onClick={() => start(async () => { await dismissNote(n.id); })}>
              Dismiss
            </button>
          </div>
        </article>
      ))}
      {!open.length && <p style={meta}>Nothing to review yet. The reviewer runs with the email job, or run the economists task.</p>}
    </section>
  );
}

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

const meta: React.CSSProperties = {
  fontFamily: 'var(--font-ops, Inter, sans-serif)', fontSize: 12, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--ink-faint)',
};
const detail: React.CSSProperties = { fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.43, marginTop: 8 };
const tag: React.CSSProperties = {
  display: 'inline-block', marginLeft: 8, padding: '0 8px', border: '1px solid', borderRadius: 999,
  fontFamily: 'var(--font-ops, Inter, sans-serif)', fontSize: 11, lineHeight: '18px', whiteSpace: 'nowrap',
};
const card: React.CSSProperties = {
  border: '1px solid #e5e5e5', padding: 20, marginBottom: 12, background: '#fff',
  borderRadius: 24, boxShadow: '0 0 0 1px rgba(23,23,23,0.05), 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
};
