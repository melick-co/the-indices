import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import MarketsDesk from './MarketsDesk';
import { loadMarketWatches, refreshStaleWatches, type MarketWatch } from '@/lib/markets-loader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Markets — Caveat desk' };

export default async function MarketsPage() {
  let watches: MarketWatch[] = [];
  let loadError: string | null = null;
  try {
    watches = await refreshStaleWatches(await loadMarketWatches());
  } catch (e: unknown) {
    loadError = e instanceof Error ? e.message : 'Could not load the desk.';
  }

  return (
    <>
      <main className="article markets-desk">
        <div className="card-kicker">Desk · not published</div>
        <h1>Markets</h1>
        <p className="measure">
          A research bench for raw market series: sovereign yields, equity benchmarks,
          and FX. Watch a print, source the publisher, then propose it for the data
          store. Nothing here is a Caveat figure until it has a named source, a tier,
          and a row in <code>data_sources</code>.
        </p>
        <div className="caveat-box">
          <h3>Scratch, then farm</h3>
          <p style={{ marginBottom: 0 }}>
            Live quotes come from the publisher or a public feed. They can move,
            revise, or vanish. Use them to decide whether a series belongs in the
            store. Do not headline them. The published Australia 10-year already
            lives on{' '}
            <Link href="/indices">Indices</Link>
            {' '}as a Caveat reading.
          </p>
        </div>
        {loadError && <p className="markets-error">{loadError}</p>}
        <MarketsDesk watches={watches} />
      </main>
      <SiteFooter />
    </>
  );
}
