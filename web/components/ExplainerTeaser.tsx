import Link from 'next/link';
import type { Explainer } from '@/content/explainers/seed';

export default function ExplainerTeaser({ explainer }: { explainer: Explainer }) {
  return (
    <article className="explainer-box">
      <p className="explainer-flag">Explainer</p>
      <h2 className="explainer-hed">
        <Link href={`/explainers/${explainer.slug}`}>{explainer.title}</Link>
      </h2>
      <p className="explainer-deck">{explainer.deck}</p>
      <p className="explainer-meta">
        {explainer.readMins} min read
        <span aria-hidden="true"> · </span>
        <Link href="/explainers">All explainers</Link>
      </p>
    </article>
  );
}
