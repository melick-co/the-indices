'use client';

import { useState } from 'react';
import Link from 'next/link';

export type ReelLink = { status: string };

/**
 * Generate → review → mark ready controls for a story's reel brief.
 * Shared by the Foundry and Studio boards and the reel page itself.
 */
export default function ReelControls({
  slug,
  reel,
  onDone,
  buttonStyle,
}: {
  slug: string;
  reel?: ReelLink | null;
  onDone: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/stories/${slug}/reel`, { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`Reel failed (${res.status})`);
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
          if (event === 'log' || event === 'status') setNote(data.message);
          if (event === 'done') {
            setNote(
              data.warnings?.length
                ? `${data.sceneCount} scenes · ${data.totalSeconds}s · ${data.warnings.length} to check`
                : `${data.sceneCount} scenes · ${data.totalSeconds}s · all traced`,
            );
            onDone();
          }
          if (event === 'error') throw new Error(data.message);
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Reel failed');
    } finally {
      setBusy(false);
    }
  }

  async function markReady() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/stories/${slug}/reel/ready`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Failed (${res.status})`);
      setNote('Ready to render');
      onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const style = buttonStyle ?? {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '.7rem',
    letterSpacing: '.06em',
    textTransform: 'uppercase' as const,
    padding: '.4rem .75rem',
    cursor: 'pointer',
    borderRadius: 0,
    border: '1px solid var(--ink)',
    background: 'transparent',
    color: 'var(--ink)',
  };
  const soft = { ...style, borderColor: 'var(--ink-soft)', color: 'var(--ink-soft)' };
  const noteStyle = {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '.62rem',
    color: 'var(--ink-soft)',
  };

  if (!reel) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          style={style}
          disabled={busy}
          onClick={generate}
          title="Cut a vertical news explainer reel from this story's findings"
        >
          {busy ? 'Cutting reel…' : 'Generate reel'}
        </button>
        {note && <span style={noteStyle}>{note}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
      <Link href={`/stories/${slug}/reel`} className="studio-link" style={{ fontSize: '.7rem' }}>
        {reel.status === 'ready' ? 'Reel ready →' : 'Review reel →'}
      </Link>
      {reel.status === 'draft' && (
        <button
          type="button"
          style={style}
          disabled={busy}
          onClick={markReady}
          title="Mark this brief ready to hand to the video generator"
        >
          {busy ? 'Marking…' : 'Mark ready'}
        </button>
      )}
      <button
        type="button"
        style={soft}
        disabled={busy}
        onClick={generate}
        title="Cut the reel again from the story"
      >
        {busy ? 'Cutting…' : 'Regenerate'}
      </button>
      {note && <span style={noteStyle}>{note}</span>}
    </span>
  );
}
