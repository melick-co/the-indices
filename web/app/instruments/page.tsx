import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import InstrumentChart from '@/components/InstrumentChart';
import { loadInstrumentCards } from '@/lib/instruments';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Instruments — Caveat' };

export default async function InstrumentsPage() {
  const cards = await loadInstrumentCards();

  return (
    <>
      <main className="article">
        <div className="card-kicker">Australia · official prints</div>
        <h1>Instruments</h1>
        <p className="measure">
          A compact tape for the home page: debt stock, people, housing, and the
          wage spread. Each card snaps to a named print. Derived run-rates are
          labelled. These are not 0–100 composites — the Household Squeeze Index
          stays on <Link href="/indices">Indices</Link>.
        </p>
        <div className="instrument-grid instrument-grid-page">
          {cards.map((card) => (
            <Link key={card.id} href={`/instruments/${card.id}`} className="instrument-card">
              <div className="dash-name">{card.kicker}</div>
              <h2 className="instrument-card-title">{card.title}</h2>
              <div className="dash-score"><span className="mark on">{card.headline}</span></div>
              <div className="dash-meta">{card.subhead}</div>
              <InstrumentChart card={card} />
              <p className="instrument-hook">{card.hook}</p>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
