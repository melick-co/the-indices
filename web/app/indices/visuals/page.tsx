import { Hero } from '@/components/dashboard/Views';
import { VisualCard } from '@/components/visuals/VisualPoster';
import { loadVisuals } from '@/lib/visuals';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Visuals — The Caveat’s Indices', description: 'Australia in charts: rankings, breakdowns and changes over time, drawn from official data.' };

export default async function VisualsPage() {
  const visuals = await loadVisuals();
  return (
    <main className="dx">
      <Hero kicker="The Caveat’s Indices · Visuals" title="Australia in charts"
        intro="Rankings, breakdowns and changes over time, drawn from the official data behind The Caveat’s Indices. Every number in every graphic is checked against its source." />
      <div className="dx-body">
        {visuals.length ? <div className="vz-grid">{visuals.map((v) => <VisualCard key={v.slug} v={v} />)}</div>
          : <p className="dx-note">The first visuals are on their way.</p>}
      </div>
    </main>
  );
}
