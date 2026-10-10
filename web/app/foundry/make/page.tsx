import { createClient } from '@/lib/supabase-server';
import { dispatchReady, recentRuns } from '@/lib/github-dispatch';
import MakeBoard from './MakeBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Make — Foundry' };

/** The races the renderer knows (lib/visuals-race.ts), by key. */
const RACES = [
  { key: 'race:erp_cob', label: "Australia's immigrants by country of birth" },
  { key: 'race:visitors_country', label: "Where Australia's visitors come from" },
  { key: 'race:residents_trips_country', label: 'Where Australians travel' },
  { key: 'race:gdp_per_capita', label: 'GDP per person in OECD countries' },
];

export default async function MakePage() {
  const db = createClient();
  const [{ data: pitches }, { data: stories }, runs] = await Promise.all([
    db.from('pitches').select('id, headline, state, score, rank_value').in('state', ['candidate', 'pitched', 'approved', 'watchlist'])
      .order('rank_value', { ascending: false, nullsFirst: false }).limit(40),
    db.from('stories').select('slug, title, status, pitch_id').in('status', ['published', 'draft']).order('published', { ascending: false }).limit(60),
    recentRuns(12),
  ]);
  const withStory = new Set((stories ?? []).map((s) => s.pitch_id).filter(Boolean));
  return (
    <main className="desk-page mk-page">
      <p className="desk-kicker">Foundry · Make</p>
      <h1 className="section-head" style={{ borderBottom: 'none' }}>Make</h1>
      <p className="measure mk-intro">
        One place to make every kind of piece. Each runs the same checks as the automatic pipeline (fact check, number
        check, picture check, captions from the data) and lands in the production queue or on its story. Videos use the
        house track, voiceover and on-screen text; no presenters.
      </p>
      <MakeBoard
        ready={dispatchReady()}
        races={RACES}
        pitches={(pitches ?? []).filter((p) => !withStory.has(p.id)).map((p) => ({
          id: p.id as string, headline: p.headline as string, state: p.state as string,
          score: Object.values((p.score ?? {}) as Record<string, number>).filter((v) => typeof v === 'number') as number[],
        }))}
        stories={(stories ?? []).map((s) => ({ slug: s.slug as string, title: s.title as string, status: s.status as string }))}
        runs={runs}
      />
    </main>
  );
}
