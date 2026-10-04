import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Change, Sparkline, StatusBadge, Value, historyChart, peersChart } from '@/components/dashboard/DashParts';
import { formatReading, periodLabel, type Reading, type SectionReading } from '@/lib/economy-dashboard';
import type { Section } from '@/content/dashboard/economy';

/** Which dashboard a page belongs to: its address and name, for links and breadcrumbs. */
export type DashboardRef = { base: string; name: string };

/** The grid: one card per section, the headline reading large, the rest as tiles. */
export function DashboardView({ dash, kicker, title, intro, sections, legendNote }: {
  dash: DashboardRef; kicker: string; title: string; intro: React.ReactNode; sections: SectionReading[]; legendNote?: React.ReactNode;
}) {
  return (
    <main className="article econ-dash">
      <p className="desk-kicker">{kicker}</p>
      <h1 className="section-head econ-dash-title">{title}</h1>
      <p className="measure econ-dash-intro">{intro}</p>
      <div className="econ-grid">
        {sections.map(({ section, headline, others }) => (
          <section key={section.id} className="econ-card">
            <Link href={`${dash.base}/${section.id}`} className="econ-card-head">
              <h2>{section.title}</h2>
              <span className="econ-card-q">{section.question}</span>
            </Link>
            <Link href={`${dash.base}/${section.id}/${headline.key}`} className="econ-headline">
              <span className="econ-headline-label">{headline.indicator.short ?? headline.indicator.label}</span>
              <span className="econ-headline-row">
                <Value reading={headline} big />
                <Sparkline points={headline.history.slice(-24)} step={headline.indicator.step} width={140} height={40} />
              </span>
              <span className="econ-headline-meta">
                <StatusBadge reading={headline} />
                <Change reading={headline} />
                {headline.latest && <span className="econ-period">{periodLabel(headline.latest.period)}</span>}
              </span>
            </Link>
            <ul className="econ-tiles">
              {others.map((r) => (
                <li key={r.key}>
                  <Link href={`${dash.base}/${section.id}/${r.key}`} className="econ-tile">
                    <span className="econ-tile-label">{r.indicator.short ?? r.indicator.label}</span>
                    <Value reading={r} />
                    <span className={`econ-dot ${r.status}`} title={r.verdict} />
                    <Change reading={r} />
                  </Link>
                </li>
              ))}
              {(section.composites ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/indices/${c.id}`} className="econ-tile composite">
                    <span className="econ-tile-label">{c.label}</span>
                    <span className="econ-composite-tag">Caveat composite →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="ops-quiet-note econ-legend">
        <span className="econ-dot better" /> on target or better
        <span className="econ-dot worse" /> outside target or worse
        <span className="econ-dot neutral" /> neither (a level, not a goal)
        {legendNote && <> · {legendNote}</>}
      </p>
    </main>
  );
}

/** A section: its headline reading in full, then every indicator in it. */
export function SectionView({ dash, reading }: { dash: DashboardRef; reading: SectionReading }) {
  const { section, headline, others } = reading;
  return (
    <main className="article econ-dash">
      <p className="desk-kicker"><Link href={dash.base}>{dash.name}</Link> · {section.title}</p>
      <h1 className="section-head econ-dash-title">{section.question}</h1>
      <Link href={`${dash.base}/${section.id}/${headline.key}`} className="econ-headline econ-headline-wide">
        <span className="econ-headline-label">{headline.indicator.label}</span>
        <span className="econ-headline-row">
          <Value reading={headline} big />
          <Sparkline points={headline.history} step={headline.indicator.step} width={260} height={56} />
        </span>
        <span className="econ-headline-meta"><StatusBadge reading={headline} /><Change reading={headline} /></span>
      </Link>
      <div className="econ-summary">{headline.summary.map((t, i) => <p key={i}>{t}</p>)}</div>
      <p className="econ-why"><strong>Why it matters.</strong> {headline.indicator.why}</p>
      <h2 className="dashboard-section-title">Every indicator in this section</h2>
      <ul className="econ-list">
        {[headline, ...others].map((r) => (
          <li key={r.key}>
            <Link href={`${dash.base}/${section.id}/${r.key}`} className="econ-row">
              <span className="econ-row-label">{r.indicator.label}</span>
              <Value reading={r} />
              <Sparkline points={r.history.slice(-24)} step={r.indicator.step} />
              <StatusBadge reading={r} />
            </Link>
          </li>
        ))}
      </ul>
      {(section.composites ?? []).map((c) => (
        <p key={c.id} className="ops-quiet-note">Caveat composite: <Link href={`/indices/${c.id}`} className="studio-link">{c.label}</Link>, built to the published construction standard.</p>
      ))}
    </main>
  );
}

/** One indicator: what it says, why it matters, what it should be, and the charts. */
export function IndicatorView({ dash, section, r, names }: { dash: DashboardRef; section: Section; r: Reading; names: Map<string, string> }) {
  const b = r.indicator.benchmark;
  const peers = peersChart(r, names);
  return (
    <main className="article econ-dash">
      <p className="desk-kicker">
        <Link href={dash.base}>{dash.name}</Link> · <Link href={`${dash.base}/${section.id}`}>{section.title}</Link>
      </p>
      <h1 className="section-head econ-dash-title">{r.indicator.label}</h1>
      <div className="econ-headline econ-headline-wide static">
        <span className="econ-headline-row"><Value reading={r} big /></span>
        <span className="econ-headline-meta">
          <StatusBadge reading={r} /><Change reading={r} />
          {r.latest && <span className="econ-period">{periodLabel(r.latest.period)}</span>}
        </span>
      </div>
      <h2 className="dashboard-section-title">What the numbers are telling us</h2>
      <div className="econ-summary">{r.summary.map((t, i) => <p key={i}>{t}</p>)}</div>
      <h2 className="dashboard-section-title">Why it matters</h2>
      <p className="measure">{r.indicator.why}</p>
      <h2 className="dashboard-section-title">What it should be</h2>
      <p className="measure">
        {b.kind === 'target' && <>The RBA aims to keep inflation between {b.low} and {b.high} per cent, averaged over time. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
        {b.kind === 'floor' && <>{b.label.charAt(0).toUpperCase() + b.label.slice(1)}. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
        {b.kind === 'average' && <>There is no official target for this measure, so it is judged against its own {r.averageLabel ?? 'long-run average'}{r.average != null ? ` of ${formatReading(r.average, r.indicator.unit)}` : ''}{r.indicator.higherIsBetter === undefined ? ': a higher or lower reading is not in itself better or worse' : `: ${r.indicator.higherIsBetter ? 'higher' : 'lower'} is better`}.</>}
        {b.kind === 'oecd' && <>There is no official target, so Australia is judged against comparable countries: {r.indicator.higherIsBetter ? 'higher' : 'lower'} than the OECD median is better.</>}
        {r.peers && <> The OECD median is {formatReading(r.peers.median, r.peers.unit)}.</>}
      </p>
      {r.history.length >= 2 && <StoryChart chart={historyChart(r)} />}
      {peers && <StoryChart chart={peers} />}
      <p className="ops-quiet-note">
        Every figure on this page is calculated from the stored official series{r.source ? ` (${r.source})` : ''}; the summary is
        written from the numbers, not edited by hand.
      </p>
    </main>
  );
}
