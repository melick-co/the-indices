import Link from 'next/link';
import { loadRbaRateIndicator } from '@/lib/rba-rate-indicator';

/** Compact RBA indicator panel for the home page. */
export default async function IndicatorDash() {
  let ind;
  try {
    ind = await loadRbaRateIndicator();
  } catch {
    return null;
  }
  if (!ind.market || !ind.fundamentals) return null;

  return (
    <section className="dash">
      <h2 className="section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Indicators</span>
        <Link href="/indicators" style={{ fontSize: '.7rem' }}>All indicators →</Link>
      </h2>
      <div className="dash-grid">
        <Link href="/indicators/rba-rate-rise" className="dash-card">
          <div className="dash-name">RBA rate rise · next meeting</div>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div>
              <div className="dash-meta">Market</div>
              <div className="dash-score">
                <span className="mark on">{ind.market.hike.toFixed(0)}</span>
                <span className="dash-scale">%</span>
              </div>
            </div>
            <div>
              <div className="dash-meta">Model</div>
              <div className="dash-score">
                <span className="mark on">{ind.fundamentals.hike.toFixed(0)}</span>
                <span className="dash-scale">%</span>
              </div>
            </div>
          </div>
          <div className="dash-foot">{ind.meetingLabel}</div>
        </Link>
      </div>
    </section>
  );
}
