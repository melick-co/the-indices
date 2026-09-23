'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { publishArticleFromPitch, writeArticleFromPitch } from '@/lib/write-article';

export type StoryLink = { slug: string; status: string };

/**
 * Edit / save lives on the News Desk. This is the one-click write and publish
 * strip for an approved pitch on Foundry and Studio.
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setNote(null);
    try {
      const article = await writeArticleFromPitch(pitchId, setNote);
      setNote('Article ready');
      onDone();
      router.push(`/foundry/desk/${article.slug}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Write failed');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setNote(null);
    try {
      const data = await publishArticleFromPitch(pitchId);
      setNote(`Published · ${data.storyUrl}`);
      onDone();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Publish failed');
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        <Link href={`/foundry/desk/${story.slug}`} className="studio-link" style={{ fontSize: '.7rem' }}>
          Edit article
        </Link>
        <Link href={`/stories/${story.slug}`} className="studio-link" style={{ fontSize: '.7rem' }}>
          View story →
        </Link>
      </span>
    );
  }

  if (story?.status === 'draft') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
        <Link href={`/foundry/desk/${story.slug}`} className="studio-link" style={{ fontSize: '.7rem' }}>
          Edit article
        </Link>
        <Link
          href={`/stories/${story.slug}?preview=1`}
          className="studio-link"
          style={{ fontSize: '.7rem' }}
        >
          Preview
        </Link>
        <button type="button" style={style} disabled={busy} onClick={publish} title="Publish the article">
          {busy ? 'Publishing…' : 'Publish'}
        </button>
        <button
          type="button"
          style={{ ...style, borderColor: 'var(--ink-soft)', color: 'var(--ink-soft)' }}
          disabled={busy}
          onClick={write}
          title="Rewrite the article from the pitch"
        >
          {busy ? 'Rewriting…' : 'Rewrite'}
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
        onClick={write}
        title="Write the approved pitch up as an article"
      >
        {busy ? 'Writing…' : 'Write article'}
      </button>
      {note && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-soft)' }}>
          {note}
        </span>
      )}
    </span>
  );
}
