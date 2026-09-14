'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReelScene } from '@/lib/reel-types';
import {
  REEL_SCENE_ID,
  RENDER_KIND_LABEL,
  type RenderKind,
  type RenderListResponse,
  type StoryReelRender,
} from '@/lib/reel-render-types';

function filename(render: StoryReelRender): string {
  const ext = (render.contentType ?? '').includes('png') ? 'png'
    : (render.contentType ?? '').includes('jpeg') ? 'jpg'
    : (render.contentType ?? '').includes('webp') ? 'webp'
    : (render.kind === 'still' || render.kind === 'chart') ? 'png'
    : 'mp4';
  return `${render.storySlug}-${render.sceneId}-${render.kind}.${ext}`;
}

function Preview({ render }: { render: StoryReelRender }) {
  if (render.status !== 'succeeded' || !render.outputUrl) return null;
  if (render.kind === 'reel' && render.outputManifest?.clips.length) {
    return (
      <ol className="runway-playlist">
        {render.outputManifest.clips.map((clip, i) => (
          <li key={`${clip.sceneId}-${i}`}>
            <video src={clip.url} controls playsInline preload="metadata" />
            <a href={clip.url} download={`${render.storySlug}-${clip.sceneId}.mp4`}>Download clip {i + 1}</a>
          </li>
        ))}
      </ol>
    );
  }
  if ((render.contentType ?? '').startsWith('video') || render.kind === 'clip' || render.kind === 'chart_video') {
    return (
      <div className="runway-preview">
        <video src={render.outputUrl} controls playsInline preload="metadata" />
        <a href={render.outputUrl} download={filename(render)}>Download</a>
      </div>
    );
  }
  return (
    <div className="runway-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={render.outputUrl} alt={`${RENDER_KIND_LABEL[render.kind]} for ${render.sceneId}`} />
      <a href={render.outputUrl} download={filename(render)}>Download</a>
    </div>
  );
}

function Status({ render }: { render?: StoryReelRender }) {
  if (!render) return <span className="runway-status runway-status-idle">not generated</span>;
  return (
    <span className={`runway-status runway-status-${render.status}`}>
      {render.status}
      {render.error ? ` · ${render.error}` : ''}
    </span>
  );
}

/**
 * Runway renderer. Lives after the locked storyboard / prompt pack: it consumes
 * traced figures, it does not invent them. Polls GET /v1/tasks/{id} via the
 * server; Runway has no webhook.
 */
export default function ReelRenderer({
  slug,
  scenes,
}: {
  slug: string;
  scenes: ReelScene[];
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [renders, setRenders] = useState<StoryReelRender[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, StoryReelRender>();
    for (const r of renders) map.set(`${r.sceneId}:${r.kind}`, r);
    return map;
  }, [renders]);

  const open = renders.some((r) => r.status === 'queued' || r.status === 'running');

  const apply = useCallback((data: RenderListResponse) => {
    setConfigured(data.configured);
    setRenders(data.renders ?? []);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/stories/${slug}/reel/render`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Failed (${res.status})`);
    apply(data);
  }, [apply, slug]);

  useEffect(() => {
    load().catch((e) => setNote(e instanceof Error ? e.message : 'Could not load renders'));
  }, [load]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/stories/${slug}/reel/render/poll`, { method: 'POST' });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setNote(data.message || `Poll failed (${res.status})`);
          return;
        }
        apply(data);
      } catch (e) {
        if (!cancelled) setNote(e instanceof Error ? e.message : 'Poll failed');
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, 5000 + Math.floor(Math.random() * 1000));
      }
    };
    timer = window.setTimeout(tick, 5000 + Math.floor(Math.random() * 1000));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apply, open, slug]);

  async function start(body: { scope: 'scene' | 'reel'; sceneId?: string; kind?: RenderKind | 'auto' }, label: string) {
    setBusy(label);
    setNote(null);
    try {
      const res = await fetch(`/api/stories/${slug}/reel/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Failed (${res.status})`);
      apply(data);
      setNote(data.configured === false
        ? data.message
        : 'Runway job started. Status updates every few seconds.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Runway failed');
    } finally {
      setBusy(null);
    }
  }

  const reel = byKey.get(`${REEL_SCENE_ID}:reel`);
  const missingKey = configured === false;

  return (
    <section className="runway-block">
      <h2 className="reel-h2">Runway render</h2>
      <p className="reel-lede">
        After the prompt pack, Runway draws the stills and animates the clips.
        Chart scenes send the locked series and caption; the model is not asked
        for new figures. Jobs are async: we poll Runway until each task lands,
        then copy the file into our storage before the download link expires.
      </p>

      {missingKey && (
        <p className="runway-missing">
          RUNWAY_API_KEY (or RUNWAYML_API_SECRET) is not set on the server.
          Add it in Vercel env, then generate. Nothing is faked without a key.
        </p>
      )}

      <div className="runway-toolbar">
        <button
          type="button"
          className="reel-action-primary"
          disabled={busy !== null}
          onClick={() => start({ scope: 'reel', kind: 'auto' }, 'reel')}
        >
          {busy === 'reel' ? 'Starting…' : 'Generate whole reel'}
        </button>
        {reel && <Status render={reel} />}
        {note && <span className="reel-action-note">{note}</span>}
      </div>

      {reel?.status === 'succeeded' && <Preview render={reel} />}

      <div className="runway-scenes">
        {scenes.map((scene, i) => {
          const stillKind: RenderKind = scene.chart ? 'chart' : 'still';
          const videoKind: RenderKind = scene.chart ? 'chart_video' : 'clip';
          const still = byKey.get(`${scene.id}:${stillKind}`) ?? byKey.get(`${scene.id}:still`) ?? byKey.get(`${scene.id}:chart`);
          const video = byKey.get(`${scene.id}:${videoKind}`) ?? byKey.get(`${scene.id}:clip`) ?? byKey.get(`${scene.id}:chart_video`);
          const stillLabel = scene.chart ? 'Generate chart still' : 'Generate still';
          const videoLabel = scene.chart ? 'Animate chart' : 'Generate clip';
          return (
            <article key={scene.id} className="runway-scene">
              <header className="runway-scene-head">
                <span className="reel-scene-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="reel-scene-kind">{scene.kind.replace('_', ' ')}</span>
                {scene.chart && <span className="runway-chart-flag">locked chart</span>}
                <span className="reel-scene-secs">{scene.seconds}s</span>
              </header>
              {scene.chart && (
                <p className="runway-series">
                  {scene.chart.caption}: {scene.chart.series.map((p) => `${p.label} ${p.value}`).join('; ')}
                </p>
              )}
              <div className="runway-scene-actions">
                <button
                  type="button"
                  className="reel-action-quiet"
                  disabled={busy !== null}
                  onClick={() => start({ scope: 'scene', sceneId: scene.id, kind: stillKind }, `${scene.id}-still`)}
                >
                  {busy === `${scene.id}-still` ? 'Starting…' : stillLabel}
                </button>
                <Status render={still} />
                <button
                  type="button"
                  className="reel-action-quiet"
                  disabled={busy !== null}
                  onClick={() => start({ scope: 'scene', sceneId: scene.id, kind: videoKind }, `${scene.id}-video`)}
                >
                  {busy === `${scene.id}-video` ? 'Starting…' : videoLabel}
                </button>
                <Status render={video} />
              </div>
              <div className="runway-previews">
                {still && <Preview render={still} />}
                {video && <Preview render={video} />}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
