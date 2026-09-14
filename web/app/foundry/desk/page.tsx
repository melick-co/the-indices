import Link from 'next/link';
import { loadDeskStories } from '@/lib/stories-loader';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex } from '@/lib/trend-weight';
import { buildHomeLayout } from '@/lib/home-layout';
import DeskBoard from './DeskBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'News Desk — Caveat' };

export default async function NewsDeskPage() {
  const [all, trendingData] = await Promise.all([
    loadDeskStories(),
    loadTrendingPage(),
  ]);
  const trendIndex = buildTrendIndex(trendingData);
  const live = all.filter((s) => s.status === 'published' || s.status === 'draft');
  const layout = buildHomeLayout(live, trendIndex);
  const archived = all.filter((s) => s.status === 'archived');

  return (
    <main className="desk-page">
      <p className="desk-kicker">Foundry · News Desk</p>
      <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 'var(--spacing-21)' }}>
        News Desk
      </h1>
      <p className="measure" style={{ marginBottom: 'var(--spacing-21)' }}>
        Lay out the home page, edit published copy, and attach images. Pitches stay
        on <Link href="/foundry">Foundry</Link>. Chart figures are editor-entered —
        the desk does not invent them. Generated stills and clips attach here when
        another agent writes them; this desk does not call Runway.
      </p>
      <DeskBoard
        hero={layout.hero}
        frameChecks={layout.frameChecks}
        stories={layout.stories}
        archived={archived}
      />
    </main>
  );
}
