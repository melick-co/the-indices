import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import InputSeriesChart from '@/components/InputSeriesChart';
import { loadRbaRateIndicator } from '@/lib/rba-rate-indicator';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'RBA rate rise indicator — Caveat' };

export default async function RbaRateIndicatorPage() {
  const ind = await loadRbaRateIndicator();
  const hasData = ind.market && ind.fundamentals;

  return (
    <>
      <main className="article">
        <div className="card-kicker">Indicator · next RBA Board meeting</div>
        <h1>Likelihood of a rate rise at the next RBA meeting</h1>
        <p className="measure">
          Two estimates for a <b>25 basis point</b> increase to the cash rate target at the
          {' '}{ind.meetingLabel}. Market-implied odds come from ASX interbank futures;
          the fundamentals model uses inflation, real rates, and credit growth. Neither is
          an RBA forecast.
        </p>

        {!hasData && (
          <div className="caveat-box">
            <h3>Waiting for first compute run</h3>
            <p style={{ marginBottom: 0 }}>
              Run <code style={{ fontSize: '.8rem' }}>node scripts/compute-rba-rate-indicator.mjs</code>
              {' '}in <code style={{ fontSize: '.8rem' }}>agent/</code> after RBA sources load,
              or wait for the nightly GitHub Action.
            </p>
          </div>
        )}

        {hasData && (
          <>
            <div className="indicator-dual" style={{ display: 'grid', gap: '1.5rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', margin: '2rem 0' }}>
              <ProbCard
                title="Market-implied"
                tier="Tier 2 · ASX futures"
                probs={ind.market!}
                highlight={ind.market!.hike}
              />
              <ProbCard
                title="Fundamentals model"
                tier="Tier 1/2 inputs · derived"
                probs={ind.fundamentals!}
                highlight={ind.fundamentals!.hike}
              />
            </div>

            {(ind.market!.hike - ind.fundamentals!.hike) > 15 ||
              (ind.fundamentals!.hike - ind.market!.hike) > 15 ? (
              <div className="caveat-box">
                <h3>The rub</h3>
                <p style={{ marginBottom: 0 }}>
                  Market and model diverge by{' '}
                  {Math.abs(ind.market!.hike - ind.fundamentals!.hike).toFixed(0)} percentage
                  points on a hike. That gap is worth investigating: markets may be pricing
                  something the model omits (global shocks, guidance, liquidity), or the model
                  may be flagging pressure the futures curve has not caught up to.
                </p>
              </div>
            ) : null}

            <h2>Inputs · past twelve months</h2>
            <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem', marginBottom: '1rem' }}>
              Each series in its own panel. Cash rate is a step series (holds between RBA decisions);
              credit is monthly; CPI may update annually.
            </p>
            <div className="input-chart-grid">
              {ind.inputSeries.map((s) => (
                <InputSeriesChart
                  key={s.metricId}
                  title={s.title}
                  role={s.role}
                  subtitle={s.subtitle}
                  unit={s.unit}
                  points={s.points}
                  step={s.step}
                  latest={s.latest}
                />
              ))}
            </div>

            <h2>Method</h2>
            <h3>Market-implied</h3>
            <p>
              Uses the ASX 30-day interbank cash rate futures contract for the meeting month.
              The futures price implies an average overnight cash rate over the calendar month.
              We solve for hike, hold, and cut probabilities assuming 25bp steps, accounting
              for the fraction of the month before and after the Board announcement (ASX rate
              tracker methodology).
            </p>
            {ind.marketBasis && (
              <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem',
                color: 'var(--ink-soft)' }}>{ind.marketBasis}</p>
            )}

            <h3>Fundamentals model</h3>
            <p>
              A derived score from three signals: CPI relative to the midpoint of the 2–3%
              target band, the real cash rate (nominal minus CPI), and twelve-month housing
              credit growth. The score maps to hike/hold/cut probabilities via a logistic
              function. This is a transparent heuristic, not an econometric forecast.
            </p>
            {ind.fundamentalsBasis && (
              <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem',
                color: 'var(--ink-soft)' }}>{ind.fundamentalsBasis}</p>
            )}

            <div className="caveat-box">
              <h3>Caveats</h3>
              <ul style={{ marginBottom: 0, paddingLeft: '1.2rem', lineHeight: 1.6 }}>
                <li>Market-implied odds can move intraday; thin liquidity around holidays adds noise.</li>
                <li>Assumes the next move, if any, is 25bp. Larger moves are not modelled separately.</li>
                <li>Fundamentals model ignores RBA forward guidance and global factors.</li>
                <li>CPI may lag; OECD annual inflation is used when ABS monthly is unavailable.</li>
              </ul>
            </div>
          </>
        )}

        <p style={{ marginTop: '2rem' }}>
          <Link href="/indicators">← All indicators</Link>
          {' · '}
          <Link href="/foundry/work/start?intent=investigate&prompt=Investigate%20the%20gap%20between%20market-implied%20and%20fundamentals-based%20RBA%20rate%20expectations">
            Investigate in Foundry →
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function ProbCard({
  title,
  tier,
  probs,
  highlight,
}: {
  title: string;
  tier: string;
  probs: { hike: number; hold: number; cut: number };
  highlight: number;
}) {
  return (
    <div className="indicator-card" style={{ border: '1px solid var(--rule)', padding: '1.2rem' }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem',
        letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
        {title}
      </div>
      <div style={{ fontSize: '.72rem', color: 'var(--ink-soft)', margin: '.35rem 0 .8rem' }}>{tier}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', marginBottom: '1rem' }}>
        <span className="mark on" style={{ fontSize: '2.4rem' }}>{highlight.toFixed(0)}</span>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.85rem' }}>% hike</span>
      </div>
      <ProbBar label="Hike +25bp" value={probs.hike} color="var(--pen)" />
      <ProbBar label="Hold" value={probs.hold} color="var(--ink)" />
      <ProbBar label="Cut −25bp" value={probs.cut} color="var(--verify)" />
    </div>
  );
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem', marginBottom: '.2rem' }}>
        <span>{label}</span>
        <span>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--rule)' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, value)}%`, background: color }} />
      </div>
    </div>
  );
}
