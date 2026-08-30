'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { research, bankResearch, addTopic, toggleTopic } from '../brainstorm/actions';

type Mode = 'ask';

export default function AskPanel({ topics, sessions }: { topics: any[]; sessions: any[] }) {
  const mode: Mode = 'ask';
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [showTopic, setShowTopic] = useState(false);
  const [banked, setBanked] = useState(false);

  function run() {
    if (!q.trim()) return;
    setAnswer(null); setBanked(false);
    start(async () => {
      const r = await research(mode, q);
      setAnswer(r.text); setSessionId(r.sessionId); setTools(r.toolsUsed);
    });
  }

  return (
    <>
      <main style={{ paddingBottom: 'var(--spacing-84)' }}>
        <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>Ask</h1>
        <div style={{ display: 'flex', gap: 'var(--spacing-10)', marginBottom: 'var(--spacing-21)', alignItems: 'center' }}>
          <span className="studio-tab is-active">Ask</span>
          <Link href="/studio/brainstorm" className="studio-tab">Brainstorm</Link>
        </div>

        <p style={{ ...meta, textTransform: 'none', letterSpacing: 0, marginBottom: '.7rem' }}>
          Researches your store and the web, then judges the finding against the charter. Returns a verdict, not just an answer.
        </p>

        <textarea
          value={q} onChange={(e) => setQ(e.target.value)} rows={3}
          placeholder="e.g. Has Australian real wage growth actually turned positive, or is that a base effect?"
          style={{ width: '100%', padding: '.7rem', border: '1px solid var(--ink)',
            background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '.85rem', resize: 'vertical', marginBottom: '.6rem' }} />

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={primary} onClick={run} disabled={pending || !q.trim()}>
            {pending ? 'Researching…' : 'Research'}
          </button>
          {pending && <span style={meta}>Reading the store and searching. This takes 20 to 60 seconds.</span>}
        </div>

        {answer && (
          <article style={{ marginTop: '1.5rem', border: '1px solid var(--rule)',
            padding: '1.3rem', background: '#fff' }}>
            <div style={{ ...meta, marginBottom: '.8rem' }}>
              {tools.length ? `Consulted: ${tools.join(', ')}` : 'No tools used'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '.95rem', lineHeight: 1.65 }}>
              {answer}
            </div>
            {sessionId && (
              <div style={{ marginTop: '1.2rem', paddingTop: '1rem',
                borderTop: '1px solid var(--rule)', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                {banked ? (
                  <span style={{ ...meta, color: 'var(--verify)' }}>Banked as a candidate pitch</span>
                ) : (
                  <button style={action('var(--verify)')} disabled={pending}
                    onClick={() => start(async () => {
                      const r = await bankResearch(sessionId, q.slice(0, 120));
                      if (r.ok) setBanked(true);
                    })}>
                    Bank as pitch
                  </button>
                )}
                <span style={meta}>Saved to research history either way</span>
              </div>
            )}
          </article>
        )}

        <section style={{ marginTop: '3rem' }}>
          <h3 className="section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tracked topics</span>
            <button style={linkBtn} onClick={() => setShowTopic((v) => !v)}>+ Add topic</button>
          </h3>
          {showTopic && <TopicForm onDone={() => setShowTopic(false)} />}
          {topics.map((t) => (
            <div key={t.topic_id} style={{ padding: '.7rem 0', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <div>
                  <b style={{ fontSize: '.95rem', opacity: t.active ? 1 : .45 }}>{t.label}</b>
                  {t.why && <div style={{ ...meta, textTransform: 'none', letterSpacing: 0 }}>{t.why}</div>}
                  <div style={{ ...meta, marginTop: '.2rem' }}>{(t.keywords ?? []).join(' · ')}</div>
                </div>
                <button style={linkBtn}
                  onClick={() => toggleTopic(t.topic_id, !t.active)}>
                  {t.active ? 'Pause' : 'Resume'}
                </button>
              </div>
            </div>
          ))}
          {!topics.length && <p style={meta}>No topics yet. Add one and the news watcher will track it.</p>}
        </section>

        <section style={{ marginTop: '2.5rem' }}>
          <h3 className="section-head">Research history</h3>
          {sessions.map((s) => (
            <details key={s.session_id} style={{ marginBottom: '.6rem' }}>
              <summary style={{ ...meta, textTransform: 'none', letterSpacing: 0, cursor: 'pointer' }}>
                [{s.mode}] {s.question.slice(0, 90)}
                {s.verdict && <b style={{ color: s.verdict === 'publishable' ? 'var(--verify)'
                  : s.verdict === 'killed' ? 'var(--pen)' : 'var(--ink-soft)' }}> · {s.verdict}</b>}
              </summary>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '.85rem', padding: '.7rem',
                background: 'var(--paper-deep)', marginTop: '.3rem' }}>{s.answer}</div>
            </details>
          ))}
          {!sessions.length && <p style={meta}>Nothing asked yet.</p>}
        </section>
      </main>
    </>
  );
}

function TopicForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState(''); const [kw, setKw] = useState(''); const [why, setWhy] = useState('');
  const [pending, start] = useTransition();
  return (
    <div style={{ border: '1px solid var(--rule)', padding: '1rem', marginBottom: '1rem',
      background: 'var(--paper-deep)' }}>
      <input placeholder="Topic label, e.g. Insolvencies" value={label}
        onChange={(e) => setLabel(e.target.value)} style={inp} />
      <input placeholder="Keywords, comma separated — these feed the news watcher"
        value={kw} onChange={(e) => setKw(e.target.value)} style={inp} />
      <input placeholder="Why this matters (optional)" value={why}
        onChange={(e) => setWhy(e.target.value)} style={inp} />
      <div style={{ display: 'flex', gap: '.4rem' }}>
        <button style={action('var(--ink)')} disabled={pending || !label || !kw}
          onClick={() => start(async () => { await addTopic(label, kw, why); onDone(); })}>Add</button>
        <button style={linkBtn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

const meta: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-faint)',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '.5rem .6rem', border: '1px solid var(--rule)',
  background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '.78rem', marginBottom: '.5rem',
};
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)',
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem', letterSpacing: '.09em',
  textTransform: 'uppercase', padding: 0,
};
const tab = (active: boolean): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.08em',
  textTransform: 'uppercase', padding: '.45rem .9rem', cursor: 'pointer', borderRadius: 0,
  border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
  background: active ? 'var(--ink)' : 'transparent',
  color: active ? 'var(--paper)' : 'var(--ink-soft)',
});
const action = (c: string): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.06em',
  textTransform: 'uppercase', padding: '.5rem .9rem', cursor: 'pointer', borderRadius: 0,
  border: `1px solid ${c}`, background: 'transparent', color: c,
});
const primary: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem', letterSpacing: '.08em',
  textTransform: 'uppercase', padding: '.6rem 1.2rem', cursor: 'pointer', borderRadius: 0,
  border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--paper)',
};
