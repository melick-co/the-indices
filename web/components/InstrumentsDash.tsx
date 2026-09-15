import Link from 'next/link';
import InstrumentChart from '@/components/InstrumentChart';
import { loadInstrumentCards } from '@/lib/instruments';

export default async function InstrumentsDash() {
  let cards;
  try {
    cards = await loadInstrumentCards();
  } catch {
    return null;
  }
  if (!cards.length) return null;

  return (
    <section className="dash">
      <h2 className="section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Instruments</span>
        <Link href="/instruments" style={{ fontSize: '.7rem' }}>All instruments →</Link>
      </h2>
      <p className="section-lede">
        Official prints on a desk tape. Numbers snap to the last named source.
        Nothing here ticks unless the agency published it.
      </p>
      <div className="instrument-grid">
        {cards.map((card) => (
          <Link key={card.id} href={`/instruments/${card.id}`} className="instrument-card">
            <div className="dash-name">{card.kicker}</div>
            <div className="instrument-card-title">{card.title}</div>
            <div className="dash-score">
              <span className="mark on">{card.headline}</span>
            </div>
            <div className="dash-meta">{card.subhead}</div>
            <InstrumentChart card={card} />
            {card.derivedNote && <div className="instrument-derived">{card.derivedNote}</div>}
          </Link>
        ))}
      </div>
    </section>
  );
}
