import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { BottomLineEmpty, BottomLineView, IncItemList } from '@/components/AustraliaInc';
import { GovPnlView } from '@/components/dashboard/GovPnl';
import { PnlView } from '@/components/dashboard/Pnl';
import { loadIncItems, loadLatestBottomLine } from '@/lib/australia-inc-loader';
import { loadGovPnl } from '@/lib/gov-pnl';
import { loadPnl } from '@/lib/pnl';
import { IX } from '@/lib/indices-paths';

export const revalidate = 900;

export async function generateMetadata() {
  const bl = await loadLatestBottomLine();
  const description = 'How the country is being run: what government announced and what made news about the nation\'s bottom line, checked against official data.';
  return {
    title: 'Australia Inc. — The Caveat',
    description,
    openGraph: { title: bl?.headline ? `The Bottom Line: ${bl.headline}` : 'Australia Inc. — The Caveat', description },
  };
}

export default async function AustraliaIncSection() {
  const [bl, items, pnl, gov] = await Promise.all([loadLatestBottomLine(), loadIncItems(30), loadPnl().catch(() => null), loadGovPnl().catch(() => null)]);
  return (
    <>
      <div className="inc-page">
        <header className="inc-head">
          <p className="inc-head-flag">A running commentary</p>
          <h1 className="inc-head-name">Australia Inc.</h1>
          <p className="inc-head-dek">How the country is being run, and what it does to the nation&apos;s bottom line.</p>
        </header>

        <div className="inc-grid">
          {bl ? <BottomLineView bl={bl} /> : <BottomLineEmpty />}
          <section className="inc-wire" aria-labelledby="inc-wire-title">
            <h2 id="inc-wire-title" className="inc-section-head">On the wire</h2>
            <p className="inc-section-dek">Government announcements and the news about them, each claim set against the official series where one exists.</p>
            <IncItemList items={items} />
          </section>
        </div>

        <section className="inc-numbers" aria-labelledby="inc-numbers-title">
          <h2 id="inc-numbers-title" className="inc-section-head">The numbers</h2>
          <p className="inc-section-dek">
            The national accounts read as a profit and loss statement. <Link href={IX.pnl}>The full statement on Caveat Indices</Link>
          </p>
        </section>
      </div>
      {pnl ? <div className="inc-pnl"><PnlView d={pnl} /></div> : (
        <p className="inc-empty inc-page">The statement will appear here once the national accounts have loaded.</p>
      )}
      <div className="inc-page">
        <section className="inc-numbers" aria-labelledby="inc-gov-title">
          <h2 id="inc-gov-title" className="inc-section-head">The government&apos;s books</h2>
          <p className="inc-section-dek">
            The Commonwealth&apos;s own profit and loss, with all governments combined beside it. <Link href={IX.pnl}>Both statements on Caveat Indices</Link>
          </p>
        </section>
      </div>
      {gov ? <div className="inc-pnl"><div className="dx dx-embed"><GovPnlView d={gov} /></div></div> : (
        <p className="inc-empty inc-page">The government&apos;s statement will appear here once the government finance statistics have loaded.</p>
      )}
      <SiteFooter />
    </>
  );
}
