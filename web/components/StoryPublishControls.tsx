'use client';

import { useState } from 'react';
import Link from 'next/link';

export type StoryLink = { slug: string; status: string };

/**
 * Draft → preview → go live controls for an approved pitch.
 * Shared by Foundry and Studio boards.
 */
export default function StoryPublishControls({
  pitchId,
  story,
  onDone,
  buttonStyle,
}: {
  pitchId: string;
  story?: StoryLink | null;
  onDone: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/foundry/pitch/${pitchId}/publish`, { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`Draft failed (${res.status})`);
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
            setNote(`Draft ready · preview`);
            onDone();
          }
          if (event === 'error') throw new Error(data.message);
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setBusy(false);
    }
  }

  async function goLive() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/foundry/pitch/${pitchId}/go-live`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Go live failed (${res.status})`);
      setNote(`Live · ${data.storyUrl}`);
      onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Go live failed');
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

  if (story?.status === 'published') {
    return (
      <Link href={`/stories/${story.slug}`} className="studio-link" style={{ fontSize: '.7rem' }}>
        View story →
      </Link>
    );
  }

  if (story?.status === 'draft') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        <Link
          href={`/stories/${story.slug}?preview=1`}
          className="studio-link"
          style={{ fontSize: '.7rem' }}
        >
          Preview draft →
        </Link>
        <button type="button" style={style} disabled={busy} onClick={goLive} title="Publish draft to the home page">
          {busy ? 'Going live…' : 'Go live'}
        </button>
        <button
          type="button"
          style={{ ...style, borderColor: 'var(--ink-soft)', color: 'var(--ink-soft)' }}
          disabled={busy}
          onClick={draft}
          title="Regenerate the draft from the pitch"
        >
          {busy ? 'Redrafting…' : 'Redraft'}
        </button>
        {note && (
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-soft)' }}>
            {note}
          </span>
        )}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
      <button
        type="button"
        style={style}
        disabled={busy}
        onClick={draft}
        title="Research and draft a story for preview"
      >
        {busy ? 'Drafting…' : 'Draft story'}
      </button>
      {note && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-soft)' }}>
          {note}
        </span>
      )}
    </span>
  );
}
