import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VisualPoster } from '@/components/visuals/VisualPoster';
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
  // Vertical first: it is the main format for social; the database doesn't keep the order the videos were added in.
  const ORDER = ['9:16', '16:9', '1:1'];
  const formats = Object.entries(v.videos ?? {}).sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return (
    <main className="vz-page">
      <p className="vz-crumb"><Link href={IX.visuals}>← All visuals</Link></p>
      <VisualPoster v={v} />
      {formats.length > 0 && (
        <section className="vz-videos">
          <h2>Watch it change</h2>
          <div className="vz-video-row">{formats.map(([f, url]) => <figure key={f}><video src={url} controls playsInline preload="metadata" /><figcaption>{f}</figcaption></figure>)}</div>
        </section>
      )}
    </main>
  );
}
