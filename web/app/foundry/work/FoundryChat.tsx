'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  parseAngles,
  parseMonitoring,
  normalizeMessages,
  SessionInput,
  type FoundryIntent,
  type FoundryMessage,
} from '@/lib/research-shared';
import {
  archiveFoundrySession,
  bankFoundrySession,
  fetchLinkContent,
  saveFoundrySession,
  setupMonitoring,
  trackSession,
  MonitorSelection,
} from './actions';

type DataSource = { source_id: string; name: string; org: string; cadence: string; active: boolean };
type MonitorRow = { monitor_id: string; kind: string; label: string; cadence: string; active: boolean };

const INTENTS: { value: FoundryIntent; label: string }[] = [
  { value: 'investigate', label: 'Investigate' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'refine', label: 'Refine' },
  { value: 'precedents', label: 'Precedents' },
];

export default function FoundryChat({
  session,
  dataSources,
  monitors,
  parentSession,
  forks,
}: {
  session: Record<string, unknown>;
  dataSources: DataSource[];
  monitors: MonitorRow[];
  parentSession: { session_id: string; title: string | null } | null;
  forks: { session_id: string; title: string | null }[];
}) {
  const router = useRouter();
  const sessionId = String(session.session_id);
  const [title, setTitle] = useState(String(session.title ?? 'Untitled session'));
  const [prompt, setPrompt] = useState(String(session.question ?? ''));
  const [inputs, setInputs] = useState<SessionInput[]>((session.inputs as SessionInput[]) ?? []);
  const [intent, setIntent] = useState<FoundryIntent>(
    (session.intent as FoundryIntent) ?? 'investigate',
  );
  const [messages, setMessages] = useState<FoundryMessage[]>(
    () => normalizeMessages(session.messages),
  );
  const [composer, setComposer] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState<FoundryMessage['tool_steps']>([]);
  const [error, setError] = useState<string | null>(null);
  const [bankMsg, setBankMsg] = useState<string | null>(null);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);
  const [showMonitor, setShowMonitor] = useState(false);
  const [pending, start] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant'),
    [messages],
  );
  const suggested = useMemo(() => {
    const text = lastAssistant?.content ?? '';
    const fromAnswer = text ? parseMonitoring(text) : { topics: [], feeds: [], dataSources: [] };
    const fromSession = (session.monitoring as Record<string, unknown>)?.suggested ?? session.sources ?? {};
    return {
      topics: fromAnswer.topics.length ? fromAnswer.topics : ((fromSession as { topics?: unknown[] }).topics ?? []),
      feeds: fromAnswer.feeds.length ? fromAnswer.feeds : ((fromSession as { feeds?: unknown[] }).feeds ?? []),
      dataSources: fromAnswer.dataSources.length ? fromAnswer.dataSources : ((fromSession as { dataSources?: unknown[] }).dataSources ?? []),
    };
  }, [lastAssistant, session]);

  function uid() {
    return crypto.randomUUID();
  }

  const saveDraft = useCallback(() => {
    start(async () => {
      await saveFoundrySession(sessionId, { title, prompt, inputs, intent });
    });
  }, [sessionId, title, prompt, inputs, intent, start]);

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
      await saveFoundrySession(sessionId, { title, prompt, inputs: next, intent });
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
        await saveFoundrySession(sessionId, { title, prompt, inputs: next, intent });
      });
    };
    reader.readAsText(file);
  }

  async function runTurn(runPrompt?: string, runIntent?: FoundryIntent) {
    setError(null);
    setBankMsg(null);
    setRunning(true);
    setLiveText('');
    setLiveTools([]);
    await saveFoundrySession(sessionId, { title, prompt, inputs, intent: runIntent ?? intent });

    const body = {
      prompt: (runPrompt ?? composer.trim()) || undefined,
      intent: runIntent ?? intent,
    };
    if (!body.prompt && !prompt.trim() && !inputs.length) {
      setError('Add a prompt, link, or file before running.');
      setRunning(false);
      return;
    }

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/foundry/${sessionId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Run failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let streamToolSteps: FoundryMessage['tool_steps'] = [];
      let followUps: FoundryMessage['follow_ups'];
      let score: FoundryMessage['score'];
      let verdict: FoundryMessage['verdict'];
      let branches: FoundryMessage['branches'];
      let messageId: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const lines = part.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (event === 'tool_start') {
            streamToolSteps = [...(streamToolSteps ?? []), {
              name: parsed.name,
              label: parsed.label,
              detail: parsed.detail,
              at: parsed.at,
            }];
            setLiveTools(streamToolSteps);
          } else if (event === 'text_delta') {
            accumulated += parsed.delta;
            setLiveText(accumulated);
          } else if (event === 'follow_ups') {
            followUps = parsed.items;
          } else if (event === 'score') {
            score = { ...parsed.score, rank_value: parsed.rank_value };
            verdict = parsed.verdict;
          } else if (event === 'branches') {
            branches = parsed.items;
          } else if (event === 'done') {
            messageId = parsed.messageId;
          } else if (event === 'error') {
            throw new Error(parsed.message);
          }
        }
      }

      const userContent = (runPrompt ?? composer.trim()) || prompt;
      if (userContent.trim()) {
        setMessages((prev) => {
          const hasUser = runPrompt ? true : prev.some((m) => m.role === 'user');
          const next = [...prev];
          if (runPrompt || !hasUser) {
            next.push({
              id: uid(),
              role: 'user',
              content: userContent,
              at: new Date().toISOString(),
              intent: runIntent ?? intent,
            });
          }
          next.push({
            id: messageId ?? uid(),
            role: 'assistant',
            content: accumulated,
            at: new Date().toISOString(),
            tool_steps: streamToolSteps.length ? streamToolSteps : undefined,
            follow_ups: followUps,
            score,
            verdict,
            branches,
          });
          return next;
        });
      }
      setComposer('');
      router.refresh();
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
      }
    } finally {
      setRunning(false);
      setLiveText('');
      setLiveTools([]);
    }
  }

  function fork(messageId?: string, label?: string) {
    start(async () => {
      const res = await fetch(`/api/foundry/${sessionId}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId, label, title: label ? `${label.slice(0, 60)} (fork)` : undefined }),
      });
      const data = await res.json();
      if (data.newSessionId) router.push(`/foundry/work/${data.newSessionId}`);
    });
  }

  function bank(headline: string, messageId?: string, angleHeadline?: string) {
    setBankMsg(null);
    start(async () => {
      const r = await bankFoundrySession(sessionId, headline, messageId, angleHeadline);
      if (!r.ok) {
        setBankMsg(r.error);
        return;
      }
      setBankMsg('Banked as candidate pitch — see Foundry → Awaiting ranking.');
    });
  }

  function track() {
    setTrackMsg(null);
    start(async () => {
      const r = await trackSession(sessionId);
      if (!r.ok) {
        setTrackMsg(r.error);
        return;
      }
      setTrackMsg(r.already ? 'Already tracked' : 'Added to sessions and news watch');
    });
  }

  function archive() {
    start(async () => {
      await archiveFoundrySession(sessionId);
      router.push('/foundry/work');
    });
  }

  return (
    <main className="foundry-chat" style={{ paddingBottom: 'var(--spacing-84)' }}>
      <header className="foundry-chat-header">
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveDraft}
            className="foundry-title-input" />
          <select value={intent} onChange={(e) => setIntent(e.target.value as FoundryIntent)}
            onBlur={saveDraft} className="foundry-intent-select">
            {INTENTS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <button type="button" className="btn-ghost" onClick={saveDraft} disabled={pending}>Save</button>
          <button type="button" className="btn-ghost" onClick={archive} disabled={pending}>Archive</button>
        </div>
        {(parentSession || forks.length > 0) && (
          <div className="foundry-lineage">
            {parentSession && (
              <Link href={`/foundry/work/${parentSession.session_id}`}>
                ↳ forked from {parentSession.title ?? 'parent'}
              </Link>
            )}
            {forks.map((f) => (
              <Link key={f.session_id} href={`/foundry/work/${f.session_id}`}>
                branch: {f.title ?? f.session_id.slice(0, 8)}
              </Link>
            ))}
          </div>
        )}
      </header>

      <section className="foundry-thread">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onFollowUp={(p, i) => runTurn(p, i ?? 'refine')}
            onFork={(label) => fork(m.id, label)}
            onBank={(h, angle) => bank(h, m.id, angle)}
            disabled={running || pending}
          />
        ))}

        {running && (
          <div className="foundry-message foundry-message-assistant">
            <div className="foundry-message-role">Assistant · running</div>
            {(liveTools?.length ?? 0) > 0 && (
              <ul className="foundry-tool-steps">
                {(liveTools ?? []).map((t, i) => (
                  <li key={i}>{t.label}{t.detail ? ` · ${t.detail}` : ''}</li>
                ))}
              </ul>
            )}
            {liveText && <div className="foundry-message-body">{liveText}</div>}
            {!liveText && !(liveTools?.length) && (
              <div className="foundry-message-body foundry-muted">Starting…</div>
            )}
          </div>
        )}
      </section>

      <section className="foundry-composer">
        <h3 className="section-head">Context</h3>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={saveDraft}
          rows={3} placeholder="Session prompt — the question or topic you're working on"
          className="foundry-textarea" />
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', margin: '.6rem 0' }}>
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="Paste a link"
            className="foundry-input" style={{ flex: 1, minWidth: '14rem' }} />
          <button type="button" className="btn-accent" onClick={addLink} disabled={pending || !linkUrl.trim()}>
            Fetch link
          </button>
          <label className="btn-ghost" style={{ cursor: 'pointer' }}>
            Upload file
            <input type="file" accept=".txt,.md,.csv,.json,.html" style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {inputs.map((input) => (
          <div key={input.id} className="foundry-input-row">
            <div className="foundry-meta">
              {input.type === 'link' && `Link · ${input.label ?? input.url}`}
              {input.type === 'file' && `File · ${input.fileName}`}
            </div>
            <button type="button" className="studio-link" onClick={() => {
              const next = inputs.filter((i) => i.id !== input.id);
              setInputs(next);
              start(async () => { await saveFoundrySession(sessionId, { title, prompt, inputs: next, intent }); });
            }}>Remove</button>
          </div>
        ))}

        <h3 className="section-head" style={{ marginTop: '1.5rem' }}>Message</h3>
        <textarea value={composer} onChange={(e) => setComposer(e.target.value)} rows={2}
          placeholder="Ask a follow-up, refine an angle, or request precedents…"
          className="foundry-textarea" />
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.6rem' }}>
          <button type="button" className="btn-accent" disabled={running || pending}
            onClick={() => runTurn()}>
            {running ? 'Running…' : messages.length ? 'Send' : 'Run'}
          </button>
          <button type="button" className="btn-ghost" disabled={running || pending}
            onClick={() => runTurn(undefined, 'precedents')}>
            Research precedents
          </button>
          <button type="button" className="btn-ghost" disabled={running || pending} onClick={track}>
            Track
          </button>
          {lastAssistant && (
            <button type="button" className="studio-link" disabled={running || pending}
              onClick={() => bank(title.slice(0, 120), lastAssistant.id)}>
              Bank turn
            </button>
          )}
          <button type="button" className="studio-link" disabled={running || pending}
            onClick={() => setShowMonitor(true)}>
            Set up monitoring
          </button>
        </div>
        {error && <p className="foundry-error">{error}</p>}
        {bankMsg && <p className="foundry-success">{bankMsg}</p>}
        {trackMsg && <p className="foundry-success">{trackMsg}</p>}
      </section>

      {showMonitor && (
        <MonitoringModal
          suggested={suggested as { topics: { label: string; keywords: string[] }[]; feeds: { url: string; name: string }[]; dataSources: string[] }}
          dataSources={dataSources}
          onClose={() => setShowMonitor(false)}
          onSave={(selection) => start(async () => {
            await setupMonitoring(sessionId, selection);
            setShowMonitor(false);
          })}
        />
      )}

      {Boolean(session.linked_pitch) && (
        <p className="foundry-meta" style={{ marginTop: '1.5rem' }}>
          Linked pitch · <Link href="/foundry">Open Foundry board</Link>
        </p>
      )}
    </main>
  );
}

function MessageBubble({
  message: m,
  onFollowUp,
  onFork,
  onBank,
  disabled,
}: {
  message: FoundryMessage;
  onFollowUp: (prompt: string, intent?: FoundryIntent) => void;
  onFork: (label: string) => void;
  onBank: (headline: string, angle?: string) => void;
  disabled: boolean;
}) {
  const angles = m.role === 'assistant' ? parseAngles(m.content) : [];

  return (
    <div className={`foundry-message foundry-message-${m.role}`}>
      <div className="foundry-message-role">
        {m.role}{m.intent ? ` · ${m.intent}` : ''}
      </div>
      {m.tool_steps?.length ? (
        <ul className="foundry-tool-steps">
          {m.tool_steps.map((t, i) => (
            <li key={i}>{t.label}{t.detail ? ` · ${t.detail}` : ''}</li>
          ))}
        </ul>
      ) : null}
      <div className="foundry-message-body">{m.content}</div>

      {m.score && (
        <div className="foundry-score-card">
          <div className="foundry-meta">Hypothesis score · rank {m.score.rank_value?.toFixed(1) ?? '—'}</div>
          <div className="foundry-score-bars">
            {(['surprise', 'checkability', 'mechanism', 'visual', 'timing'] as const).map((k) => (
              <div key={k} className="foundry-score-row">
                <span>{k.slice(0, 5)}</span>
                <div className="foundry-score-bar">
                  <div style={{ width: `${(m.score![k] / 5) * 100}%` }} />
                </div>
                <span>{m.score![k]}</span>
              </div>
            ))}
          </div>
          {m.verdict && <div className="foundry-verdict">{m.verdict.replace('_', ' ')}</div>}
        </div>
      )}

      {m.follow_ups?.length ? (
        <div className="foundry-follow-ups">
          {m.follow_ups.map((f) => (
            <button key={f.id} type="button" className="foundry-chip" disabled={disabled}
              onClick={() => onFollowUp(f.prompt, f.intent as FoundryIntent | undefined)}>
              {f.prompt}
            </button>
          ))}
        </div>
      ) : null}

      {m.branches?.length ? (
        <div className="foundry-branches">
          {m.branches.map((b) => (
            b.fork_session_id ? (
              <Link key={b.id} href={`/foundry/work/${b.fork_session_id}`} className="foundry-chip">
                {b.label} →
              </Link>
            ) : (
              <button key={b.id} type="button" className="foundry-chip" disabled={disabled}
                onClick={() => onFork(b.label)}>
                Fork: {b.label}
              </button>
            )
          ))}
        </div>
      ) : null}

      {angles.length > 0 && (
        <div className="foundry-angles">
          {angles.map((a) => (
            <div key={a.index} className="foundry-angle-row">
              <span>{a.headline}</span>
              <button type="button" className="btn-accent" style={{ fontSize: '.68rem' }}
                disabled={disabled} onClick={() => onBank(a.headline.slice(0, 120), a.headline)}>
                Bank
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [topicState, setTopicState] = useState(
    suggested.topics.map((t) => ({ ...t, checked: true, cadence: 'regular' as Cadence })),
  );
  const [feedState, setFeedState] = useState(
    suggested.feeds.map((f) => ({ ...f, checked: Boolean(f.url), cadence: 'regular' as Cadence })),
  );
  const [extraFeed, setExtraFeed] = useState('');

  return (
    <div className="studio-overlay">
      <div className="studio-modal">
        <h3 className="section-head">Monitor sources?</h3>
        {topicState.map((t, i) => (
          <label key={i} className="studio-check-row">
            <input type="checkbox" checked={t.checked}
              onChange={(e) => setTopicState((s) => s.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
            <span>{t.label}</span>
          </label>
        ))}
        {feedState.map((f, i) => (
          <label key={i} className="studio-check-row">
            <input type="checkbox" checked={f.checked}
              onChange={(e) => setFeedState((s) => s.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
            <span>{f.name || f.url}</span>
          </label>
        ))}
        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
          <input value={extraFeed} onChange={(e) => setExtraFeed(e.target.value)} placeholder="Add RSS URL"
            className="foundry-input" style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={() => {
            if (!extraFeed.trim()) return;
            setFeedState((s) => [...s, { url: extraFeed.trim(), name: extraFeed.trim(), checked: true, cadence: 'regular' }]);
            setExtraFeed('');
          }}>Add</button>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.2rem' }}>
          <button type="button" className="btn-accent" onClick={() => onSave({
            topics: topicState.filter((t) => t.checked).map(({ label, keywords, cadence }) => ({ label, keywords, cadence })),
            feeds: feedState.filter((f) => f.checked).map(({ url, name, cadence }) => ({ url, name, cadence })),
            dataSources: [],
          })}>
            Enable monitoring
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Skip</button>
        </div>
      </div>
    </div>
  );
}
