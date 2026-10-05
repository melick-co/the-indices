import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Change, DeviationBar, compactReading, ToneChip, Trend, Value, historyChart, isPressure, peersChart, reference, tone } from '@/components/dashboard/DashParts';
import { Icon, indicatorIcon, sectionIcon } from '@/components/dashboard/Icons';
import { formatReading, periodLabel, type Reading, type SectionReading } from '@/lib/economy-dashboard';
import { sydneyDay } from '@/lib/dates';
import type { Section } from '@/content/dashboard/economy';

/** Which dashboard a page belongs to: its address and name, for links and breadcrumbs. */
export type DashboardRef = { base: string; name: string };

const asOf = () => new Date(`${sydneyDay()}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The navy band at the top of every dashboard page. */
export function Hero({ kicker, title, intro, children }: { kicker: React.ReactNode; title: string; intro?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="dx-hero">
      <div className="dx-hero-top">
        <p className="dx-kicker">{kicker}</p>
        <p className="dx-asof">As at {asOf()} · official data unless labelled</p>
      </div>
      <h1 className="dx-title">{title}</h1>
      {intro && <p className="dx-intro">{intro}</p>}
      {children}
    </header>
  );
}

/** A section's headline number in the hero strip. */
function Ticker({ dash, s }: { dash: DashboardRef; s: SectionReading }) {
  const h = s.headline;
  return (
    <Link href={`${dash.base}/${s.section.id}/${h.key}`} className={`dx-tick ${tone(h)}`}>
      <span className="dx-tick-label"><Icon name={sectionIcon(s.section.id)} size={13} />{h.indicator.short ?? h.indicator.label}</span>
      <span className="dx-tick-value">{h.latest ? compactReading(h.latest.value, h.indicator.unit) : '—'}</span>
      <span className="dx-tick-meta"><Change reading={h} compact />{h.latest && <span>{periodLabel(h.latest.period)}</span>}</span>
    </Link>
  );
}

/** One driver: what feeds the headline, how far it sits from its benchmark, and which way it moved. */
export function DriverRow({ href, r }: { href?: string; r: Reading }) {
  const ref = reference(r);
  const body = (
    <>
      <span className={`dx-driver-icon ${tone(r)}`}><Icon name={indicatorIcon(r.indicator.metric_id)} size={15} /></span>
      <span className="dx-driver-label">
        {r.indicator.short ?? r.indicator.label}
        <span className="dx-driver-ref">{ref ? `vs ${ref.label}` : r.verdict}</span>
      </span>
      <DeviationBar reading={r} />
      <span className="dx-driver-value">{r.latest ? compactReading(r.latest.value, r.indicator.unit) : '—'}</span>
      <span className="dx-driver-change"><Change reading={r} compact /></span>
    </>
  );
  return href ? <Link href={href} className={`dx-driver ${tone(r)}`}>{body}</Link> : <div className={`dx-driver ${tone(r)}`}>{body}</div>;
}

function SectionCard({ dash, s }: { dash: DashboardRef; s: SectionReading }) {
  const { section, headline: h, others } = s;
  const ref = reference(h);
  const b = h.indicator.benchmark;
  const pressure = others.filter(isPressure).length;
  return (
    <section className="dx-card">
      <Link href={`${dash.base}/${section.id}`} className="dx-card-head">
        <span className="dx-card-icon"><Icon name={sectionIcon(section.id)} size={18} /></span>
        <span className="dx-card-titles"><h2>{section.title}</h2><span>{section.question}</span></span>
        {others.length > 0 && <span className={`dx-pressure ${pressure ? 'on' : ''}`}>{pressure} of {others.length} under pressure</span>}
      </Link>
      <Link href={`${dash.base}/${section.id}/${h.key}`} className="dx-headline">
        <span className="dx-headline-label">{h.indicator.short ?? h.indicator.label}{h.latest && <span className="dx-period">{periodLabel(h.latest.period)}</span>}</span>
        <span className="dx-headline-row">
          <span className="dx-big">{h.latest ? formatReading(h.latest.value, h.indicator.unit) : '—'}</span>
          <span className="dx-headline-side"><ToneChip reading={h} /><Change reading={h} /></span>
        </span>
        <Trend points={h.history.slice(-36)} step={h.indicator.step} refValue={b.kind === 'target' ? null : ref?.value} tone={tone(h)}
          band={b.kind === 'target' ? [b.low, b.high] : undefined} refLabel={ref?.label} />
        {ref && <span className="dx-reflabel"><span className={`dx-refkey ${b.kind === 'target' ? 'band' : ''}`} />{ref.label}</span>}
      </Link>
      {others.length > 0 && (
        <div className="dx-drivers">
          <p className="dx-drivers-head">What&apos;s driving it</p>
          {others.map((r) => <DriverRow key={r.key} href={`${dash.base}/${section.id}/${r.key}`} r={r} />)}
          {(section.composites ?? []).map((c) => (
            <Link key={c.id} href={`/indices/${c.id}`} className="dx-composite"><Icon name="chart" size={14} />{c.label}: Caveat composite →</Link>
          ))}
        </div>
      )}
    </section>
  );
}

export const Legend = ({ note }: { note?: React.ReactNode }) => (
  <p className="dx-legend">
    <span><i className="dx-key good" />On target or better than usual</span>
    <span><i className="dx-key bad" />Worse than usual</span>
    <span><i className="dx-key watch" />Outside the target band</span>
    <span><i className="dx-key neutral" />A level, neither better nor worse</span>
    <span className="dx-legend-note">Bars show how far each reading sits from its benchmark: left of centre below it, right above it.{note ? <> {note}</> : null}</span>
  </p>
);

/** The grid: one card per section, the headline reading large, the drivers beneath. */
export function DashboardView({ dash, kicker, title, intro, sections, legendNote, children }: {
  dash: DashboardRef; kicker: string; title: string; intro: React.ReactNode; sections: SectionReading[]; legendNote?: React.ReactNode;
  /** Anything below the grid (the sentiment dashboard's polls). */
  children?: React.ReactNode;
}) {
  return (
    <main className="dx">
      <Hero kicker={kicker} title={title} intro={intro}>
        {/* Up to six tiles in one row; more split into two even rows (8 → 4 + 4, 7 → 4 + 3). */}
        <div className="dx-ticker" style={{ '--cols': sections.length <= 6 ? sections.length : Math.ceil(sections.length / 2) } as React.CSSProperties}>
          {sections.map((s) => <Ticker key={s.section.id} dash={dash} s={s} />)}
        </div>
      </Hero>
      <div className="dx-body">
        <div className="dx-grid">{sections.map((s) => <SectionCard key={s.section.id} dash={dash} s={s} />)}</div>
        {children}
        <Legend note={legendNote} />
      </div>
    </main>
  );
}

/** A section: its headline reading in full, then every indicator in it. */
export function SectionView({ dash, reading }: { dash: DashboardRef; reading: SectionReading }) {
  const { section, headline: h, others } = reading;
  const ref = reference(h);
  const b = h.indicator.benchmark;
  return (
    <main className="dx">
      <Hero kicker={<><Link href={dash.base}>{dash.name}</Link> · {section.title}</>} title={section.question} />
      <div className="dx-body">
        <section className="dx-card dx-card-wide">
          <Link href={`${dash.base}/${section.id}/${h.key}`} className="dx-card-head">
            <span className="dx-card-icon"><Icon name={sectionIcon(section.id)} size={18} /></span>
            <span className="dx-card-titles"><h2>{h.indicator.label}</h2><span>{h.latest ? periodLabel(h.latest.period) : ''}</span></span>
          </Link>
          <div className="dx-headline static">
            <span className="dx-headline-row">
              <span className="dx-big">{h.latest ? formatReading(h.latest.value, h.indicator.unit) : '—'}</span>
              <span className="dx-headline-side"><ToneChip reading={h} /><Change reading={h} /></span>
            </span>
            <Trend points={h.history} step={h.indicator.step} height={110} refValue={b.kind === 'target' ? null : ref?.value} tone={tone(h)}
              band={b.kind === 'target' ? [b.low, b.high] : undefined} />
            {ref && <span className="dx-reflabel"><span className={`dx-refkey ${b.kind === 'target' ? 'band' : ''}`} />{ref.label}</span>}
          </div>
          <div className="dx-summary">{h.summary.map((t, i) => <p key={i}>{t}</p>)}</div>
          <p className="dx-why"><strong>Why it matters.</strong> {h.indicator.why}</p>
        </section>
        {others.length > 0 && (
          <section className="dx-card dx-card-wide">
            <div className="dx-card-head static">
              <span className="dx-card-icon"><Icon name="chart" size={18} /></span>
              <span className="dx-card-titles"><h2>What&apos;s driving it</h2><span>{others.filter(isPressure).length} of {others.length} under pressure</span></span>
            </div>
            <div className="dx-drivers">{others.map((r) => <DriverRow key={r.key} href={`${dash.base}/${section.id}/${r.key}`} r={r} />)}</div>
          </section>
        )}
        {(section.composites ?? []).map((c) => (
          <p key={c.id} className="dx-note">Caveat composite: <Link href={`/indices/${c.id}`} className="studio-link">{c.label}</Link>, built to the published construction standard.</p>
        ))}
        <Legend />
      </div>
    </main>
  );
}

/** One indicator: what it says, why it matters, what it should be, and the charts. */
export function IndicatorView({ dash, section, r, names }: { dash: DashboardRef; section: Section; r: Reading; names: Map<string, string> }) {
  const b = r.indicator.benchmark;
  const peers = peersChart(r, names);
  const ref = reference(r);
  return (
    <main className="dx">
      <Hero kicker={<><Link href={dash.base}>{dash.name}</Link> · <Link href={`${dash.base}/${section.id}`}>{section.title}</Link></>} title={r.indicator.label}>
        <div className="dx-hero-reading">
          <span className="dx-hero-icon"><Icon name={indicatorIcon(r.indicator.metric_id)} size={22} /></span>
          <span className="dx-hero-value"><Value reading={r} big /></span>
          <ToneChip reading={r} />
          <span className="dx-hero-change"><Change reading={r} /></span>
          {r.latest && <span className="dx-hero-period">{periodLabel(r.latest.period)}</span>}
          {ref && <span className="dx-hero-period">vs {ref.label}</span>}
        </div>
      </Hero>
      <div className="dx-body dx-article">
        <h2 className="dx-h2">What the numbers are telling us</h2>
        <div className="dx-summary">{r.summary.map((t, i) => <p key={i}>{t}</p>)}</div>
        <h2 className="dx-h2">Why it matters</h2>
        <p>{r.indicator.why}</p>
        <h2 className="dx-h2">What it should be</h2>
        <p>
          {b.kind === 'target' && <>The RBA aims to keep inflation between {b.low} and {b.high} per cent, averaged over time. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
          {b.kind === 'floor' && <>{b.label.charAt(0).toUpperCase() + b.label.slice(1)}. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
          {b.kind === 'average' && <>There is no official target for this measure, so it is judged against its own {r.averageLabel ?? 'long-run average'}{r.average != null ? ` of ${formatReading(r.average, r.indicator.unit)}` : ''}{r.indicator.higherIsBetter === undefined ? ': a higher or lower reading is not in itself better or worse' : `: ${r.indicator.higherIsBetter ? 'higher' : 'lower'} is better`}.</>}
          {b.kind === 'oecd' && <>There is no official target, so Australia is judged against comparable countries: {r.indicator.higherIsBetter ? 'higher' : 'lower'} than the OECD median is better.</>}
          {r.peers && <> The OECD median is {formatReading(r.peers.median, r.peers.unit)}.</>}
        </p>
        {r.history.length >= 2 && <StoryChart chart={historyChart(r)} />}
        {peers && <StoryChart chart={peers} />}
        <p className="dx-note">
          Every figure on this page is calculated from the stored official series{r.source ? ` (${r.source})` : ''}; the summary is
          written from the numbers, not edited by hand.
        </p>
      </div>
    </main>
  );
}
