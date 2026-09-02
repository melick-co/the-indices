import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import DialCard from '@/components/DialCard';
import { loadDashboardDials } from '@/lib/dashboard-indicators';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — Caveat' };

export default async function IndicesDashboard() {
  const dials = await loadDashboardDials();

  return (
    <>
      <main className="article dashboard">
        <div className="card-kicker">Australia · live readings</div>
        <h1>Dashboard</h1>
        <p className="measure">
          Key indices and indicators at a glance. Green is low pressure, amber is mid-range,
          red is high. Click any dial for the full method, inputs, and caveats.
        </p>

        <div className="dial-grid">
          {dials.map((d) => (
            <DialCard
              key={d.id}
              id={d.id}
              href={d.href}
              kicker={d.kicker}
              tier={d.tier}
              label={d.label}
              subtitle={d.subtitle}
              value={d.value}
              unit={d.unit}
              footnote={d.footnote}
            />
          ))}
        </div>

        <div className="dashboard-legend">
          <span className="dashboard-legend-item"><i style={{ background: '#2a9d6e' }} /> Low</span>
          <span className="dashboard-legend-item"><i style={{ background: '#e9b949' }} /> Mid</span>
          <span className="dashboard-legend-item"><i style={{ background: '#c0392b' }} /> High</span>
        </div>

        <p style={{ marginTop: '2rem', fontSize: '.9rem', color: 'var(--ink-soft)' }}>
          More indices are specified in the{' '}
          <Link href="/methodology" style={{ borderBottom: '1px solid var(--rule)' }}>
            construction standard
          </Link>
          {' '}and will appear here as vintages publish.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
