import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import { BottomLineView } from '@/components/AustraliaInc';
import { loadBottomLine } from '@/lib/australia-inc-loader';
import { longDay } from '@/lib/australia-inc';

export const revalidate = 900;

export async function generateMetadata({ params }: { params: { day: string } }) {
  const bl = await loadBottomLine(params.day);
  return bl ? { title: `The Bottom Line, ${longDay(bl.day)} — The Caveat`, description: bl.headline ?? undefined, openGraph: { title: `The Bottom Line: ${bl.headline}` } } : {};
}

export default async function BottomLineEdition({ params }: { params: { day: string } }) {
  const bl = await loadBottomLine(params.day);
  if (!bl) notFound();
  return (
    <>
      <div className="inc-page inc-edition">
        <p className="card-kicker"><Link href="/australia-inc">Australia Inc.</Link></p>
        <BottomLineView bl={bl} heading="h1" />
        {bl.items.length > 0 && (
          <section className="inc-sources">
            <h2 className="inc-section-head">Drawn from</h2>
            <ul>
              {bl.items.map((i) => (
                <li key={i.url}><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>{i.publisher ? `, ${i.publisher}` : ''}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
