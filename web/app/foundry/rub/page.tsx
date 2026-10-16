import { createClient } from '@/lib/supabase-server';
import { dispatchReady } from '@/lib/github-dispatch';
import RubBoard, { type RubRow } from './RubBoard';

export const dynamic = 'force-dynamic';
// Saving an edit re-runs the strict check (figure check and claim audit), which can take a few minutes.
export const maxDuration = 300;
export const metadata = { title: 'The Rub — Foundry' };

export default async function RubDeskPage() {
  const db = createClient();
  const cols = 'id, slug, title, keywords, peg, paragraphs, metric_ids, status, check, source, published, created_at, updated_at, reviewed_at, review_note';
  const [open, decided] = await Promise.all([
    db.from('rubs').select(cols).in('status', ['pending', 'draft']).order('created_at', { ascending: false }),
    db.from('rubs').select(cols).in('status', ['published', 'rejected']).not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false }).limit(8),
  ]);
  const installed = !open.error;
  return (
    <main className="desk-page pq-page">
      <p className="desk-kicker">Foundry · The Rub</p>
      <h1 className="section-head" style={{ borderBottom: 'none' }}>The Rub</h1>
      <p className="measure pq-intro">
        Column 8. Once a week the runner drafts one column from what is trending, pins a loosely used word or number
        to a stored series, and runs the strict check (the figure check and claim audit stories pass, plus the
        column&apos;s own rules). Nothing goes live until you approve it here, and only a column that passed can be
        approved. Editing re-runs the check.
      </p>
      {!installed
        ? <p className="pq-note">The Rub&apos;s table isn&apos;t installed yet: run <code>agent/supabase/47_the_rub.sql</code> in the Supabase SQL editor. Until then the site shows the columns in <code>web/content/the-rub/seed.ts</code>.</p>
        : <RubBoard open={(open.data ?? []) as RubRow[]} decided={(decided.data ?? []) as RubRow[]} canDispatch={dispatchReady()} />}
    </main>
  );
}
