'use client';

import { useState, useTransition } from 'react';
import { approveSourceSuggestion, rejectSourceSuggestion } from '../actions';

/** Approve or reject a source/feed suggestion in place (the same actions as the Pitches board's panel). */
export default function SourceDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  if (done) return <span className="nd-meta">{done}</span>;
  return (
    <span className="nd-actions">
      <button type="button" className="nd-btn" disabled={pending}
        onClick={() => start(async () => {
          const r = await approveSourceSuggestion(id).catch(() => null);
          setDone(r && 'ok' in r && r.ok === false ? 'could not approve: open Pitches' : 'approved');
        })}>Approve</button>
      <button type="button" className="nd-btn nd-btn--quiet" disabled={pending}
        onClick={() => start(async () => { await rejectSourceSuggestion(id); setDone('rejected'); })}>Reject</button>
    </span>
  );
}
