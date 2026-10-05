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
  const formats = Object.entries(v.videos ?? {});
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
