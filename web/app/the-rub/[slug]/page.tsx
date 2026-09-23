import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import { RUBS } from '@/content/the-rub/seed';
import { rubBySlug } from '@/lib/the-rub';

export function generateStaticParams() {
  return RUBS.map((r) => ({ slug: r.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const rub = rubBySlug(params.slug);
  return rub
    ? { title: `${rub.title} — The Rub`, description: rub.paragraphs[0] }
    : {};
}

export default function TheRubPage({ params }: { params: { slug: string } }) {
  const rub = rubBySlug(params.slug);
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
