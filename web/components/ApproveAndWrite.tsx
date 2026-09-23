'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { act } from '@/app/foundry/actions';
import { writeArticleFromPitch } from '@/lib/write-article';

export default function ApproveAndWrite({
  pitchId,
  comment,
  onCommentUsed,
  disabled,
  style,
}: {
  pitchId: string;
  comment?: string;
  onCommentUsed?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setNote('Approving…');
    try {
      await act(pitchId, 'approve', comment || undefined);
      onCommentUsed?.();
      setNote('Writing article…');
      const article = await writeArticleFromPitch(pitchId, setNote);
      setNote('Opening the desk…');
      router.push(`/foundry/desk/${article.slug}`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Approve failed');
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
      <button type="button" style={style} disabled={busy || disabled} onClick={approve}
        title="Approve the pitch, write it up as an article, then open the desk to edit and publish">
        {busy ? 'Writing…' : 'Approve'}
      </button>
      {note && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.62rem', color: 'var(--ink-soft)' }}>
          {note}
        </span>
      )}
    </span>
  );
}
