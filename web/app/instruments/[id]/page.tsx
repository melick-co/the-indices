import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import InstrumentChart from '@/components/InstrumentChart';
import { loadInstrument } from '@/lib/instruments';
import { formatPeriodLabel } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return [
    { id: 'ags-stock' },
    { id: 'twin-stock' },
    { id: 'debt-denominators' },
    { id: 'population-mix' },
    { id: 'people-per-dwelling' },
    { id: 'housing-tape' },
    { id: 'real-wage-spread' },
    { id: 'interest-as-tax' },
  ];
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const card = await loadInstrument(params.id);
  return { title: card ? `${card.title} — Caveat` : 'Instrument' };
}

export default async function InstrumentPage({ params }: { params: { id: string } }) {
  const card = await loadInstrument(params.id);
  if (!card) notFound();

  return (
    <>
      <main className="article">
        <p className="card-kicker">
          <Link href="/instruments">Instruments</Link> · {card.kicker}
        </p>
        <h1>{card.title}</h1>
        <p className="hero-one">
          <span className="mark">{card.headline}</span>
          <span className="hero-one-label">{card.subhead}</span>
        </p>
        <p className="measure">{card.hook}</p>
        <div className="instrument-hero-chart">
          <InstrumentChart card={card} />
        </div>
        {card.derivedNote && <p className="instrument-derived measure">{card.derivedNote}</p>}
        <div className="caveat-box">
          <b>Caveat</b>
          <p>{card.caveat}</p>
        </div>
        <h2>Series on this card</h2>
        {card.series.map((s) => (
          <section key={s.label} style={{ marginBottom: '1.5rem' }}>
            <h3>{s.label}</h3>
            <p className="dash-meta">{s.unit}</p>
            <table className="data">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="num">Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.points.map((p) => (
                  <tr key={`${s.label}-${p.period}`}>
                    <td>{formatPeriodLabel(p.period)}</td>
                    <td className="num">{p.value.toLocaleString('en-AU')}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {card.volume && (
          <section>
            <h3>{card.volume.label} (volume)</h3>
            <table className="data">
              <thead>
                <tr><th>Period</th><th className="num">Value</th></tr>
              </thead>
              <tbody>
                {card.volume.points.map((p) => (
                  <tr key={p.period}>
                    <td>{formatPeriodLabel(p.period)}</td>
                    <td className="num">{p.value.toLocaleString('en-AU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <h2>Sources</h2>
        <ul className="measure">
          {card.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} rel="noreferrer">{s.org}</a> — {s.note}
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
