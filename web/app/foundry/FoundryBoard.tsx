'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { act, addToInbox, curate } from './actions';
import { describeDerivation } from './derivation';
import { trendInvestigatePrompts } from '@/lib/trend-prompts';
import SourceSuggestionsPanel, { type SourceSuggestion } from './SourceSuggestionsPanel';
import ApproveAndWrite from '@/components/ApproveAndWrite';
import StoryPublishControls, { type StoryLink } from '@/components/StoryPublishControls';
import ReelControls from '@/components/ReelControls';
import StartSessionForm from '@/components/StartSessionForm';
interface Pitch {
  id: string; headline: string; hook: string | null; mechanism: string | null;
  caveat: string | null; chart_hint: string | null; detector: string;
  trigger_rows: any; metric_ids: string[] | null; score: any; rank_value: number | null;
  state: string; resurface_on: string | null; resurface_after: string | null;
  resurface_metrics: string[] | null; times_pitched: number; first_seen: string;
  last_evaluated: string | null; state_changed: string | null; updated_at?: string | null;
}
interface PitchEvent {
  event_id: string; pitch_id: string; at: string; actor: string; event: string;
  from_state: string | null; to_state: string | null; changes: any; note: string | null;
}
interface Metric {
  metric_id: string; name: string; unit: string; basis: string;
  source_org: string; source_tier: number; source_url: string | null;
  source_published: string | null; period: string | null;
}

const ORDER = ['pitched', 'candidate', 'approved', 'watchlist', 'dormant', 'rejected', 'published'];
const LABEL: Record<string, string> = {
  pitched: 'Today\u2019s pitches', candidate: 'Awaiting ranking', approved: 'Approved',
  watchlist: 'Watchlist', dormant: 'Dormant', rejected: 'Rejected', published: 'Published',
};

export default function FoundryBoard({ pitches, runs, inbox, feedback, events, metrics, news, trends, sourceSuggestions, storyByPitch = {}, reelStatusBySlug = {}, initialTab = 'pitched' }:
  { pitches: Pitch[]; runs: any[]; inbox: any[]; feedback: any[];
    events: PitchEvent[]; metrics: Metric[]; news: any[]; trends: any[];
    sourceSuggestions: SourceSuggestion[]; storyByPitch?: Record<string, StoryLink>;
    reelStatusBySlug?: Record<string, { status: string; stage: string }>; initialTab?: string }) {
  const metricById = new Map(metrics.map((m) => [m.metric_id, m]));
  const eventsFor = (id: string) => events.filter((e) => e.pitch_id === id);
  const [tab, setTab] = useState(ORDER.includes(initialTab) ? initialTab : 'pitched');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [showInbox, setShowInbox] = useState(false);
  const router = useRouter();

  const byState = (s: string) => pitches.filter((p) => p.state === s);
  const shown = byState(tab);
  const candidateCount = byState('candidate').length;

  function selectTab(next: string) {
    setTab(next);
    router.replace(next === 'pitched' ? '/foundry' : `/foundry?tab=${next}`, { scroll: false });
  }

  const run = (id: string, action: any) =>
    start(() => { act(id, action, note[id] || undefined).then(() => setNote((n) => ({ ...n, [id]: '' }))); });

  return (
    <>
      <main style={{ paddingBottom: 'var(--spacing-84)' }}>
        <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>Foundry</h1>
        {showInbox && <InboxForm onDone={() => setShowInbox(false)} />}
        <p style={{ marginBottom: 'var(--spacing-21)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href="/foundry/desk" className="studio-link">Desk</Link>
          <button type="button" className="studio-link" onClick={() => setShowInbox((v) => !v)}>+ Inbox</button>
          <RefreshDataButton onDone={() => router.refresh()} />
          <ReviewTrendingButton onDone={() => router.refresh()} />
        </p>

        <div style={{ display: 'flex', gap: 'var(--spacing-10)', flexWrap: 'wrap', marginBottom: 'var(--spacing-42)' }}>
          {ORDER.map((s) => (
            <button key={s} onClick={() => selectTab(s)} style={tabBtn(s === tab)}>
              {LABEL[s]} <span style={{ opacity: .6 }}>{byState(s).length}</span>
            </button>
          ))}
        </div>

        {tab === 'pitched' && candidateCount > 0 && (
          <p style={notice}>
            {candidateCount} pitch{candidateCount === 1 ? '' : 'es'} waiting to be ranked.
            Work you bank from a session lands under Awaiting ranking, not on this list.
            {' '}
            <button type="button" className="studio-link" onClick={() => selectTab('candidate')}>
              Open Awaiting ranking
            </button>
          </p>
        )}

        {shown.length === 0 && (
          <p style={{ color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '.82rem', padding: '2rem 0' }}>
            {tab === 'pitched' && candidateCount > 0
              ? 'Nothing ranked for today. Banked sessions are under Awaiting ranking until they are scored onto this list.'
              : tab === 'pitched'
                ? 'Nothing here. A quiet day is honest output.'
                : tab === 'candidate'
                  ? 'Nothing awaiting ranking. Bank a Foundry session to put it here.'
                  : 'Nothing here.'}
          </p>
        )}

        {shown.map((p) => {
          const isOpen = open === p.id;
          const latestFinding = findingsOf(p).at(-1);
          const trendPrompts = p.detector === 'trend_hypothesis'
            ? trendInvestigatePrompts(p.headline, p.trigger_rows ?? {})
            : null;
          return (
            <article key={p.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '18rem' }}>
                  <div style={meta}>
                    {fmtDate(p.first_seen)}
                    {p.updated_at && p.updated_at !== p.first_seen &&
                      ` · updated ${fmtDate(p.updated_at)}`}
                    {p.times_pitched > 1 && ` · pitched ${p.times_pitched}\u00d7`}
                    {p.rank_value != null && ` · rank ${p.rank_value}`}
                  </div>
                  <h2 style={{ fontSize: 'var(--text-subheading)', lineHeight: 'var(--leading-subheading)', marginBottom: 'var(--spacing-10)' }}>{p.headline}</h2>
                  {p.hook && <p style={{ color: 'var(--ink-soft)', fontSize: '.92rem' }}>{p.hook}</p>}
                  <p style={{ ...meta, textTransform: 'none', letterSpacing: 0,
                    fontSize: '.74rem', marginTop: '.55rem', paddingLeft: '.6rem',
                    borderLeft: '2px solid var(--rule)', color: 'var(--ink-soft)' }}>
                    {describeDerivation(p.detector, p.trigger_rows)}
                  </p>
                  {latestFinding?.topic && (
                    <p style={{ ...meta, textTransform: 'none', letterSpacing: 0,
                      fontSize: '.72rem', marginTop: '.4rem', color: 'var(--ink-faint)' }}>
                      Latest trend · {latestFinding.verdict ?? 'finding'} · {latestFinding.topic}
                    </p>
                  )}
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
                  {findingsOf(p).length ? (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={meta}>Trending findings</div>
                      <ul style={{ listStyle: 'none', marginTop: '.4rem' }}>
                        {findingsOf(p).slice().reverse().slice(0, 6).map((f) => (
                          <li key={f.key ?? `${f.period_end}-${f.topic}`}
                            style={{ marginBottom: '.7rem', fontSize: '.88rem' }}>
                            <div style={{ ...meta, textTransform: 'none', letterSpacing: 0, marginBottom: '.2rem' }}>
                              {f.period_end} · {f.source}/{f.region} · {f.verdict} · {f.topic}
                            </div>
                            <div style={{ color: 'var(--ink-soft)' }}>{f.finding}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {p.resurface_on && <Field label="Resurfaces" value={
                    `${p.resurface_on}${p.resurface_after ? ` (after ${p.resurface_after})` : ''}`} />}
                  {p.metric_ids?.length ? <Field label="Metrics" value={p.metric_ids.join(', ')} /> : null}
                  {p.metric_ids?.length ? (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={meta}>Sources — investigate the pitch</div>
                      <table className="data" style={{ marginTop: '.4rem' }}>
                        <thead>
                          <tr><th>Series</th><th>Publisher</th><th>Tier</th><th>Period</th></tr>
                        </thead>
                        <tbody>
                          {p.metric_ids.map((id) => {
                            const m = metricById.get(id);
                            return (
                              <tr key={id}>
                                <td>
                                  {m?.source_url ? (
                                    <a href={m.source_url} target="_blank" rel="noreferrer"
                                      style={{ borderBottom: '1px solid var(--pen)' }}>
                                      {m?.name ?? id} ↗
                                    </a>
                                  ) : (m?.name ?? id)}
                                  {m?.basis && <div style={{ opacity: .65, fontSize: '.68rem' }}>{m.basis}</div>}
                                </td>
                                <td>{m?.source_org ?? '—'}</td>
                                <td>{m ? <span className={`tier t${m.source_tier}`}>Tier {m.source_tier}</span> : '—'}</td>
                                <td>{m?.period ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div style={{ marginTop: '1rem' }}>
                    <div style={meta}>Audit trail</div>
                    <ul style={{ listStyle: 'none', marginTop: '.4rem' }}>
                      {eventsFor(p.id).map((e) => (
                        <li key={e.event_id} style={{ ...meta, textTransform: 'none',
                          letterSpacing: 0, marginBottom: '.3rem', display: 'flex', gap: '.6rem' }}>
                          <span style={{ minWidth: '9.5rem', color: 'var(--ink-faint)' }}>
                            {fmtDateTime(e.at)}
                          </span>
                          <span style={{ minWidth: '3.4rem',
                            color: e.actor === 'editor' ? 'var(--pen)' : 'var(--ink-faint)' }}>
                            {e.actor}
                          </span>
                          <span style={{ color: 'var(--ink-soft)' }}>
                            {describeEvent(e)}
                          </span>
                        </li>
                      ))}
                      {!eventsFor(p.id).length && (
                        <li style={{ ...meta, textTransform: 'none' }}>
                          No events recorded. Run 07_audit.sql to enable the trail.
                        </li>
                      )}
                    </ul>
                  </div>

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
                {trendPrompts && (
                  <>
                    <StartSessionForm intent="investigate" prompt={trendPrompts.ask}
                      className="btn-accent" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}>
                      Ask
                    </StartSessionForm>
                    <StartSessionForm intent="brainstorm" title={trendPrompts.title} prompt={trendPrompts.brainstorm}
                      className="studio-btn-outline" style={{ fontSize: '.7rem', padding: '.4rem .75rem' }}>
                      Work
                    </StartSessionForm>
                  </>
                )}
                {p.state !== 'approved' && p.state !== 'published' && !storyByPitch[p.id] && (
                  <ApproveAndWrite
                    pitchId={p.id}
                    comment={note[p.id]}
                    onCommentUsed={() => setNote((n) => ({ ...n, [p.id]: '' }))}
                    disabled={pending}
                    style={actBtn('var(--verify)')}
                  />
                )}
                {(p.state === 'approved' || p.state === 'published' || storyByPitch[p.id]) && (
                  <StoryPublishControls
                    pitchId={p.id}
                    story={storyByPitch[p.id]}
                    onDone={() => router.refresh()}
                    buttonStyle={actBtn('var(--ink)')}
                  />
                )}
                {storyByPitch[p.id] && (
                  <ReelControls
                    slug={storyByPitch[p.id].slug}
                    reel={reelStatusBySlug[storyByPitch[p.id].slug] ?? null}
                    preview={storyByPitch[p.id].status === 'draft'}
                    buttonStyle={actBtn('var(--ink)')}
                  />
                )}
                <button style={actBtn('var(--ink-soft)')} disabled={pending}
                  onClick={() => run(p.id, 'watchlist')}>Watchlist</button>
                <StrengthenPitchButton pitchId={p.id} onDone={() => router.refresh()} />
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

        <SourceSuggestionsPanel suggestions={sourceSuggestions} />

        <section style={{ marginTop: '3rem' }}>
          <h3 className="section-head">
            Feed trends · clusters warranting investigation ({trends.length} active)
          </h3>
          {trends.map((t) => (
            <div key={t.cluster_id} style={{ padding: '.75rem 0', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <b style={{ fontSize: '.95rem' }}>{t.label}</b>
                  <div style={meta}>
                    {t.item_count} items · {t.outlet_count} outlets · spike {Number(t.spike_score).toFixed(1)}×
                    {' · '}{t.status}
                    {t.keywords?.length ? ` · ${t.keywords.slice(0, 4).join(', ')}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                  {t.linked_pitch ? (
                    <span style={{ ...meta, textTransform: 'none' }}>Hypothesis in bank</span>
                  ) : (
                    <>
                      <StartSessionForm
                        intent="investigate"
                        prompt={`What's driving coverage of "${t.label}" and does our data support the narrative?`}
                        className="btn-accent"
                        style={{ fontSize: '.68rem', padding: '.35rem .6rem' }}
                      >
                        Ask
                      </StartSessionForm>
                      <StartSessionForm
                        intent="brainstorm"
                        title={t.label.slice(0, 80)}
                        prompt={`Brainstorm Caveat angles on this feed trend: ${t.label}\nKeywords: ${(t.keywords ?? []).join(', ')}`}
                        className="studio-btn-outline"
                        style={{ fontSize: '.68rem', padding: '.35rem .6rem' }}
                      >
                        Brainstorm
                      </StartSessionForm>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!trends.length && (
            <p style={meta}>
              No active trends. The trend watcher runs after each RSS sweep and groups
              multi-outlet stories and keyword spikes into investigation hypotheses.
            </p>
          )}
        </section>

        <section style={{ marginTop: '3rem' }}>
          <h3 className="section-head">
            News · tick to feature on the public ticker ({news.filter((n) => n.curated).length} live)
          </h3>
          {news.map((n) => (
            <div key={n.item_id} style={{ display: 'flex', gap: '.7rem', alignItems: 'flex-start',
              padding: '.5rem 0', borderBottom: '1px solid var(--rule)' }}>
              <input type="checkbox" defaultChecked={n.curated} style={{ marginTop: '.3rem' }}
                onChange={(e) => start(() => { curate(n.item_id, e.target.checked); })} />
              <div style={{ flex: 1 }}>
                <Link href={`/feed/${n.item_id}`} style={{ fontSize: '.88rem' }}>{n.title}</Link>
                <div style={meta}>
                  {n.published_at ? fmtDate(n.published_at) : ''}
                  {n.matched_keywords?.length ? ` · ${n.matched_keywords.slice(0, 4).join(', ')}` : ''}
                  {n.curated && n.curated_note ? ` · "${n.curated_note}"` : ''}
                </div>
              </div>
            </div>
          ))}
          {!news.length && <p style={meta}>No news items yet. Run the RSS sweep.</p>}
        </section>

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

function describeEvent(e: PitchEvent): string {
  if (e.event === 'created') return `created as ${e.to_state}`;
  if (e.event === 'resurfaced')
    return `resurfaced to ${e.to_state}${e.note ? ` — ${e.note}` : ''}`;
  if (e.event === 'state_change') return `${e.from_state} → ${e.to_state}`;
  if (e.event === 'edited') {
    const keys = Object.keys(e.changes ?? {});
    return `edited: ${keys.join(', ')}`;
  }
  if (e.event === 'trending_finding') {
    const topic = e.changes?.topic ? ` · ${e.changes.topic}` : '';
    const verdict = e.changes?.verdict ? `${e.changes.verdict}` : 'finding';
    return `trending ${verdict}${topic}${e.note ? ` — ${e.note}` : ''}`;
  }
  return e.event;
}

function findingsOf(p: Pitch): Array<{
  key?: string;
  period_end?: string;
  source?: string;
  region?: string;
  verdict?: string;
  topic?: string;
  finding?: string;
}> {
  const raw = p.trigger_rows?.findings;
  return Array.isArray(raw) ? raw : [];
}
const fmtDate = (s?: string | null) => s
  ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
  : '';
const fmtDateTime = (s?: string | null) => s
  ? new Date(s).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '';

function Field({ label, value, pen }: { label: string; value: string; pen?: boolean }) {
  return (
    <div style={{ marginBottom: '.7rem', paddingLeft: pen ? '.7rem' : 0,
      borderLeft: pen ? '2px solid var(--pen)' : undefined }}>
      <div style={{ ...meta, color: pen ? 'var(--pen)' : 'var(--ink-faint)' }}>{label}</div>
      <div style={{ fontSize: '.9rem' }}>{value}</div>
    </div>
  );
}

function StrengthenPitchButton({ pitchId, onDone }: { pitchId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function strengthen() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/foundry/pitch/${pitchId}/strengthen`, { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`Strengthen failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const chunk of parts) {
          const ev = chunk.match(/^event: (\w+)\ndata: ([\s\S]+)/);
          if (!ev) continue;
          const [, event, raw] = ev;
          const data = JSON.parse(raw);
          if (event === 'log') setNote(data.message);
          if (event === 'done') {
            setNote(data.strengthened
              ? `Strengthened · ${data.strengthening_note}`
              : data.strengthening_note ?? 'No material improvement found');
            onDone();
          }
          if (event === 'error') throw new Error(data.message);
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Strengthen failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <button
        type="button"
        style={actBtn('var(--color-slate-iris, #495472)')}
        disabled={busy}
        onClick={strengthen}
        title="Search for additional tier 1/2 data and strengthen this pitch"
      >
        {busy ? 'Strengthening…' : '⚡ Strengthen'}
      </button>
      {note && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem',
          color: 'var(--ink-faint)', marginTop: '.25rem', maxWidth: '16rem' }}>
          {note}
        </span>
      )}
    </span>
  );
}

function ReviewTrendingButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);

  async function review() {
    setBusy(true);
    setLog([]);
    setResult(null);
    try {
      const res = await fetch('/api/foundry/trending-review', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`Review failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const chunk of parts) {
          const ev = chunk.match(/^event: (\w+)\ndata: ([\s\S]+)/);
          if (!ev) continue;
          const [, event, raw] = ev;
          const data = JSON.parse(raw);
          if (event === 'log') setLog((l) => [...l, data.message]);
          if (event === 'done') {
            setResult(`${data.attached} attached · ${data.created} new · ${data.ignored} ignored`);
            onDone();
          }
          if (event === 'error') throw new Error(data.message);
        }
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '.35rem' }}>
      <button
        type="button"
        className="studio-link"
        disabled={busy}
        onClick={review}
        title="Match today's trending topics to pitches, attach validated findings, or open a new candidate"
      >
        {busy ? 'Reviewing trends…' : '↗ Review trending topics'}
      </button>
      {result && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', color: 'var(--ink-soft)' }}>
          {result}
        </span>
      )}
      {busy && log.length > 0 && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-faint)', maxWidth: '28rem' }}>
          {log[log.length - 1]}
        </span>
      )}
    </span>
  );
}

function RefreshDataButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setLog([]);
    setResult(null);
    try {
      const res = await fetch('/api/foundry/refresh', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`Refresh failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const chunk of parts) {
          const ev = chunk.match(/^event: (\w+)\ndata: ([\s\S]+)/);
          if (!ev) continue;
          const [, event, raw] = ev;
          const data = JSON.parse(raw);
          if (event === 'log') setLog((l) => [...l, data.message]);
          if (event === 'done') {
            setResult(`${data.pitches_revised} revised · ${data.sources_changed} new obs · ${data.candidates_new} new candidates`);
            onDone();
          }
          if (event === 'error') throw new Error(data.message);
        }
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '.35rem' }}>
      <button
        type="button"
        className="studio-link"
        disabled={busy}
        onClick={refresh}
        title="Pull RBA, ABS, and rate-indicator data; revise pitches that moved"
      >
        {busy ? 'Refreshing…' : '↻ Refresh data & revise pitches'}
      </button>
      {result && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', color: 'var(--ink-soft)' }}>
          {result}
        </span>
      )}
      {busy && log.length > 0 && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-faint)', maxWidth: '28rem' }}>
          {log[log.length - 1]}
        </span>
      )}
    </span>
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
const notice: React.CSSProperties = {
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem', letterSpacing: '.03em',
  color: 'var(--ink-soft)', margin: '0 0 var(--spacing-21)', padding: '0.7rem 0',
  borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
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
