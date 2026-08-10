import Link from 'next/link';
import Masthead from '@/components/Masthead';
import SiteFooter from '@/components/SiteFooter';
import { ALL_INDICES } from '@/content/indices/registry';

export const metadata = { title: 'Indices — Caveat' };

export default function Indices() {
  return (
    <>
      <Masthead />
      <main className="wrap article">
        <h1>Indices</h1>
        <p className="measure">
          Composite measures built to a published standard. Fixed bounds, equal weights
          unless stated, no imputation, and a sensitivity test published alongside every
          one. A higher score always means greater pressure.
        </p>
        <div className="cards" style={{ marginTop: '2rem' }}>
          {ALL_INDICES.map((p) => {
            const aus = p.results.find((r) => r.entity === 'AUS');
            return (
              <Link key={p.index.id} href={`/indices/${p.index.id}`} className="card">
                <div className="card-kicker">Vintage {p.index.vintage} · {p.index.scale}</div>
                <h3 className="card-title">{p.index.name}</h3>
                <p className="card-hook">{p.index.concept}</p>
                {aus?.score != null && (
                  <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.8rem' }}>
                    Australia <b style={{ fontSize: '1.1rem' }}>{aus.score}</b> / 100
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
