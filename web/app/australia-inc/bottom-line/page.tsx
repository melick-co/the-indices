import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { listBottomLines } from '@/lib/australia-inc-loader';
import { longDay } from '@/lib/australia-inc';

export const revalidate = 900;
export const metadata = {
  title: 'The Bottom Line: past editions — The Caveat',
  description: 'Every edition of The Bottom Line, the daily brief from Australia Inc.',
};

export default async function BottomLineArchive() {
  const days = await listBottomLines(120);
  return (
    <>
      <main className="article measure">
        <p className="card-kicker"><Link href="/australia-inc">Australia Inc.</Link></p>
        <h1>The Bottom Line</h1>
        <p className="section-lede">
          The daily brief on how the country is being run. Each edition is published only once every figure in it
          has been checked against official data or attributed to the body that announced it.
        </p>
        {days.length ? (
          <ul className="archive-list">
            {days.map((d) => (
              <li key={d.day}>
                <Link href={`/australia-inc/bottom-line/${d.day}`}>
                  <span className="archive-date">{longDay(d.day)}</span>
                  {d.headline}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="section-lede">No editions yet. The first arrives early one morning soon.</p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
