import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { RUBS } from '@/content/the-rub/seed';

export const metadata = {
  title: 'The Rub — The Caveat',
  description: 'Column 8. The truth behind a trending topic.',
};

export default function TheRubIndex() {
  return (
    <>
      <main className="article measure">
        <p className="card-kicker">Column 8</p>
        <h1>The Rub</h1>
        <p className="section-lede">
          A regular column on the thing everyone is talking about, and the
          definition they used too loosely. Pedantic. Checkable.
        </p>
        <ul className="archive-list">
          {RUBS.map((rub) => (
            <li key={rub.slug}>
              <Link href={`/the-rub/${rub.slug}`}>
                <span className="archive-date">{rub.published}</span>
                {rub.title}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
