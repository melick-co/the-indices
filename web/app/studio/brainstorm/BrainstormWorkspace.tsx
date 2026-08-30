'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { parseAngles, parseMonitoring, SessionInput } from '@/lib/research-shared';
import {
  archiveBrainstormSession,
  bankBrainstorm,
  fetchLinkContent,
  runBrainstorm,
  saveBrainstormSession,
  setupMonitoring,
  MonitorSelection,
} from './actions';

type DataSource = { source_id: string; name: string; org: string; cadence: string; active: boolean };
type MonitorRow = { monitor_id: string; kind: string; label: string; cadence: string; active: boolean };

export default function BrainstormWorkspace({
  session,
  dataSources,
  monitors,
}: {
  session: any;
  dataSources: DataSource[];
  monitors: MonitorRow[];
}) {
  const [title, setTitle] = useState(session.title ?? 'Untitled brainstorm');
  const [prompt, setPrompt] = useState(session.question ?? '');
  const [inputs, setInputs] = useState<SessionInput[]>(session.inputs ?? []);
  const [answer, setAnswer] = useState<string | null>(session.answer ?? null);
  const [followUp, setFollowUp] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bankMsg, setBankMsg] = useState<string | null>(null);
  const [showMonitor, setShowMonitor] = useState(false);
  const [pending, start] = useTransition();

  const angles = useMemo(() => (answer ? parseAngles(answer) : []), [answer]);
  const suggested = useMemo(() => {
    const fromAnswer = answer ? parseMonitoring(answer) : { topics: [], feeds: [], dataSources: [] };
    const fromSession = session.monitoring?.suggested ?? session.sources ?? {};
    return {
      topics: fromAnswer.topics.length ? fromAnswer.topics : (fromSession.topics ?? []),
      feeds: fromAnswer.feeds.length ? fromAnswer.feeds : (fromSession.feeds ?? []),
      dataSources: fromAnswer.dataSources.length ? fromAnswer.dataSources : (fromSession.dataSources ?? []),
    };
  }, [answer, session]);

  function uid() {
    return crypto.randomUUID();
  }

  function saveDraft() {
    start(async () => {
      await saveBrainstormSession(session.session_id, { title, prompt, inputs });
    });
  }

  function addLink() {
    if (!linkUrl.trim()) return;
    const url = linkUrl.trim();
    setLinkUrl('');
    start(async () => {
      setError(null);
      const fetched = await fetchLinkContent(url);
      if (!fetched.ok) {
        setError(fetched.error);
        return;
      }
      const next: SessionInput[] = [...inputs, {
        id: uid(),
        type: 'link' as const,
        url,
        label: fetched.title,
        content: fetched.text,
      }];
      setInputs(next);
      await saveBrainstormSession(session.session_id, { title, prompt, inputs: next });
    });
  }

  function onFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '').slice(0, 12000);
      const next: SessionInput[] = [...inputs, { id: uid(), type: 'file' as const, fileName: file.name, content }];
      setInputs(next);
      start(async () => {
        await saveBrainstormSession(session.session_id, { title, prompt, inputs: next });
      });
    };
    reader.readAsText(file);
  }

  function removeInput(id: string) {
    const next = inputs.filter((i) => i.id !== id);
    setInputs(next);
    start(async () => {
      await saveBrainstormSession(session.session_id, { title, prompt, inputs: next });
    });
  }

  function run() {
    setError(null);
    setBankMsg(null);
    start(async () => {
      await saveBrainstormSession(session.session_id, { title, prompt, inputs });
      const r = await runBrainstorm(session.session_id, followUp.trim() || undefined);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAnswer(r.text);
      setFollowUp('');
      if (r.monitoring && (r.monitoring.topics.length || r.monitoring.feeds.length || r.monitoring.dataSources.length)) {
        setShowMonitor(true);
      }
    });
  }

  function bank(headline: string, angleHeadline?: string) {
    setBankMsg(null);
    start(async () => {
      const r = await bankBrainstorm(session.session_id, headline, angleHeadline);
      if (!r.ok) {
        setBankMsg(r.error);
        return;
      }
      setBankMsg('Banked as candidate pitch — see Studio → Awaiting ranking.');
    });
  }

  function archive() {
    start(async () => {
      await archiveBrainstormSession(session.session_id);
      window.location.href = '/studio/brainstorm';
    });
  }

  return (
    <main style={{ paddingBottom: 'var(--spacing-84)' }}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveDraft}
          style={{ ...inp, fontSize: '1.05rem', fontWeight: 600, flex: 1, minWidth: '16rem' }} />
        <button type="button" style={ghost} onClick={saveDraft} disabled={pending}>Save</button>
        <button type="button" style={ghost} onClick={archive} disabled={pending}>Archive</button>
      </div>

      <section style={card}>
        <h3 className="section-head">Prompt</h3>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={saveDraft}
          rows={4} placeholder="What are you trying to figure out? e.g. Angles on household debt vs wage growth in Australia"
          style={textarea} />

        <div style={{ marginTop: '1rem' }}>
          <h4 style={subhead}>Add context</h4>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Paste a link"
              style={{ ...inp, flex: 1, minWidth: '14rem' }} />
            <button type="button" style={action('var(--ink)')} onClick={addLink} disabled={pending || !linkUrl.trim()}>
              Fetch link
            </button>
            <label style={action('var(--ink-soft)')}>
              Upload file
              <input type="file" accept=".txt,.md,.csv,.json,.html" style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {inputs.map((input) => (
            <div key={input.id} style={inputRow}>
              <div style={meta}>
                {input.type === 'link' && `Link · ${input.label ?? input.url}`}
                {input.type === 'file' && `File · ${input.fileName}`}
                {input.type === 'text' && 'Note'}
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginTop: '.2rem' }}>
                {(input.content ?? '').slice(0, 180)}{(input.content ?? '').length > 180 ? '…' : ''}
              </div>
              <button type="button" style={linkBtn} onClick={() => removeInput(input.id)}>Remove</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="button" style={primary} onClick={run} disabled={pending}>
            {pending ? 'Brainstorming…' : answer ? 'Run again' : 'Brainstorm'}
          </button>
          {pending && <span style={meta}>Reading the store and searching. 20–60 seconds.</span>}
        </div>
        {error && <p style={{ ...meta, color: 'var(--pen)', textTransform: 'none' }}>{error}</p>}
      </section>

      {answer && (
        <section style={{ ...card, marginTop: '1.5rem' }}>
          <h3 className="section-head">Output</h3>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '.95rem', lineHeight: 1.65 }}>{answer}</div>

          {angles.length > 0 && (
            <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--rule)' }}>
              <h4 style={subhead}>Bank an angle</h4>
              {angles.map((a) => (
                <div key={a.index} style={{ display: 'flex', justifyContent: 'space-between',
                  gap: '1rem', padding: '.5rem 0', borderBottom: '1px solid var(--rule)' }}>
                  <span style={{ fontSize: '.88rem' }}>{a.headline}</span>
                  <button type="button" style={action('var(--verify)')} disabled={pending}
                    onClick={() => bank(a.headline.slice(0, 120), a.headline)}>
                    Bank
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" style={action('var(--verify)')} disabled={pending}
              onClick={() => bank(title.slice(0, 120))}>
              Bank full session
            </button>
            <button type="button" style={action('var(--ink-soft)')} disabled={pending}
              onClick={() => setShowMonitor(true)}>
              Set up monitoring
            </button>
            {bankMsg && <span style={{ ...meta, color: 'var(--verify)', textTransform: 'none' }}>{bankMsg}</span>}
          </div>

          <div style={{ marginTop: '1.2rem' }}>
            <h4 style={subhead}>Continue this session</h4>
            <textarea value={followUp} onChange={(e) => setFollowUp(e.target.value)} rows={2}
              placeholder="Refine: focus on renters, drop the tax angle, need tier-1 sources only…"
              style={textarea} />
            <button type="button" disabled={pending || !followUp.trim()}
              onClick={run} style={{ ...action('var(--ink)'), marginTop: '.5rem' }}>
              Continue brainstorm
            </button>
          </div>
        </section>
      )}

      {monitors.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <h3 className="section-head">Active monitors from this session</h3>
          {monitors.map((m) => (
            <div key={m.monitor_id} style={{ ...meta, textTransform: 'none', padding: '.4rem 0' }}>
              {m.kind}: {m.label} · {m.cadence === 'regular' ? 'regular run' : 'on request'}
            </div>
          ))}
        </section>
      )}

      {showMonitor && (
        <MonitoringModal
          suggested={suggested}
          dataSources={dataSources}
          onClose={() => setShowMonitor(false)}
          onSave={(selection) => start(async () => {
            await setupMonitoring(session.session_id, selection);
            setShowMonitor(false);
          })}
        />
      )}

      {(session.messages ?? []).length > 1 && (
        <section style={{ marginTop: '2rem' }}>
          <h3 className="section-head">Conversation</h3>
          {(session.messages as any[]).map((m, i) => (
            <div key={i} style={{ marginBottom: '.8rem', padding: '.7rem', background: 'var(--paper-deep)' }}>
              <div style={meta}>{m.role}</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '.85rem', marginTop: '.3rem' }}>
                {String(m.content).slice(0, 2000)}
              </div>
            </div>
          ))}
        </section>
      )}

      {session.linked_pitch && (
        <p style={{ ...meta, marginTop: '1.5rem' }}>
          Linked pitch · <Link href="/studio">Open Studio</Link>
        </p>
      )}
    </main>
  );
}

function MonitoringModal({
  suggested,
  dataSources,
  onClose,
  onSave,
}: {
  suggested: { topics: { label: string; keywords: string[] }[]; feeds: { url: string; name: string }[]; dataSources: string[] };
  dataSources: DataSource[];
  onClose: () => void;
  onSave: (s: MonitorSelection) => void;
}) {
  type Cadence = 'regular' | 'on_request';
  type TopicRow = { label: string; keywords: string[]; checked: boolean; cadence: Cadence };
  type FeedRow = { url: string; name: string; checked: boolean; cadence: Cadence };
  type SourceRow = DataSource & { checked: boolean; cadence: Cadence };

  const [topicState, setTopicState] = useState<TopicRow[]>(
    suggested.topics.map((t) => ({ ...t, checked: true, cadence: 'regular' })),
  );
  const [feedState, setFeedState] = useState<FeedRow[]>(
    suggested.feeds.map((f) => ({ ...f, checked: Boolean(f.url), cadence: 'regular' })),
  );
  const [extraFeed, setExtraFeed] = useState('');
  const matchedSources = useMemo(() => {
    return dataSources.map((ds) => {
      const hit = suggested.dataSources.some((s) =>
        s.toLowerCase().includes(ds.name.toLowerCase()) ||
        s.toLowerCase().includes(ds.org.toLowerCase()) ||
        s.toLowerCase().includes(ds.source_id.replace(/_/g, ' ')));
      return { ...ds, checked: hit, cadence: 'regular' as Cadence };
    }).filter((ds) => ds.checked || suggested.dataSources.length === 0).slice(0, 12);
  }, [dataSources, suggested.dataSources]);
  const [sourceState, setSourceState] = useState<SourceRow[]>(matchedSources);

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 className="section-head">Monitor sources?</h3>
        <p style={{ ...meta, textTransform: 'none', letterSpacing: 0, lineHeight: 1.6 }}>
          Choose what to watch in regular agent runs (RSS + release calendar) or mark for on-request checks only.
        </p>

        {topicState.length > 0 && (
          <>
            <h4 style={subhead}>News topics</h4>
            {topicState.map((t, i) => (
              <label key={i} style={checkRow}>
                <input type="checkbox" checked={t.checked}
                  onChange={(e) => setTopicState((s) => s.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
                <span>{t.label}</span>
                <select value={t.cadence} onChange={(e) => setTopicState((s) => s.map((x, j) =>
                  j === i ? { ...x, cadence: e.target.value as Cadence } : x))}>
                  <option value="regular">Regular run</option>
                  <option value="on_request">On request</option>
                </select>
              </label>
            ))}
          </>
        )}

        {(feedState.length > 0 || true) && (
          <>
            <h4 style={subhead}>RSS feeds</h4>
            {feedState.map((f, i) => (
              <label key={i} style={checkRow}>
                <input type="checkbox" checked={f.checked}
                  onChange={(e) => setFeedState((s) => s.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
                <span style={{ fontSize: '.82rem' }}>{f.name || f.url}</span>
                <select value={f.cadence} onChange={(e) => setFeedState((s) => s.map((x, j) =>
                  j === i ? { ...x, cadence: e.target.value as Cadence } : x))}>
                  <option value="regular">Regular run</option>
                  <option value="on_request">On request</option>
                </select>
              </label>
            ))}
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input value={extraFeed} onChange={(e) => setExtraFeed(e.target.value)} placeholder="Add RSS URL"
                style={{ ...inp, flex: 1 }} />
              <button type="button" style={ghost} onClick={() => {
                if (!extraFeed.trim()) return;
                setFeedState((s) => [...s, { url: extraFeed.trim(), name: extraFeed.trim(), checked: true, cadence: 'regular' }]);
                setExtraFeed('');
              }}>Add</button>
            </div>
          </>
        )}

        {sourceState.length > 0 && (
          <>
            <h4 style={subhead}>Data releases</h4>
            {sourceState.map((s, i) => (
              <label key={s.source_id} style={checkRow}>
                <input type="checkbox" checked={s.checked}
                  onChange={(e) => setSourceState((st) => st.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
                <span style={{ fontSize: '.82rem' }}>{s.name} ({s.org})</span>
                <select value={s.cadence} onChange={(e) => setSourceState((st) => st.map((x, j) =>
                  j === i ? { ...x, cadence: e.target.value as Cadence } : x))}>
                  <option value="regular">Regular run</option>
                  <option value="on_request">On request</option>
                </select>
              </label>
            ))}
          </>
        )}

        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.2rem' }}>
          <button type="button" style={primary} onClick={() => onSave({
            topics: topicState.filter((t) => t.checked).map(({ label, keywords, cadence }) => ({ label, keywords, cadence })),
            feeds: feedState.filter((f) => f.checked).map(({ url, name, cadence }) => ({ url, name, cadence })),
            dataSources: sourceState.filter((s) => s.checked).map(({ source_id, name, cadence }) => ({
              sourceId: source_id, label: name, cadence,
            })),
          })}>
            Enable monitoring
          </button>
          <button type="button" style={ghost} onClick={onClose}>Skip</button>
        </div>
      </div>
    </div>
  );
}

const meta: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-faint)',
};
const subhead: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '0 0 .5rem',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '.5rem .6rem', border: '1px solid var(--rule)',
  background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem',
};
const textarea: React.CSSProperties = {
  ...inp, resize: 'vertical', lineHeight: 1.55, padding: '.7rem',
};
const card: React.CSSProperties = {
  border: '1px solid var(--rule)', padding: '1.2rem', background: '#fff',
};
const inputRow: React.CSSProperties = {
  border: '1px solid var(--rule)', padding: '.6rem .7rem', marginBottom: '.5rem', background: 'var(--paper-deep)',
};
const primary: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem', letterSpacing: '.08em',
  textTransform: 'uppercase', padding: '.6rem 1.2rem', cursor: 'pointer', borderRadius: 0,
  border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--paper)',
};
const ghost: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.06em',
  textTransform: 'uppercase', padding: '.5rem .9rem', cursor: 'pointer', borderRadius: 0,
  border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-soft)',
};
const action = (c: string): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem', letterSpacing: '.06em',
  textTransform: 'uppercase', padding: '.5rem .9rem', cursor: 'pointer', borderRadius: 0,
  border: `1px solid ${c}`, background: 'transparent', color: c,
});
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)',
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', marginTop: '.3rem', padding: 0,
};
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem',
};
const modal: React.CSSProperties = {
  background: 'var(--paper)', border: '1px solid var(--ink)', maxWidth: '36rem',
  width: '100%', maxHeight: '85vh', overflow: 'auto', padding: '1.3rem',
};
const checkRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '.6rem', alignItems: 'center',
  padding: '.35rem 0', fontSize: '.85rem',
};
