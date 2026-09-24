import Link from 'next/link';
import DialCard from '@/components/DialCard';
import { loadDashboard } from '@/lib/dashboard-indicators';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Indices & indicators — Caveat' };

export default async function IndicesDashboard() {
  const { sections, readings, staleCount } = await loadDashboard();

  return (
    <>
      <main className="article dashboard">
        <p className="desk-kicker">Australia · latest readings</p>
        <h1 className="section-head" style={{ borderBottom: 'none' }}>Indices &amp; indicators</h1>
        <p className="measure">
          Every dial is one series: the latest observation, how it moved on the previous
          print, and the recent history behind it. Colour runs green for low pressure to
          red for high. For income and productivity, green means stronger readings.
        </p>
        <p className="measure">
          Each reading is dated. Australian rates, prices, wages and credit are current to
          the last release; the annual international series sit further back, and
          {staleCount > 0 ? ` ${staleCount} of them are` : ' none are'} flagged with their
          age. Nothing here is estimated forward to fill the gap.
        </p>

        {sections.map((section) => (
          <section key={section.id} className="dashboard-section">
            <h2 className="dashboard-section-title">{section.title}</h2>
            {section.description && (
              <p className="dashboard-section-desc">{section.description}</p>
            )}
            <div className={`dial-grid${section.dials.length === 1 ? ' dial-grid-solo' : ''}`}>
              {section.dials.map((d) => (
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
                  min={d.min}
                  max={d.max}
                  invertScale={d.invertScale}
                  decimals={d.decimals}
                  compact={d.compact}
                  footnote={d.footnote}
                  spark={d.spark}
                  step={d.step}
                  change={d.change}
                  age={d.age}
                />
              ))}
            </div>
          </section>
        ))}

        <div className="dashboard-legend">
          <span className="dashboard-legend-item"><i style={{ background: '#2a9d6e' }} /> Low pressure</span>
          <span className="dashboard-legend-item"><i style={{ background: '#e9b949' }} /> Mid</span>
          <span className="dashboard-legend-item"><i style={{ background: '#c0392b' }} /> High pressure</span>
        </div>

        <h2 id="readings" className="dashboard-section-title">Every reading on this page</h2>
        <p className="measure">
          The same numbers as a table, so a figure can be checked without opening a dial.
          Change is measured on the previous observation in the series.
        </p>
        <table className="data readings-table">
          <thead>
            <tr>
              <th>Series</th>
              <th className="num">Latest</th>
              <th>As at</th>
              <th>Change</th>
              <th>Publisher</th>
              <th>Tier</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.href
                    ? <Link href={r.href} className="readings-link">{r.label}</Link>
                    : r.label}
                </td>
                <td className="num">
                  {r.value}
                  <span className="readings-unit"> {r.unit}</span>
                </td>
                <td className="readings-period">{r.period}</td>
                <td className="readings-change">{r.change}</td>
                <td>{r.source}</td>
                <td>{r.tier ? <span className={`tier t${r.tier}`}>Tier {r.tier}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ marginTop: '2rem', fontSize: '.9rem', color: 'var(--ink-soft)' }}>
          More indices are specified in the{' '}
          <Link href="/methodology" style={{ borderBottom: '1px solid var(--rule)' }}>
            construction standard
          </Link>
          {' '}and will appear here as vintages publish.
        </p>
      </main>
    </>
  );
}
