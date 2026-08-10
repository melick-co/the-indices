import Link from 'next/link';
import { ALL_INDICES } from '@/content/indices/registry';

/** Compact index panel. Reads the published vintages in the repo, so it needs
 *  no database and stays static. New indices appear automatically. */
export default function IndexDash() {
  if (!ALL_INDICES.length) return null;
  return (
    <section className="dash">
      <h2 className="section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>The indices</span>
        <Link href="/indices" style={{ fontSize: '.7rem' }}>All indices →</Link>
      </h2>
      <div className="dash-grid">
        {ALL_INDICES.map((p) => {
          const scored = p.results.filter((r) => r.scored)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          const aus = scored.find((r) => r.entity === 'AUS');
          const rank = aus ? scored.findIndex((r) => r.entity === 'AUS') + 1 : null;
          const top = scored[0];
          return (
            <Link key={p.index.id} href={`/indices/${p.index.id}`} className="dash-card">
              <div className="dash-name">{p.index.name}</div>
              <div className="dash-score">
                <span className="mark on">{aus?.score ?? '—'}</span>
                <span className="dash-scale">/100</span>
              </div>
              <div className="dash-meta">
                Australia{rank ? `, ${ord(rank)} of ${scored.length}` : ''}
              </div>
              <div className="dash-bar">
                <span style={{ width: `${aus?.score ?? 0}%` }} />
              </div>
              <div className="dash-foot">
                Highest {top?.name} {top?.score} · vintage {p.index.vintage}
              </div>
            </Link>
          );
        })}
        <div className="dash-card dash-soon">
          <div className="dash-name">More coming</div>
          <p className="dash-meta">
            Wealth Concentration, Sovereign Position and Tax Load are specified in the
            construction standard and awaiting their first vintage.
          </p>
          <Link href="/methodology" className="dash-meta" style={{ borderBottom: '1px solid var(--rule)' }}>
            How they are built →
          </Link>
        </div>
      </div>
    </section>
  );
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};
