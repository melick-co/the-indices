import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { allExplainers } from '@/lib/explainers';

export const metadata = {
  title: 'Explainers — The Caveat',
  description: 'The terms economists use, written so a general reader can check them.',
};

export default function ExplainersIndex() {
  const items = allExplainers();
  return (
    <>
      <main className="article measure">
        <p className="card-kicker">Explainers</p>
        <h1>What the jargon is actually doing</h1>
        <p className="section-lede">
          Productivity, GDP, bonds, inflation. Regular pieces on the words that
          show up in budgets and press conferences without a definition attached.
        </p>
        <ul className="archive-list">
          {items.map((e) => (
            <li key={e.slug}>
              <Link href={`/explainers/${e.slug}`}>
                <span className="archive-date">{e.kicker}</span>
                {e.title}
              </Link>
              <p>{e.deck}</p>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
