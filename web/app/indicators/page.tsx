import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { INDICATOR_LIST } from '@/lib/rba-rate-indicator';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Indicators — Caveat' };

export default function IndicatorsPage() {
  return (
    <>
      <main className="article">
        <h1>Indicators</h1>
        <p className="measure">
          Derived measures updated from tier 1 and tier 2 sources. Each indicator publishes
          its inputs, method, and caveats. These are not official forecasts.
        </p>
        <div className="cards" style={{ marginTop: '2rem' }}>
          {INDICATOR_LIST.map((ind) => (
            <Link key={ind.id} href={ind.href} className="card">
              <div className="card-kicker">Indicator · Australia</div>
              <h3 className="card-title">{ind.name}</h3>
              <p className="card-hook">{ind.concept}</p>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
