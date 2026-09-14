'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  parseAngles,
  parseMonitoring,
  normalizeMessages,
  SessionInput,
  type FoundryIntent,
  type FoundryMessage,
  type FoundryToolStep,
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

const INTENTS: { value: FoundryIntent; label: string; blurb: string }[] = [
  { value: 'investigate', label: 'investigate', blurb: 'Check a claim and reach a verdict' },
  { value: 'brainstorm', label: 'brainstorm', blurb: 'Generate angles worth chasing' },
  { value: 'refine', label: 'refine', blurb: 'Sharpen the thread so far' },
  { value: 'precedents', label: 'precedents', blurb: 'Find comparable cases elsewhere' },
];

const PHASES: { id: string; label: string }[] = [
  { id: 'context', label: 'Load session context' },
  { id: 'research', label: 'Research with the data store and the web' },
  { id: 'score', label: 'Score the angle against the charter' },
  { id: 'save', label: 'Save the turn to the session' },
];

type PhaseStatus = 'pending' | 'running' | 'done';

type Command = {
  name: string;
  arg?: string;
  blurb: string;
};

const COMMANDS: Command[] = [
  { name: '/investigate', arg: '[claim]', blurb: 'Run an investigate turn' },
  { name: '/brainstorm', arg: '[topic]', blurb: 'Run a brainstorm turn' },
  { name: '/refine', arg: '[note]', blurb: 'Run a refine turn on the thread' },
  { name: '/precedents', arg: '[topic]', blurb: 'Research cross-market precedents' },
  { name: '/context', blurb: 'Show or hide session context, links and files' },
  { name: '/bank', arg: '[headline]', blurb: 'Send the last turn to Foundry → Awaiting ranking' },
  { name: '/track', blurb: 'Track this session in the news watch' },
  { name: '/monitor', blurb: 'Set up monitoring for suggested sources' },
  { name: '/fork', arg: '[label]', blurb: 'Branch the session from the last turn' },
  { name: '/archive', blurb: 'Archive this session' },
  { name: '/help', blurb: 'List the commands' },
];

const SPINNER = ['·', '✳', '✶', '✳'];

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  return `${mins}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTokens(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export type ForkRow = {
  session_id: string;
  title: string | null;
  fork_from_message_id?: string | null;
  fork_branch_label?: string | null;
};

/**
 * Which branch chips already have a fork behind them, keyed by message and
 * label. Read from the child sessions so the parent transcript is never
 * rewritten to hold the link. Sessions forked before that change kept the id
 * inside the message, so those are still honoured when rendering.
 */
function forkIndex(forks: ForkRow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of forks) {
    if (!f.fork_from_message_id || !f.fork_branch_label) continue;
    index.set(`${f.fork_from_message_id}\u0000${f.fork_branch_label}`, f.session_id);
  }
  return index;
}

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
  forks: ForkRow[];
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
  const forkedBranches = useMemo(() => forkIndex(forks), [forks]);
  const [composer, setComposer] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [showContext, setShowContext] = useState(
    () => !normalizeMessages(session.messages).length,
  );
  const [running, setRunning] = useState(false);
  const [runIntent, setRunIntent] = useState<FoundryIntent>('investigate');
  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState<FoundryToolStep[]>([]);
  const [phases, setPhases] = useState<Record<string, PhaseStatus>>({});
  const [liveUsage, setLiveUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMonitor, setShowMonitor] = useState(false);
  const [linkedPitch, setLinkedPitch] = useState<string | null>(
    (session.linked_pitch as string | null) ?? null,
  );
  const [pending, start] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);

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

  const slashQuery = composer.startsWith('/') && !composer.includes('\n')
    ? composer.split(/\s/)[0]
    : null;
  const slashMatches = useMemo(() => {
    if (slashQuery == null) return [];
    if (composer.includes(' ')) return [];
    return COMMANDS.filter((c) => c.name.startsWith(slashQuery));
  }, [slashQuery, composer]);

  function uid() {
    return crypto.randomUUID();
  }

  function note(text: string) {
    setNotes((prev) => [...prev, text]);
  }

  const saveDraft = useCallback(() => {
    start(async () => {
      await saveFoundrySession(sessionId, { title, prompt, inputs, intent });
    });
  }, [sessionId, title, prompt, inputs, intent, start]);

  /* ---------- run loop ---------- */

  const runTurn = useCallback(async (overridePrompt?: string, overrideIntent?: FoundryIntent) => {
    const activeIntent = overrideIntent ?? intent;
    const outbound = (overridePrompt ?? composer).trim();
    if (!outbound && !prompt.trim() && !inputs.length) {
      setError('Add a prompt, a link, or a file before running.');
      return;
    }

    setError(null);
    setNotes([]);
    setRunning(true);
    setRunIntent(activeIntent);
    setLiveText('');
    setLiveTools([]);
    setLiveUsage(null);
    setElapsed(0);
    setPhases({ context: 'running' });
    if (overrideIntent) setIntent(overrideIntent);
    setComposer('');

    const startedAt = Date.now();
    await saveFoundrySession(sessionId, { title, prompt, inputs, intent: activeIntent });

    abortRef.current = new AbortController();
    try {
      const res = await fetch(`/api/foundry/${sessionId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: outbound || undefined, intent: activeIntent }),
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
      let steps: FoundryToolStep[] = [];
      let followUps: FoundryMessage['follow_ups'];
      let score: FoundryMessage['score'];
      let verdict: FoundryMessage['verdict'];
      let branches: FoundryMessage['branches'];
      let usage: FoundryMessage['usage'];
      let messageId: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          let event = 'message';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          const parsed = JSON.parse(data);

          if (event === 'phase') {
            setPhases((prev) => ({ ...prev, [parsed.id]: parsed.status }));
          } else if (event === 'tool_start') {
            steps = [...steps, {
              id: parsed.id,
              name: parsed.name,
              label: parsed.label,
              detail: parsed.detail,
              at: parsed.at,
              status: 'running',
            }];
            setLiveTools(steps);
          } else if (event === 'tool_result') {
            const matches = (s: FoundryToolStep) => (
              parsed.id ? s.id === parsed.id : s.name === parsed.name && s.status === 'running'
            );
            steps = steps.map((s) => (
              matches(s) ? { ...s, status: 'done' as const, result: parsed.detail, ms: parsed.ms } : s
            ));
            setLiveTools(steps);
          } else if (event === 'usage') {
            usage = {
              input_tokens: parsed.input_tokens,
              output_tokens: parsed.output_tokens,
              cache_read_tokens: parsed.cache_read_tokens,
              cache_write_tokens: parsed.cache_write_tokens,
            };
            setLiveUsage(usage);
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
          } else if (event === 'source_suggestions') {
            const items = (parsed.items ?? []) as { summary: string }[];
            if (items.length) {
              note(`${items.length} source suggestion${items.length > 1 ? 's' : ''} queued: ${items.map((i) => i.summary).join('; ').slice(0, 160)}`);
            }
          } else if (event === 'done') {
            messageId = parsed.messageId;
          } else if (event === 'error') {
            throw new Error(parsed.message);
          }
        }
      }

      const userContent = outbound || prompt;
      if (userContent.trim()) {
        setMessages((prev) => {
          const next = [...prev];
          const alreadyOpened = prev.some((m) => m.role === 'user');
          if (outbound || !alreadyOpened) {
            next.push({
              id: uid(),
              role: 'user',
              content: userContent,
              at: new Date().toISOString(),
              intent: activeIntent,
            });
          }
          next.push({
            id: messageId ?? uid(),
            role: 'assistant',
            content: accumulated,
            at: new Date().toISOString(),
            tool_steps: steps.length ? steps : undefined,
            follow_ups: followUps,
            score,
            verdict,
            branches,
            usage,
          });
          return next;
        });
      }
      note(`Done in ${formatDuration(Date.now() - startedAt)}`);
      router.refresh();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        note('Interrupted. Nothing was saved for this turn.');
        setComposer(outbound);
      } else if (e instanceof Error) {
        setError(e.message);
        setComposer(outbound);
      }
    } finally {
      setRunning(false);
      setLiveText('');
      setLiveTools([]);
      setPhases({});
      abortRef.current = null;
    }
  }, [composer, inputs, intent, prompt, router, sessionId, title]);

  function interrupt() {
    abortRef.current?.abort();
  }

  /* ---------- live status timers ---------- */

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - started);
      setTick((t) => t + 1);
    }, 400);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        interrupt();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running]);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end', behavior: running ? 'auto' : 'smooth' });
  }, [messages.length, liveText, liveTools.length, running]);

  /* ---------- session actions ---------- */

  function addLink(url: string) {
    const clean = url.trim();
    if (!clean) return;
    setLinkUrl('');
    start(async () => {
      setError(null);
      const fetched = await fetchLinkContent(clean);
      if (!fetched.ok) {
        setError(fetched.error);
        return;
      }
      const next: SessionInput[] = [...inputs, {
        id: uid(),
        type: 'link' as const,
        url: clean,
        label: fetched.title,
        content: fetched.text,
      }];
      setInputs(next);
      note(`Added link · ${fetched.title}`);
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
      note(`Added file · ${file.name}`);
      start(async () => {
        await saveFoundrySession(sessionId, { title, prompt, inputs: next, intent });
      });
    };
    reader.readAsText(file);
  }

  function fork(messageId?: string, label?: string) {
    start(async () => {
      const res = await fetch(`/api/foundry/${sessionId}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId, label, title: label ? `${label.slice(0, 60)} (fork)` : undefined }),
      });
      const data = await res.json();
      if (!data.newSessionId) {
        setError(data.error ?? 'Fork failed');
        return;
      }
      note(`Forked into a new session with ${plural(data.copiedMessages ?? 0, 'turn')} copied. This session is unchanged.`);
      router.push(`/foundry/work/${data.newSessionId}`);
    });
  }

  function bank(headline: string, messageId?: string, angleHeadline?: string) {
    start(async () => {
      const r = await bankFoundrySession(sessionId, headline, messageId, angleHeadline);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLinkedPitch(r.pitchId);
      note('Banked as a candidate pitch. Open Foundry → Awaiting ranking to find it.');
      router.refresh();
    });
  }

  function track() {
    start(async () => {
      const r = await trackSession(sessionId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      note(r.already ? 'Already tracked.' : 'Added to sessions and the news watch.');
    });
  }

  function archive() {
    start(async () => {
      await archiveFoundrySession(sessionId);
      router.push('/foundry/work');
    });
  }

  /* ---------- composer ---------- */

  function runCommand(raw: string): boolean {
    const [head, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const known = COMMANDS.find((c) => c.name === head);
    if (!known) {
      setError(`Unknown command ${head}. Type /help for the list.`);
      return true;
    }
    setComposer('');
    setError(null);

    switch (head) {
      case '/investigate':
      case '/brainstorm':
      case '/refine':
      case '/precedents':
        void runTurn(arg || undefined, head.slice(1) as FoundryIntent);
        return true;
      case '/context':
        setShowContext((v) => !v);
        return true;
      case '/bank':
        bank((arg || title).slice(0, 120), lastAssistant?.id);
        return true;
      case '/track':
        track();
        return true;
      case '/monitor':
        setShowMonitor(true);
        return true;
      case '/fork':
        fork(lastAssistant?.id, arg || undefined);
        return true;
      case '/archive':
        archive();
        return true;
      case '/help':
        setNotes([
          'Commands',
          ...COMMANDS.map((c) => `${c.name}${c.arg ? ` ${c.arg}` : ''} — ${c.blurb}`),
        ]);
        return true;
      default:
        return false;
    }
  }

  function submit() {
    const raw = composer.trim();
    if (!raw) {
      if (!running) void runTurn();
      return;
    }
    if (raw.startsWith('/')) {
      runCommand(raw);
      return;
    }
    void runTurn(raw);
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab' && slashMatches.length) {
      e.preventDefault();
      setComposer(`${slashMatches[0].name} `);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (running) return;
      if (slashMatches.length === 1 && slashMatches[0].name !== composer.trim()) {
        setComposer(`${slashMatches[0].name} `);
        return;
      }
      submit();
    }
  }

  const activeMonitors = monitors.filter((m) => m.active);
  const turnCount = messages.filter((m) => m.role === 'assistant').length;
  const spinner = SPINNER[tick % SPINNER.length];
  const toolsRun = liveTools.length;

  return (
    <main className="cc-session">
      <header className="cc-header">
        <div className="cc-header-line">
          <span className="cc-prefix">foundry</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveDraft}
            aria-label="Session title"
            className="cc-title"
          />
        </div>
        <div className="cc-header-meta">
          <span>session {sessionId.slice(0, 8)}</span>
          <span>·</span>
          <select
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value as FoundryIntent);
              saveDraft();
            }}
            aria-label="Default intent"
            className="cc-intent"
          >
            {INTENTS.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <span>·</span>
          <span>{plural(turnCount, 'turn')}</span>
          {activeMonitors.length > 0 && (
            <>
              <span>·</span>
              <span>{plural(activeMonitors.length, 'monitor')}</span>
            </>
          )}
          <span className="cc-header-spacer" />
          <button type="button" className="cc-link" onClick={() => setShowContext((v) => !v)}>
            {showContext ? 'hide context' : `context${inputs.length ? ` (${inputs.length})` : ''}`}
          </button>
          {lastAssistant && !linkedPitch && (
            <button type="button" className="cc-link" disabled={running || pending}
              title="Create a candidate pitch on Foundry → Awaiting ranking"
              onClick={() => bank(title.slice(0, 120), lastAssistant.id)}>
              bank as pitch
            </button>
          )}
          <button type="button" className="cc-link" onClick={saveDraft} disabled={pending}
            title="Keep this session on Work. Does not create a pitch.">
            save
          </button>
          <button type="button" className="cc-link" onClick={archive} disabled={pending}>archive</button>
        </div>
        {(parentSession || forks.length > 0) && (
          <div className="cc-header-meta">
            {parentSession && (
              <Link className="cc-link" href={`/foundry/work/${parentSession.session_id}`}>
                ↳ forked from {parentSession.title ?? 'parent'}
              </Link>
            )}
            {forks.map((f) => (
              <Link key={f.session_id} className="cc-link" href={`/foundry/work/${f.session_id}`}>
                ↳ branch: {f.title ?? f.session_id.slice(0, 8)}
              </Link>
            ))}
          </div>
        )}
      </header>

      {showContext && (
        <section className="cc-context">
          <div className="cc-context-head">context</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={saveDraft}
            rows={3}
            placeholder="The standing question or topic for this session. Every turn is run against it."
            className="cc-textarea"
          />
          <div className="cc-context-row">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(linkUrl); } }}
              placeholder="Paste a link to read into context"
              className="cc-input"
            />
            <button type="button" className="cc-link" onClick={() => addLink(linkUrl)}
              disabled={pending || !linkUrl.trim()}>
              fetch
            </button>
            <label className="cc-link" style={{ cursor: 'pointer' }}>
              upload
              <input type="file" accept=".txt,.md,.csv,.json,.html" style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {inputs.map((input) => (
            <div key={input.id} className="cc-context-item">
              <span>
                {input.type === 'link' ? '🔗' : '📄'}{' '}
                {input.type === 'link' ? (input.label ?? input.url) : input.fileName}
              </span>
              <button type="button" className="cc-link" onClick={() => {
                const next = inputs.filter((i) => i.id !== input.id);
                setInputs(next);
                start(async () => { await saveFoundrySession(sessionId, { title, prompt, inputs: next, intent }); });
              }}>remove</button>
            </div>
          ))}
        </section>
      )}

      <section className="cc-transcript">
        {parentSession && (
          <div className="cc-fork-note">
            <span>
              Forked from <b>{parentSession.title ?? 'the parent session'}</b>
              {session.fork_branch_label ? ' to follow one branch' : ''}. The whole transcript
              was copied and the original is unchanged.
            </span>
            <Link className="cc-link" href={`/foundry/work/${parentSession.session_id}`}>
              open the original →
            </Link>
          </div>
        )}

        {messages.length === 0 && !running && (
          <div className="cc-welcome">
            <p>
              This is a working session. Ask a question and the agent researches it against the
              Caveat data store and tier 1 and 2 sources, then scores the angle against the
              editorial charter.
            </p>
            <p className="cc-dim">
              Type a message and press Enter. Type <span className="cc-kbd">/</span> for commands.
              Save keeps the session. Bank puts it on Foundry → Awaiting ranking.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <Turn
            key={m.id}
            message={m}
            onFollowUp={(p, i) => runTurn(p, i ?? 'refine')}
            onFork={(label) => fork(m.id, label)}
            onBank={(h, angle) => bank(h, m.id, angle)}
            forkedBranches={forkedBranches}
            disabled={running || pending}
          />
        ))}

        {running && (
          <div className="cc-turn cc-turn-agent">
            <Plan phases={phases} />
            <ToolStream steps={liveTools} elapsed={elapsed} />
            {liveText && <AgentText text={liveText} />}
          </div>
        )}

        {notes.length > 0 && (
          <div className="cc-notes">
            {notes.map((n, i) => <div key={i}>{n}</div>)}
          </div>
        )}

        {error && <div className="cc-error">✗ {error}</div>}
        <div ref={tailRef} />
      </section>

      <section className="cc-composer">
        {running ? (
          <div className="cc-status">
            <span className="cc-status-glyph">{spinner}</span>
            <span>{runIntent === 'precedents' ? 'Researching precedents' : `Running ${runIntent}`}…</span>
            <span className="cc-dim">
              {formatDuration(elapsed)}
              {toolsRun ? ` · ${toolsRun} tool${toolsRun > 1 ? 's' : ''}` : ''}
              {liveUsage ? ` · ${formatTokens(liveUsage.input_tokens + liveUsage.output_tokens)} tokens` : ''}
            </span>
            <button type="button" className="cc-link" onClick={interrupt}>esc to interrupt</button>
          </div>
        ) : (
          <>
            {lastAssistant && !linkedPitch && (
              <p className="cc-dim" style={{ margin: '0 0 0.6rem', fontSize: '.72rem' }}>
                This session is a draft. Save keeps it on Work.
                Bank as pitch sends the last turn to Foundry → Awaiting ranking.
              </p>
            )}
            {slashMatches.length > 0 && (
              <div className="cc-palette">
                {slashMatches.map((c) => (
                  <button key={c.name} type="button" className="cc-palette-row"
                    onClick={() => {
                      setComposer(`${c.name} `);
                      composerRef.current?.focus();
                    }}>
                    <span className="cc-palette-name">{c.name}{c.arg ? ` ${c.arg}` : ''}</span>
                    <span className="cc-dim">{c.blurb}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="cc-prompt">
              <span className="cc-caret">&gt;</span>
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={onComposerKey}
                rows={Math.min(8, Math.max(1, composer.split('\n').length))}
                placeholder={messages.length ? 'Reply, or / for commands' : 'Ask the desk a question, or / for commands'}
                aria-label="Message"
                className="cc-prompt-input"
              />
            </div>
            <div className="cc-hints">
              <span><span className="cc-kbd">enter</span> send</span>
              <span><span className="cc-kbd">shift</span> + <span className="cc-kbd">enter</span> newline</span>
              <span><span className="cc-kbd">/</span> commands</span>
              <span className="cc-header-spacer" />
              <span className="cc-dim">{INTENTS.find((i) => i.value === intent)?.blurb}</span>
            </div>
          </>
        )}
      </section>

      {showMonitor && (
        <MonitoringModal
          suggested={suggested as { topics: { label: string; keywords: string[] }[]; feeds: { url: string; name: string }[]; dataSources: string[] }}
          dataSources={dataSources}
          onClose={() => setShowMonitor(false)}
          onSave={(selection) => start(async () => {
            await setupMonitoring(sessionId, selection);
            setShowMonitor(false);
            note('Monitoring enabled.');
          })}
        />
      )}

      {Boolean(linkedPitch) && (
        <p className="cc-dim" style={{ marginTop: '1rem', fontSize: '.72rem' }}>
          Banked as a candidate pitch ·{' '}
          <Link className="cc-link" href="/foundry?tab=candidate">open Awaiting ranking</Link>
        </p>
      )}
    </main>
  );
}

/* ---------- run plan ---------- */

function Plan({ phases }: { phases: Record<string, PhaseStatus> }) {
  return (
    <div className="cc-plan">
      {PHASES.map((p) => {
        const status = phases[p.id] ?? 'pending';
        return (
          <div key={p.id} className={`cc-plan-row cc-plan-${status}`}>
            <span className="cc-plan-box">
              {status === 'done' ? '✓' : status === 'running' ? '▸' : '·'}
            </span>
            <span>{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- tool lines ---------- */

function ToolStream({ steps, elapsed }: { steps: FoundryToolStep[]; elapsed?: number }) {
  if (!steps.length) {
    return <div className="cc-tool cc-tool-waiting">● Thinking…</div>;
  }
  return (
    <div className="cc-tools">
      {steps.map((s, i) => {
        const isRunning = s.status === 'running';
        // Turns recorded before results were tracked carry no result line.
        const showResult = isRunning || Boolean(s.result);
        return (
          <div key={s.id ?? i} className={`cc-tool cc-tool-${s.status ?? 'done'}`}>
            <div className="cc-tool-head">
              <span className="cc-tool-dot">{isRunning ? '◐' : '●'}</span>
              <span className="cc-tool-label">{s.label}</span>
              <span className="cc-tool-name">{s.name}</span>
            </div>
            {showResult && (
              <div className="cc-tool-result">
                <span className="cc-tool-elbow">⎿</span>
                {isRunning
                  ? <span className="cc-dim">running{elapsed ? ` · ${formatDuration(elapsed)}` : ''}</span>
                  : (
                    <span>
                      {s.result}
                      {s.ms ? <span className="cc-dim"> · {formatDuration(s.ms)}</span> : null}
                    </span>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- agent prose ---------- */

/** Render the charter-shaped markdown the agent returns: headings, bullets, bold. */
function AgentText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="cc-prose">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="cc-prose-gap" />;
        const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
        if (heading) {
          return <div key={i} className="cc-prose-head">{inline(heading[1])}</div>;
        }
        const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <div key={i} className="cc-prose-bullet">
              <span className="cc-prose-marker">·</span>
              <span>{inline(bullet[1])}</span>
            </div>
          );
        }
        const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (numbered) {
          return (
            <div key={i} className="cc-prose-bullet">
              <span className="cc-prose-marker">{numbered[1]}.</span>
              <span>{inline(numbered[2])}</span>
            </div>
          );
        }
        return <div key={i} className="cc-prose-line">{inline(trimmed)}</div>;
      })}
    </div>
  );
}

/** Split a line on **bold** and `code` runs. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="cc-code">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

/* ---------- one exchange ---------- */

function Turn({
  message: m,
  onFollowUp,
  onFork,
  onBank,
  forkedBranches,
  disabled,
}: {
  message: FoundryMessage;
  onFollowUp: (prompt: string, intent?: FoundryIntent) => void;
  onFork: (label: string) => void;
  onBank: (headline: string, angle?: string) => void;
  forkedBranches: Map<string, string>;
  disabled: boolean;
}) {
  if (m.role === 'user') {
    return (
      <div className="cc-turn cc-turn-user">
        <span className="cc-caret">&gt;</span>
        <div>
          <div className="cc-user-text">{m.content}</div>
          {m.intent && <div className="cc-dim cc-turn-tag">{m.intent}</div>}
        </div>
      </div>
    );
  }

  const angles = parseAngles(m.content);
  const totalTokens = m.usage ? m.usage.input_tokens + m.usage.output_tokens : 0;
  // Anthropic reports cached reads outside input_tokens, so they are shown as their own figure.
  const cachedTokens = m.usage?.cache_read_tokens ?? 0;

  return (
    <div className="cc-turn cc-turn-agent">
      {m.tool_steps?.length ? <ToolStream steps={m.tool_steps} /> : null}
      <AgentText text={m.content} />

      {m.score && (
        <div className="cc-score">
          <div className="cc-score-head">
            score {m.score.rank_value?.toFixed(1) ?? '—'} / 5
            {m.verdict && <span className={`cc-verdict cc-verdict-${m.verdict}`}>{m.verdict.replace('_', ' ')}</span>}
          </div>
          <div className="cc-score-grid">
            {(['surprise', 'checkability', 'mechanism', 'visual', 'timing'] as const).map((k) => (
              <div key={k} className="cc-score-row">
                <span>{k}</span>
                <span className="cc-score-bar">
                  <span style={{ width: `${(m.score![k] / 5) * 100}%` }} />
                </span>
                <span>{m.score![k]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {angles.length > 0 && (
        <div className="cc-angles">
          {angles.map((a) => (
            <div key={a.index} className="cc-angle">
              <span>{a.headline}</span>
              <button type="button" className="cc-link" disabled={disabled}
                title="Send this angle to Foundry → Awaiting ranking"
                onClick={() => onBank(a.headline.slice(0, 120), a.headline)}>
                bank as pitch
              </button>
            </div>
          ))}
        </div>
      )}

      {m.follow_ups?.length ? (
        <div className="cc-next">
          <div className="cc-next-head">next steps</div>
          {m.follow_ups.map((f) => (
            <button key={f.id} type="button" className="cc-next-row" disabled={disabled}
              onClick={() => onFollowUp(f.prompt, f.intent as FoundryIntent | undefined)}>
              <span className="cc-next-arrow">↳</span>
              <span>{f.prompt}</span>
              {f.intent && <span className="cc-dim">{f.intent}</span>}
            </button>
          ))}
        </div>
      ) : null}

      {m.branches?.length ? (
        <div className="cc-branches">
          {m.branches.map((b) => {
            const forkId = forkedBranches.get(`${m.id}\u0000${b.label}`) ?? b.fork_session_id;
            return forkId ? (
              <Link key={b.id} href={`/foundry/work/${forkId}`} className="cc-branch">
                branch: {b.label} →
              </Link>
            ) : (
              <button key={b.id} type="button" className="cc-branch" disabled={disabled}
                title="Copies this whole session into a new one. This session is left as it is."
                onClick={() => onFork(b.label)}>
                fork into new session: {b.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {totalTokens > 0 && (
        <div className="cc-turn-foot">
          {formatTokens(totalTokens)} tokens
          {cachedTokens > 0 && <> · {formatTokens(cachedTokens)} from cache</>}
        </div>
      )}
    </div>
  );
}

/* ---------- monitoring ---------- */

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
        {topicState.length === 0 && feedState.length === 0 && (
          <p className="cc-dim" style={{ fontSize: '.8rem', margin: '.6rem 0' }}>
            No sources suggested yet. Run a turn first, or add a feed by hand.
          </p>
        )}
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
            className="cc-input" style={{ flex: 1 }} />
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
