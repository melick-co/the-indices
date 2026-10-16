import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import { rubBySlug } from '@/lib/the-rub';

// Columns live in the rubs table now (approved at /foundry/rub), so pages render on request and refresh.
export const revalidate = 900;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const rub = await rubBySlug(params.slug);
  return rub
    ? { title: `${rub.title} — The Rub`, description: rub.paragraphs[0] }
    : {};
}

export default async function TheRubPage({ params }: { params: { slug: string } }) {
  const rub = await rubBySlug(params.slug);
  if (!rub) notFound();

  return (
    <>
      <main className="article measure">
        <p className="card-kicker">Column 8 · The Rub</p>
        <h1>{rub.title}</h1>
        <p className="byline">
          {new Date(rub.published).toLocaleDateString('en-AU', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
        </p>
        {rub.paragraphs.map((p) => (
          <p key={p.slice(0, 32)}>{p}</p>
        ))}
        <p className="article-end">
          <Link href="/the-rub">Every Rub</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/">Today&rsquo;s paper</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
