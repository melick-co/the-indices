'use client';

import Link from 'next/link';
import { VIDEO_STAGE_LABEL, isVideoStage, type VideoStage } from '@/lib/reel-types';

export type ReelLink = { status: string; stage?: VideoStage | string | null };

function videoHref(slug: string, preview?: boolean): string {
  return `/stories/${slug}/reel${preview ? '?preview=1' : ''}`;
}

function label(reel?: ReelLink | null): string {
  if (!reel) return 'Generate video';
  if (reel.status === 'ready') return 'Video ready';
  const stage = isVideoStage(reel.stage) ? reel.stage : null;
  return stage ? `Video · ${VIDEO_STAGE_LABEL[stage].toLowerCase()}` : 'Review video';
}

/**
 * Entry point onto the video pipeline for an approved story.
 * Generation itself happens on the pipeline page, in order: script, storyboard, prompt output.
 */
export default function ReelControls({
  slug,
  reel,
  preview,
  buttonStyle,
}: {
  slug: string;
  reel?: ReelLink | null;
  preview?: boolean;
  /** Unused; generation now lives on the pipeline page. Kept so older call sites type-check. */
  onDone?: () => void;
  buttonStyle?: React.CSSProperties;
}) {
  const href = videoHref(slug, preview);
  const style = buttonStyle ?? {
    fontFamily: 'var(--font-ui)',
    fontSize: '.7rem',
    letterSpacing: '.06em',
    textTransform: 'uppercase' as const,
    padding: '.4rem .75rem',
    cursor: 'pointer',
    borderRadius: 0,
    border: '1px solid var(--ink)',
    background: 'transparent',
    color: 'var(--ink)',
    textDecoration: 'none',
    display: 'inline-block',
  };

  return (
    <Link
      href={href}
      style={style}
      title="Open the video pipeline: script, then storyboard, then prompt output, then Runway"
    >
      {label(reel)} →
    </Link>
  );
}
