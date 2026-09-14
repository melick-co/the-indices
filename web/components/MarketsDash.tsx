import Link from 'next/link';
import { formatChange, formatWatchValue } from '@/lib/market-types';
import { loadMarketWatches } from '@/lib/markets-loader';

/** Compact markets desk teaser for the home page. Uses last stored prints, no live refresh. */
export default async function MarketsDash() {
  let watches;
  try {
    watches = await loadMarketWatches();
  } catch {
    return null;
  }
  const picks = ['Australia 10-year', 'S&P/ASX 200', 'AUD / USD']
    .map((label) => watches.find((w) => w.label === label))
    .filter((w): w is NonNullable<typeof w> => Boolean(w));
  if (!picks.length) return null;

  return (
    <section className="dash">
      <h2 className="section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Markets</span>
        <Link href="/markets" style={{ fontSize: '.7rem' }}>Desk →</Link>
      </h2>
      <div className="dash-grid">
        {picks.map((w) => (
          <Link key={w.watch_id} href="/markets" className="dash-card">
            <div className="dash-name">{w.label}</div>
            <div className="dash-score">
              <span className="mark on">{formatWatchValue(w)}</span>
            </div>
            <div className="dash-meta">{w.org ?? w.provider}</div>
            <div className="dash-foot">
              {formatChange(w.last_change_pct)}
              {w.last_period ? ` · ${w.last_period}` : ''}
              {w.status === 'in_store' ? ' · in the data store' : ' · desk quote'}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
