'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { RunSummary } from '@/lib/github-dispatch';
import { listGraphics, make, runs as loadRuns, type MakeKind } from './actions';

type Pitch = { id: string; headline: string; state: string; score: number[] };
type Story = { slug: string; title: string; status: string };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function MakeBoard({ ready, races, pitches, stories, runs, trackBase }: {
  ready: boolean; races: { key: string; label: string }[]; pitches: Pitch[]; stories: Story[]; runs: RunSummary[]; trackBase: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recent, setRecent] = useState(runs);
  const [graphics, setGraphics] = useState<{ key: string; label: string }[] | null>(null);
  const [pick, setPick] = useState({ pitch: '', graphic: '', race: '', story: stories[0]?.slug ?? '', brief: '' });

  const go = (kind: MakeKind, target: string, brief?: string) => start(async () => {
    setMsg(null);
    try {
      const r = await make(kind, target, brief);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setTimeout(async () => setRecent(await loadRuns()), 6000);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'That did not start.' }); }
  });

  return (
    <div className="mk">
      {!ready && (
        <p className="mk-warn">
          Jobs can&apos;t be started from here yet: add <code>GITHUB_DISPATCH_TOKEN</code> (a fine-grained GitHub token with
          Actions read and write on this repository) to the site&apos;s environment in Vercel and redeploy. Until then each
          button tells you which task to run in GitHub Actions.
        </p>
      )}
      {msg && <p className={`mk-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}

      <div className="mk-grid">
        <section className="mk-card">
          <h2>Article</h2>
          <p>Strengthen a pitch and write it up. Your pick is written whatever it scores; the fact check still decides whether it goes out, and the queue when.</p>
          <select className="mk-input" value={pick.pitch} onChange={(e) => setPick({ ...pick, pitch: e.target.value })}>
            <option value="">Choose a pitch…</option>
            {pitches.map((p) => (
              <option key={p.id} value={p.id}>{p.headline.slice(0, 90)}{p.score.length ? ` · ${p.score.join('/')}` : ''}</option>
            ))}
          </select>
          <button type="button" className="mk-btn" disabled={pending || !pick.pitch} onClick={() => go('article', pick.pitch)}>Write the article</button>
        </section>

        <section className="mk-card">
          <h2>Graphic</h2>
          <p>A ranking, breakdown or change graphic from official data, every number checked. Choose one, or let the generator pick the freshest.</p>
          {graphics ? (
            <select className="mk-input" value={pick.graphic} onChange={(e) => setPick({ ...pick, graphic: e.target.value })}>
              <option value="">Let it pick</option>
              {graphics.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          ) : (
            <button type="button" className="mk-link" disabled={pending} onClick={() => start(async () => setGraphics(await listGraphics()))}>
              {pending ? 'Loading…' : 'Choose a dataset'}
            </button>
          )}
          <button type="button" className="mk-btn" disabled={pending} onClick={() => go('graphic', pick.graphic)}>Make the graphic</button>
        </section>

        <section className="mk-card">
          <h2>Race video</h2>
          <p>A bar-chart race in 9:16, 16:9 and 1:1 with the house track, data-derived captions, flags and a poster; scheduled to YouTube through the queue.</p>
          <select className="mk-input" value={pick.race} onChange={(e) => setPick({ ...pick, race: e.target.value })}>
            <option value="">The one that has waited longest</option>
            {races.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button type="button" className="mk-btn" disabled={pending} onClick={() => go('race', pick.race)}>Render the race</button>
        </section>

        <section className="mk-card mk-wide">
          <h2>For a story</h2>
          <p>Pictures, the story-in-numbers panel and videos for one story. Videos are voiceover, on-screen text and the house track: no presenters.</p>
          <select className="mk-input" value={pick.story} onChange={(e) => setPick({ ...pick, story: e.target.value })}>
            {stories.map((s) => <option key={s.slug} value={s.slug}>{s.title}{s.status === 'draft' ? ' (draft)' : ''}</option>)}
          </select>
          <div className="mk-row">
            <button type="button" className="mk-btn" disabled={pending || !pick.story} onClick={() => go('highlights', pick.story)}>Remake the numbers panel</button>
            <button type="button" className="mk-btn" disabled={pending || !pick.story} onClick={() => go('brief', pick.story)}>Preview art briefs</button>
            <Link className="mk-btn ghost" href={pick.story ? `/stories/${pick.story}/reel` : '#'}>Explainer video →</Link>
          </div>
          <label className="mk-label">Scene for the picture (optional; otherwise the art brief writes one)
            <textarea className="mk-input" rows={2} value={pick.brief} onChange={(e) => setPick({ ...pick, brief: e.target.value })}
              placeholder="e.g. A long trestle table in an Australian backyard…" />
          </label>
          <div className="mk-row">
            <button type="button" className="mk-btn" disabled={pending || !pick.story} onClick={() => go('picture', pick.story, pick.brief)}>Draw the picture</button>
            <button type="button" className="mk-btn" disabled={pending || !pick.story} onClick={() => go('clip', pick.story, pick.brief)}>Picture and 8-second clip</button>
          </div>
        </section>
        <section className="mk-card mk-wide">
          <h2>House track</h2>
          <p>The one theme every video uses (races, explainers and clips), under the voiceover. Listen, then choose; the next renders use it.</p>
          <div className="mk-tracks">
            <figure><figcaption>In use</figcaption><audio controls preload="none" src={`${trackBase}/caveat-theme.mp3`} /></figure>
            {[1, 2, 3].map((n) => (
              <figure key={n}>
                <figcaption>Candidate {n}</figcaption>
                <audio controls preload="none" src={`${trackBase}/candidates/theme-${n}.mp3`} />
                <button type="button" className="mk-link" disabled={pending} onClick={() => go('house-track', String(n))}>Use this one</button>
              </figure>
            ))}
          </div>
        </section>
      </div>

      <section className="mk-runs">
        <h2>Recent jobs {ready && <button type="button" className="mk-link" disabled={pending} onClick={() => start(async () => setRecent(await loadRuns()))}>refresh</button>}</h2>
        {recent.length ? (
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <span className={`mk-dot ${r.status !== 'completed' ? 'run' : r.conclusion === 'success' ? 'ok' : 'err'}`} />
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                <span className="mk-meta">{r.status !== 'completed' ? r.status.replace('_', ' ') : r.conclusion} · {ago(r.created)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mk-meta">{ready ? 'No runs yet.' : 'Shown once the token is set.'}</p>}
        <p className="mk-meta">Finished pieces: <Link href="/foundry/queue">production queue</Link> · <Link href="/indices/visuals">visuals</Link> · <Link href="/foundry/desk">desk</Link></p>
      </section>
    </div>
  );
}
