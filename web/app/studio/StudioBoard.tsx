'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { act, addToInbox } from './actions';
import { createClient } from '@/lib/supabase-browser';

interface Pitch {
  id: string; headline: string; hook: string | null; mechanism: string | null;
  caveat: string | null; chart_hint: string | null; detector: string;
  trigger_rows: any; metric_ids: string[] | null; score: any; rank_value: number | null;
  state: string; resurface_on: string | null; resurface_after: string | null;
  resurface_metrics: string[] | null; times_pitched: number; first_seen: string;
}

const ORDER = ['pitched', 'candidate', 'approved', 'watchlist', 'dormant', 'rejected', 'published'];
const LABEL: Record<string, string> = {
  pitched: 'Today\u2019s pitches', candidate: 'Awaiting ranking', approved: 'Approved',
  watchlist: 'Watchlist', dormant: 'Dormant', rejected: 'Rejected', published: 'Published',
};

export default function StudioBoard({ pitches, runs, inbox, feedback }:
  { pitches: Pitch[]; runs: any[]; inbox: any[]; feedback: any[] }) {
  const [tab, setTab] = useState('pitched');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [showInbox, setShowInbox] = useState(false);

  const byState = (s: string) => pitches.filter((p) => p.state === s);
  const shown = byState(tab);

  const run = (id: string, action: any) =>
    start(() => { act(id, action, note[id] || undefined).then(() => setNote((n) => ({ ...n, [id]: '' }))); });

  return (
    <>
      <header className="masthead">
        <div className="wrap masthead-inner">
          <div>
            <Link href="/" className="wordmark">Caveat</Link>
            <div className="lector">Studio · editorial workbench</div>
          </div>
          <nav className="nav">
            <button onClick={() => setShowInbox((v) => !v)} style={linkBtn}>+ Inbox</button>
            <Link href="/">Public site</Link>
            <button style={linkBtn}
              onClick={async () => { await createClient().auth.signOut(); location.href = '/login'; }}>
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="wrap" style={{ paddingBottom: '4rem' }}>
        {showInbox && <InboxForm onDone={() => setShowInbox(false)} />}

        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
          {ORDER.map((s) => (
            <button key={s} onClick={() => setTab(s)} style={tabBtn(s === tab)}>
              {LABEL[s]} <span style={{ opacity: .6 }}>{byState(s).length}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 && (
          <p style={{ color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '.82rem', padding: '2rem 0' }}>
            Nothing here. {tab === 'pitched' && 'A quiet day is honest output.'}
          </p>
        )}

        {shown.map((p) => {
          const isOpen = open === p.id;
          return (
            <article key={p.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '18rem' }}>
                  <div style={meta}>
                    {p.detector}
                    {p.times_pitched > 1 && ` · pitched ${p.times_pitched}\u00d7`}
                    {p.rank_value != null && ` · rank ${p.rank_value}`}
                  </div>
                  <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: '1.25rem',
                    lineHeight: 1.25, marginBottom: '.5rem' }}>{p.headline}</h2>
                  {p.hook && <p style={{ color: 'var(--ink-soft)', fontSize: '.92rem' }}>{p.hook}</p>}
                </div>
                {p.score && (
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem',
                    color: 'var(--ink-faint)', textAlign: 'right', lineHeight: 1.7 }}>
                    {Object.entries(p.score).map(([k, v]) => (
                      <div key={k}>{k.slice(0, 5)} <b style={{ color: 'var(--ink)' }}>{String(v)}</b></div>
                    ))}
                  </div>
                )}
              </div>

              {isOpen && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--rule)' }}>
                  {p.mechanism && <Field label="Mechanism" value={p.mechanism} />}
                  {p.caveat && <Field label="Caveat" value={p.caveat} pen />}
                  {p.chart_hint && <Field label="Chart" value={p.chart_hint} />}
                  {p.resurface_on && <Field label="Resurfaces" value={
                    `${p.resurface_on}${p.resurface_after ? ` (after ${p.resurface_after})` : ''}`} />}
                  {p.metric_ids?.length ? <Field label="Metrics" value={p.metric_ids.join(', ')} /> : null}
                  <details style={{ marginTop: '.7rem' }}>
                    <summary style={{ ...meta, cursor: 'pointer' }}>Trigger rows</summary>
                    <pre style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem',
                      background: 'var(--paper-deep)', padding: '.7rem', overflowX: 'auto',
                      marginTop: '.4rem' }}>{JSON.stringify(p.trigger_rows, null, 2)}</pre>
                  </details>
                </div>
              )}

              <div style={{ display: 'flex', gap: '.4rem', marginTop: '1rem',
                flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={actBtn('var(--verify)')} disabled={pending}
                  onClick={() => run(p.id, 'approve')}>Approve</button>
                <button style={actBtn('var(--ink-soft)')} disabled={pending}
                  onClick={() => run(p.id, 'watchlist')}>Watchlist</button>
                <button style={actBtn('var(--pen)')} disabled={pending}
                  onClick={() => run(p.id, 'reject')}>Reject</button>
                <button style={actBtn('var(--ink-faint)')} disabled={pending}
                  onClick={() => run(p.id, 'rank_up')}>▲</button>
                <button style={actBtn('var(--ink-faint)')} disabled={pending}
                  onClick={() => run(p.id, 'rank_down')}>▼</button>
                <button style={linkBtn} onClick={() => setOpen(isOpen ? null : p.id)}>
                  {isOpen ? 'Less' : 'Detail'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '.4rem', marginTop: '.6rem' }}>
                <input placeholder="Direction or note — travels with the pitch into the next run"
                  value={note[p.id] ?? ''}
                  onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))}
                  style={{ flex: 1, padding: '.45rem .6rem', border: '1px solid var(--rule)',
                    background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '.75rem' }} />
                <button style={actBtn('var(--ink)')} disabled={pending || !note[p.id]}
                  onClick={() => run(p.id, 'comment')}>Save note</button>
              </div>
            </article>
          );
        })}

        <section style={{ marginTop: '3rem', display: 'grid', gap: '2rem',
          gridTemplateColumns: 'repeat(auto-fit,minmax(17rem,1fr))' }}>
          <div>
            <h3 className="section-head">Recent agent runs</h3>
            {runs.map((r) => (
              <div key={r.id} style={{ ...meta, marginBottom: '.5rem' }}>
                {new Date(r.ran_at).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })}
                {' · '}{r.quiet_day ? 'quiet day' : `${r.pitched ?? 0} pitched`}
                {r.resurfaced ? ` · ${r.resurfaced} resurfaced` : ''}
                {r.notes ? <div style={{ opacity: .7 }}>{String(r.notes).slice(0, 90)}</div> : null}
              </div>
            ))}
            {!runs.length && <p style={meta}>No runs recorded yet.</p>}
          </div>
          <div>
            <h3 className="section-head">Inbox</h3>
            {inbox.map((i) => (
              <div key={i.id} style={{ ...meta, marginBottom: '.5rem' }}>
                [{i.kind}] {i.title || i.url || String(i.body ?? '').slice(0, 50)}
                <span style={{ opacity: .6 }}> · {i.status}</span>
              </div>
            ))}
            {!inbox.length && <p style={meta}>Empty.</p>}
          </div>
          <div>
            <h3 className="section-head">Your last decisions</h3>
            {feedback.map((f) => (
              <div key={f.id} style={{ ...meta, marginBottom: '.5rem' }}>
                {f.action}{f.comment ? `: ${f.comment}` : ''}
              </div>
            ))}
            {!feedback.length && <p style={meta}>None yet. These teach the ranking.</p>}
          </div>
        </section>
      </main>
    </>
  );
}

function Field({ label, value, pen }: { label: string; value: string; pen?: boolean }) {
  return (
    <div style={{ marginBottom: '.7rem', paddingLeft: pen ? '.7rem' : 0,
      borderLeft: pen ? '2px solid var(--pen)' : undefined }}>
      <div style={{ ...meta, color: pen ? 'var(--pen)' : 'var(--ink-faint)' }}>{label}</div>
      <div style={{ fontSize: '.9rem' }}>{value}</div>
    </div>
  );
}

function InboxForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState('idea');
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [url, setUrl] = useState('');
  const [pending, start] = useTransition();
  return (
    <div style={{ ...card, background: 'var(--paper-deep)' }}>
      <div style={meta}>Add to inbox — ideas, links, datasets, or an RSS feed URL</div>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.6rem 0' }}>
        {['idea', 'link', 'article', 'dataset', 'data_source'].map((k) => (
          <button key={k} onClick={() => setKind(k)} style={tabBtn(k === kind)}>{k}</button>
        ))}
      </div>
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inp} />
      <input placeholder="URL (an RSS feed here is auto-registered for the watcher)"
        value={url} onChange={(e) => setUrl(e.target.value)} style={inp} />
      <textarea placeholder="The idea, in your words" value={body} rows={3}
        onChange={(e) => setBody(e.target.value)} style={{ ...inp, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '.4rem' }}>
        <button style={actBtn('var(--ink)')} disabled={pending}
          onClick={() => start(() => { addToInbox(kind, title, body, url).then(onDone); })}>Add</button>
        <button style={linkBtn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--rule)', padding: '1.2rem', marginBottom: '1rem', background: 'var(--card, #fff)',
};
const meta: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-faint)',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '.5rem .6rem', border: '1px solid var(--rule)', background: 'var(--paper)',
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem', marginBottom: '.5rem',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)',
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.09em',
  textTransform: 'uppercase', padding: 0,
};
const tabBtn = (active: boolean): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', letterSpacing: '.06em',
  textTransform: 'uppercase', padding: '.35rem .6rem', cursor: 'pointer', borderRadius: 0,
  border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
  background: active ? 'var(--ink)' : 'transparent',
  color: active ? 'var(--paper)' : 'var(--ink-soft)',
});
const actBtn = (colour: string): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem', letterSpacing: '.06em',
  textTransform: 'uppercase', padding: '.4rem .75rem', cursor: 'pointer', borderRadius: 0,
  border: `1px solid ${colour}`, background: 'transparent', color: colour,
});
