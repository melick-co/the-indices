'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VIDEO_STAGE_LABEL, isVideoStage, type VideoStage } from '@/lib/reel-types';

export type ReelLink = { status: string; stage?: VideoStage | string | null };

async function readSse(
  res: Response,
  onNote: (message: string) => void,
): Promise<{ sceneCount?: number; totalSeconds?: number; warnings?: string[]; stage?: string }> {
  if (!res.ok || !res.body) throw new Error(`Video failed (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result: { sceneCount?: number; totalSeconds?: number; warnings?: string[]; stage?: string } = {};

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
      if (event === 'log' || event === 'status') onNote(data.message);
      if (event === 'done') result = data;
      if (event === 'error') throw new Error(data.message);
    }
  }
  return result;
}

const NEXT: Record<VideoStage, { stage: VideoStage; label: string } | null> = {
  script: { stage: 'storyboard', label: 'Draw storyboard' },
  storyboard: { stage: 'prompts', label: 'Build prompt output' },
  prompts: null,
};

/**
 * Stage actions for the video pipeline page: write the script, draw the storyboard,
 * then emit the prompt pack. Rewriting the script resets later stages.
 */
export default function ReelActions({
  slug,
  reel,
  warningCount = 0,
}: {
  slug: string;
  reel?: ReelLink | null;
  warningCount?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<VideoStage | 'ready' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stage = isVideoStage(reel?.stage) ? reel!.stage : null;

  async function generate(target: VideoStage) {
    setBusy(target);
    setNote(null);
    try {
      const res = await fetch(`/api/stories/${slug}/reel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: target }),
      });
      const data = await readSse(res, setNote);
      const label = isVideoStage(data.stage) ? VIDEO_STAGE_LABEL[data.stage] : 'Video';
      setNote(
        data.warnings?.length
          ? `${label} · ${data.sceneCount} scenes · ${data.totalSeconds}s · ${data.warnings.length} to check`
          : `${label} · ${data.sceneCount} scenes · ${data.totalSeconds}s`,
      );
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Video failed');
    } finally {
      setBusy(null);
    }
  }

  async function markReady() {
    setBusy('ready');
    setNote(null);
    try {
      const res = await fetch(`/api/stories/${slug}/reel/ready`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Failed (${res.status})`);
      setNote('Ready to render');
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  const next = stage ? NEXT[stage] : { stage: 'script' as const, label: 'Write script' };
  const canReady = stage === 'prompts' && reel?.status === 'draft' && warningCount === 0;

  return (
    <span className="reel-actions-inner">
      {next && (
        <button
          type="button"
          className="reel-action-primary"
          disabled={busy !== null}
          onClick={() => generate(next.stage)}
        >
          {busy === next.stage ? 'Working…' : next.label}
        </button>
      )}
      {canReady && (
        <button
          type="button"
          className="reel-action-primary"
          disabled={busy !== null}
          onClick={markReady}
        >
          {busy === 'ready' ? 'Marking…' : 'Mark ready'}
        </button>
      )}
      {stage && (
        <button
          type="button"
          className="reel-action-quiet"
          disabled={busy !== null}
          onClick={() => generate('script')}
          title="Rewrite the script. This clears the storyboard and prompt pack."
        >
          {busy === 'script' ? 'Rewriting…' : 'Rewrite script'}
        </button>
      )}
      {stage && stage !== 'script' && (
        <button
          type="button"
          className="reel-action-quiet"
          disabled={busy !== null}
          onClick={() => generate('storyboard')}
          title="Redraw the storyboard against the locked script"
        >
          {busy === 'storyboard' ? 'Redrawing…' : 'Redraw storyboard'}
        </button>
      )}
      {stage === 'prompts' && (
        <button
          type="button"
          className="reel-action-quiet"
          disabled={busy !== null}
          onClick={() => generate('prompts')}
          title="Rebuild the prompt pack from the locked storyboard"
        >
          {busy === 'prompts' ? 'Rebuilding…' : 'Rebuild prompt output'}
        </button>
      )}
      {note && <span className="reel-action-note">{note}</span>}
    </span>
  );
}
