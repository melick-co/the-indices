import Link from 'next/link';
import { notFound } from 'next/navigation';
import StoryChart from '@/components/StoryChart';
import { Change, StatusBadge, Value, historyChart, peersChart } from '@/components/dashboard/DashParts';
import { sectionById } from '@/content/dashboard/economy';
import { formatReading, loadIndicator, periodLabel } from '@/lib/economy-dashboard';
import { createClient } from '@/lib/supabase-server';
import { CPI_ENTITY_NAMES } from '../../../../../agent/scripts/lib/cpi-components.mjs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string; metric: string } }) {
  const section = sectionById(params.id);
  return section ? { title: `${section.title} — Economy dashboard — Caveat` } : {};
}

export default async function IndicatorPage({ params }: { params: { id: string; metric: string } }) {
  const section = sectionById(params.id);
  if (!section) notFound();
  const r = await loadIndicator(section, params.metric);
  if (!r || !r.latest) notFound();
  const b = r.indicator.benchmark;

  const { data: ents } = await createClient().from('entities').select('code, name');
  const names = new Map<string, string>([...Object.entries(CPI_ENTITY_NAMES), ...(ents ?? []).map((e) => [String(e.code).trim(), e.name] as [string, string])]);
  const peers = peersChart(r, names);

  return (
    <main className="article econ-dash">
      <p className="desk-kicker">
        <Link href="/indices">Economy dashboard</Link> · <Link href={`/indices/${section.id}`}>{section.title}</Link>
      </p>
      <h1 className="section-head econ-dash-title">{r.indicator.label}</h1>
      <div className="econ-headline econ-headline-wide static">
        <span className="econ-headline-row"><Value reading={r} big /></span>
        <span className="econ-headline-meta">
          <StatusBadge reading={r} /><Change reading={r} />
          <span className="econ-period">{periodLabel(r.latest.period)}</span>
        </span>
      </div>

      <h2 className="dashboard-section-title">What the numbers are telling us</h2>
      <div className="econ-summary">{r.summary.map((t, i) => <p key={i}>{t}</p>)}</div>

      <h2 className="dashboard-section-title">Why it matters</h2>
      <p className="measure">{r.indicator.why}</p>

      <h2 className="dashboard-section-title">What it should be</h2>
      <p className="measure">
        {b.kind === 'target' && <>The RBA aims to keep inflation between {b.low} and {b.high} per cent, averaged over time. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
        {b.kind === 'floor' && <>{b.label}. <a href={b.source.url} className="studio-link">{b.source.text}</a>.</>}
        {b.kind === 'average' && <>There is no official target for this measure, so it is judged against its own {r.averageYears}-year average{r.average != null ? ` of ${formatReading(r.average, r.indicator.unit)}` : ''}{r.indicator.higherIsBetter === undefined ? ': a higher or lower reading is not in itself better or worse' : `: ${r.indicator.higherIsBetter ? 'higher' : 'lower'} is better`}.</>}
        {r.peers && <> Among OECD countries the median is {formatReading(r.peers.median, r.peers.metric_id === r.indicator.metric_id ? r.indicator.unit : undefined)}.</>}
      </p>

      <StoryChart chart={historyChart(r)} />
      {peers && <StoryChart chart={peers} />}

      <p className="ops-quiet-note">
        Every figure on this page is calculated from the stored official series{r.source ? ` (${r.source})` : ''}; the summary is
        written from the numbers, not edited by hand. Averages use the readings in the window shown.
      </p>
    </main>
  );
}
