import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VisualPoster } from '@/components/visuals/VisualPoster';
import { RacePlayer } from '@/components/visuals/RacePlayer';
import { IX } from '@/lib/indices-paths';
import { loadVisual } from '@/lib/visuals';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: { slug: string } }) {
  const v = await loadVisual(params.slug);
  return v ? { title: `${v.title} — The Indices`, description: v.subtitle ?? undefined } : {};
}

export default async function VisualPage({ params }: { params: { slug: string } }) {
  const v = await loadVisual(params.slug);
  if (!v) notFound();
  // The square video plays on the page; the vertical and landscape cuts are there to download for social.
  const videos = v.videos ?? {};
  const main = videos['1:1'] ?? videos['16:9'] ?? videos['9:16'];
  const others = (['9:16', '16:9'] as const).filter((f) => videos[f] && videos[f] !== main);
  return (
    <main className="vz-page">
      <p className="vz-crumb"><Link href={IX.visuals}>← All visuals</Link></p>
      <VisualPoster v={v} />
      {main && (
        <section className="vz-videos">
          <h2>Watch it change</h2>
          <div className="vz-player"><RacePlayer src={main} poster={videos.poster} title={v.title} /></div>
          {others.length > 0 && (
            <p className="vz-video-links">Also as {others.map((f, i) => <span key={f}>{i ? ' and ' : ''}<a href={videos[f]} target="_blank" rel="noreferrer">{f === '9:16' ? 'vertical (9:16)' : 'landscape (16:9)'}</a></span>)}, for social.</p>
          )}
        </section>
      )}
    </main>
  );
}
