'use client';

import { useState, useTransition } from 'react';
import { approvable, CLOSING_LINE, columnIssues, MAX_WORDS, MIN_WORDS, type RubCheck } from '@/lib/rub-rules';
import { approveRub, draftRubNow, rejectRub, saveRubEdit } from './actions';

export type RubRow = {
  id: string; slug: string; title: string; keywords: string[] | null; peg: string | null; paragraphs: string[] | null;
  metric_ids: string[] | null; status: 'draft' | 'pending' | 'published' | 'rejected'; check: RubCheck | null;
  source: { kind?: string; peg?: string; word?: string; why_loose?: string; angle?: string; links?: string[];
    story?: { title: string; url: string } | null; revisions?: { issues: string[] }[] } | null;
  published: string | null; created_at: string; updated_at: string; reviewed_at: string | null; review_note: string | null;
};

const STATUS_LABEL: Record<RubRow['status'], string> = { pending: 'Passed: awaiting approval', draft: 'Held: failed the check', published: 'Published', rejected: 'Rejected' };
const host = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' });

type Run = (fn: () => Promise<unknown>, done?: string) => void;

export default function RubBoard({ open, decided, canDispatch }: { open: RubRow[]; decided: RubRow[]; canDispatch: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run: Run = (fn, done) => start(async () => {
    setMsg(null);
    try { await fn(); if (done) setMsg(done); } catch (e) { setMsg(e instanceof Error ? e.message : 'That did not work.'); }
  });
  const waiting = open.filter((r) => r.status === 'pending');
  const held = open.filter((r) => r.status === 'draft');

  return (
    <div className="pq" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="pq-bar">
        <span className={`pq-state ${waiting.length ? 'on' : 'off'}`}>{waiting.length} awaiting approval · {held.length} held</span>
        <span className="pq-rules-line">Drafted weekly (Monday about 5am Sydney). 3 to 4 paragraphs, {MIN_WORDS} to {MAX_WORDS} words, ending &ldquo;{CLOSING_LINE}&rdquo;</span>
        <span className="pq-bar-actions">
          <button type="button" className="pq-btn primary" disabled={pending}
            onClick={() => run(async () => { const r = await draftRubNow(); setMsg(r.message); })}
            title={canDispatch ? 'Start a draft on the runner' : 'GITHUB_DISPATCH_TOKEN is not set on the server'}>
            {pending ? 'Working…' : 'Draft one now'}
          </button>
        </span>
      </div>
      {msg && <p className="pq-msg">{msg}</p>}

      <section>
        <h2 className="pq-h">Awaiting approval</h2>
        {waiting.length ? <div className="pq-list">{waiting.map((r) => <RubCard key={r.id} row={r} run={run} busy={pending} />)}</div>
          : <p className="pq-empty">Nothing waiting.</p>}
      </section>
      <section>
        <h2 className="pq-h">Held by the check</h2>
        {held.length ? <div className="pq-list">{held.map((r) => <RubCard key={r.id} row={r} run={run} busy={pending} />)}</div>
          : <p className="pq-empty">Nothing held.</p>}
      </section>
      {decided.length > 0 && (
        <section>
          <h2 className="pq-h">Recently decided</h2>
          <div className="pq-list">
            {decided.map((r) => (
              <div key={r.id} className="pq-row">
                <div className="pq-row-main">
                  <span className="pq-kind" style={{ borderLeftColor: r.status === 'published' ? '#2f9e44' : '#c2372d' }}>{STATUS_LABEL[r.status]}</span>
                  <div className="pq-row-text">
                    {r.status === 'published' ? <a className="pq-title" href={`/the-rub/${r.slug}`}>{r.title}</a> : <span className="pq-title">{r.title}</span>}
                    <div className="pq-meta">{r.reviewed_at ? day(r.reviewed_at) : ''}{r.review_note ? ` · ${r.review_note}` : ''}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RubCard({ row, run, busy }: { row: RubRow; run: Run; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const check = row.check;
  const canApprove = row.status === 'pending' && approvable(check);
  const src = row.source ?? {};

  return (
    <div className={`pq-row ${row.status === 'draft' ? 's-failed' : ''}`}>
      <div className="pq-row-main">
        <span className="pq-kind" style={{ borderLeftColor: row.status === 'pending' ? '#2f9e44' : '#c2372d' }}>{STATUS_LABEL[row.status]}</span>
        <div className="pq-row-text">
          <span className="pq-title">{row.title}</span>
          <div className="pq-meta">
            Drafted {day(row.created_at)} · /the-rub/{row.slug}
            {row.peg ? ` · peg: ${row.peg}` : ''}{src.kind ? ` (${src.kind})` : ''}
            {src.word ? ` · loose word: ${src.word}` : ''}
          </div>
          <div className="pq-chans">
            {(row.metric_ids ?? []).map((m) => <span key={m} className="pq-chan">{m}</span>)}
            {(row.keywords ?? []).map((k) => <span key={k} className="pq-chan" style={{ background: '#fff', border: '1px solid #e6eaf1' }}>{k}</span>)}
          </div>
        </div>
      </div>

      <div className="pq-detail">
        {src.why_loose && <p className="pq-reason"><strong>Why it&apos;s loose:</strong> {src.why_loose}</p>}
        {src.angle && <p className="pq-summary"><strong>Angle:</strong> {src.angle}</p>}
        {(src.story || (src.links ?? []).length > 0) && (
          <p className="pq-summary">
            <strong>Prompted by:</strong>{' '}
            {src.story ? <a href={src.story.url}>{src.story.title}</a> : null}
            {(src.links ?? []).filter((l) => l !== src.story?.url).map((l) => <span key={l}> · <a href={l} target="_blank" rel="noreferrer">{host(l)}</a></span>)}
          </p>
        )}

        {editing
          ? <EditForm row={row} run={run} busy={busy} onDone={() => setEditing(false)} />
          : (
            <div style={{ background: '#fbfaf4', border: '1px solid #eee6cf', borderRadius: 6, padding: '10px 14px', fontFamily: 'Georgia, serif', fontSize: '.95rem', lineHeight: 1.5 }}>
              {(row.paragraphs ?? []).map((p, i) => <p key={i} style={{ margin: '0 0 10px' }}>{p}</p>)}
            </div>
          )}

        <CheckPanel check={check} />

        {!editing && (
          <div className="pq-actions">
            <button type="button" className="pq-btn primary" disabled={busy || !canApprove}
              title={canApprove ? 'Publish it today' : 'Only a column that passed the strict check (with the claim audit) can be approved'}
              onClick={() => run(() => approveRub(row.id), `Published: /the-rub/${row.slug}`)}>Approve and publish</button>
            <button type="button" className="pq-btn" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            {rejecting
              ? (
                <>
                  <input className="pq-input" style={{ flex: '1 1 240px' }} placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="button" className="pq-btn danger" disabled={busy} onClick={() => run(() => rejectRub(row.id, note), 'Rejected.')}>Reject</button>
                  <button type="button" className="pq-btn" onClick={() => setRejecting(false)}>Cancel</button>
                </>
              )
              : <button type="button" className="pq-btn danger" disabled={busy} onClick={() => setRejecting(true)}>Reject…</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckPanel({ check }: { check: RubCheck | null }) {
  if (!check) return <p className="pq-reason">Not checked.</p>;
  const verdict = approvable(check) ? 'Passed the strict check' : check.stale ? 'Edited since its check: not checked' : check.audited ? 'Failed the strict check' : 'Not passed: the claim audit did not run';
  return (
    <div className="pq-log" style={{ whiteSpace: 'normal' }}>
      <strong style={{ color: approvable(check) ? '#22753a' : '#a32d24' }}>{verdict}</strong>
      {check.checked_at ? <span style={{ color: '#5b6b85' }}> · {new Date(check.checked_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}
      {check.issues?.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{check.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>}
      {check.warnings?.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#5b6b85' }}>{check.warnings.map((w, k) => <li key={k}>note: {w}</li>)}</ul>}
      {(check.claims ?? []).length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary>{check.claims!.length} claim{check.claims!.length === 1 ? '' : 's'} audited</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {check.claims!.map((c, k) => <li key={k}><strong>{c.verdict}</strong>: &ldquo;{c.claim}&rdquo; ({c.evidence})</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function EditForm({ row, run, busy, onDone }: { row: RubRow; run: Run; busy: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState((row.paragraphs ?? []).join('\n\n'));
  const [keywords, setKeywords] = useState((row.keywords ?? []).join(', '));
  const [metrics, setMetrics] = useState((row.metric_ids ?? []).join(' '));
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const local = columnIssues({ title, paragraphs });

  return (
    <div className="pq-rules">
      <label>Title<input className="pq-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Paragraphs (a blank line between each; the last is the closing line)
        <textarea className="pq-input" rows={16} value={body} onChange={(e) => setBody(e.target.value)} style={{ fontFamily: 'Georgia, serif', lineHeight: 1.45 }} />
      </label>
      <div className="pq-rules-grid">
        <label>Keywords (comma separated)<input className="pq-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
        <label>Series that settle it (metric ids, space separated)<input className="pq-input" value={metrics} onChange={(e) => setMetrics(e.target.value)} /></label>
      </div>
      {local.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: '#a32d24' }}>{local.map((i) => <li key={i}>{i}</li>)}</ul>}
      <div className="pq-actions">
        <button type="button" className="pq-btn primary" disabled={busy}
          onClick={() => run(async () => {
            const check = await saveRubEdit(row.id, {
              title, paragraphs,
              keywords: keywords.split(','),
              metric_ids: metrics.split(/[\s,]+/),
            });
            onDone();
            if (!check.ok) throw new Error(`Saved, but it failed the strict check (${check.issues.length} issue${check.issues.length === 1 ? '' : 's'}); it is held as a draft.`);
          }, 'Saved and re-checked: it passed and is awaiting approval.')}>
          {busy ? 'Checking… (can take a few minutes)' : 'Save and re-check'}
        </button>
        <button type="button" className="pq-btn" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
