import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import { EXPLAINERS } from '@/content/explainers/seed';
import { explainerBySlug } from '@/lib/explainers';

export function generateStaticParams() {
  return EXPLAINERS.map((e) => ({ slug: e.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const e = explainerBySlug(params.slug);
  return e ? { title: `${e.title} — The Caveat`, description: e.deck } : {};
}

export default function ExplainerPage({ params }: { params: { slug: string } }) {
  const explainer = explainerBySlug(params.slug);
  if (!explainer) notFound();

  return (
    <>
      <main className="article measure">
        <p className="card-kicker">{explainer.kicker}</p>
        <h1>{explainer.title}</h1>
        <p className="lead-deck">{explainer.deck}</p>
        <p className="byline">
          {new Date(explainer.published).toLocaleDateString('en-AU', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
          {' · '}
          {explainer.readMins} min read
        </p>
        {explainer.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 32)}>{p}</p>
            ))}
          </section>
        ))}
        {explainer.further?.length ? (
          <section>
            <h2>Read the source</h2>
            <ul>
              {explainer.further.map((f) => (
                <li key={f.href}>
                  <a href={f.href} target="_blank" rel="noreferrer">{f.label}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="article-end">
          <Link href="/explainers">All explainers</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/">Today&rsquo;s paper</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
