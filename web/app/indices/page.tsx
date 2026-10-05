import Link from 'next/link';
import { Change, Trend, compactReading, isPressure, tone, type Tone } from '@/components/dashboard/DashParts';
import { Icon, sectionIcon, type IconName } from '@/components/dashboard/Icons';
import { Hero, Legend, SectionPanel } from '@/components/dashboard/Views';
import { LeadersCard, VotingCard } from '@/components/dashboard/Polls';
import TileBoard, { type TileGroup } from '@/components/indices/TileBoard';
import { QOL_SECTIONS } from '@/content/dashboard/quality-of-life';
import { SENTIMENT_SECTIONS } from '@/content/dashboard/sentiment';
import { loadDashboard, loadEconomyDashboard, periodLabel, type SectionReading } from '@/lib/economy-dashboard';
import { IX } from '@/lib/indices-paths';
import { currentMeasure, loadPolls, personOf, pollAverage, rollingAverage, type Poll } from '@/lib/polls';
import { loadPnl, type PnlData } from '@/lib/pnl';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Indices — Australia on one page',
  description: 'Australia\'s economy, quality of life and public mood on one page: official data, judged against targets, history and other countries.',
};

const bn = (m: number) => `${m < 0 ? '−' : ''}$${(Math.abs(m) / 1000).toFixed(1)}bn`;

/** A small tile: what it measures, the latest value, its status and a sparkline. */
function Tile({ icon, label, value, tone: t, change, period, spark, refValue, badge }: {
  icon: IconName; label: string; value: string; tone: Tone; change?: React.ReactNode; period?: string;
  spark?: { period: string; value: number }[]; refValue?: number | null; badge?: string;
}) {
  return (
    <span className={`ix-tile-body ${t}`}>
      <span className="ix-tile-label"><Icon name={icon} size={13} />{label}{badge && <em>{badge}</em>}</span>
      <span className="ix-tile-value">{value}</span>
      {spark && spark.length >= 2 && <span className="ix-tile-spark"><Trend points={spark} height={30} refValue={refValue} tone={t} /></span>}
      <span className="ix-tile-meta">{change}{period && <span>{period}</span>}</span>
    </span>
  );
}

function sectionTile(r: SectionReading, label?: string) {
  const h = r.headline;
  return (
    <Tile icon={sectionIcon(r.section.id)} label={label ?? h.indicator.short ?? h.indicator.label}
      value={h.latest ? compactReading(h.latest.value, h.indicator.unit, h.indicator.decimals) : '—'} tone={tone(h)}
      change={<Change reading={h} compact />} period={h.latest ? periodLabel(h.latest.period) : undefined}
      spark={h.history.slice(-24)} />
  );
}

function sectionDetail(base: string, name: string, r: SectionReading, full?: { href: string; label: string }) {
  return (
    <>
      <div className="ix-detail-title">
        <h2>{r.section.title}: {r.section.question}</h2>
        <Link href={full?.href ?? `${base}/${r.section.id}`} className="ix-group-link">{full?.label ?? `Open the ${r.section.title.toLowerCase()} page`} →</Link>
      </div>
      <SectionPanel dash={{ base, name }} reading={r} />
    </>
  );
}

function pnlDetail(d: PnlData) {
  const n = d.now;
  const rows: [string, number, string?][] = [
    ['Revenue (GDP)', n.gdp], ['Less: income paid abroad, net', -n.paidAbroad], ['Gross national income', n.gni, 'total'],
    ['Less: depreciation', -n.depreciation], ['Operating profit (net national income)', n.nni, 'total'],
    ['Less: household spending', -n.consumptionHh], ['Less: government spending', -n.consumptionGov], ['Bottom line: net saving', n.saving, 'bottom'],
  ];
  return (
    <>
      <div className="ix-detail-title">
        <h2>Australia Inc.: the country&apos;s profit and loss, year to the {periodLabel(n.end)}</h2>
        <Link href={IX.pnl} className="ix-group-link">The full statement →</Link>
      </div>
      <section className="dx-card dx-card-wide">
        <div className="dx-pnl-wrap">
          <table className="dx-pnl">
            <tbody>
              {rows.map(([label, v, kind]) => (
                <tr key={label} className={kind ?? (v < 0 ? 'less' : '')}><td>{label}</td><td>{bn(v)}</td><td>{((Math.abs(v) / n.gdp) * 100).toFixed(1)}% of revenue</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dx-small dx-pad">The country kept {bn(n.saving)}, {((n.saving / n.gni) * 100).toFixed(1)}% of national income, and borrowed {bn(Math.max(0, -n.currentAccount))} from abroad to fund its investment.</p>
      </section>
    </>
  );
}

export default async function IndicesHome({ searchParams }: { searchParams: { tile?: string } }) {
  const [economy, qol, sentiment, polls, pnl] = await Promise.all([
    loadEconomyDashboard(), loadDashboard(QOL_SECTIONS), loadDashboard(SENTIMENT_SECTIONS), loadPolls(), loadPnl(),
  ]);
  const details: Record<string, React.ReactNode> = {};
  const tiles = (prefix: string, base: string, name: string, readings: SectionReading[]) => readings.map((r) => {
    const id = `${prefix}.${r.section.id}`;
    const people = prefix === 'economy' && r.section.id === 'people';
    details[id] = sectionDetail(base, name, r, people ? { href: IX.population, label: 'The full population page' } : undefined);
    return { id, node: sectionTile(r, people ? 'Population growth' : undefined) };
  });

  const economyTiles = tiles('economy', IX.economy, 'Economy dashboard', economy);
  if (pnl) {
    details.pnl = pnlDetail(pnl);
    economyTiles.push({
      id: 'pnl',
      node: <Tile icon="wallet" label="Australia Inc.: net saving" value={bn(pnl.now.saving)} tone="neutral"
        change={<span className="dash-change">{((pnl.now.saving / pnl.now.gni) * 100).toFixed(1)}% margin</span>} period={`Year to ${periodLabel(pnl.now.end)}`}
        spark={pnl.years.map((y) => ({ period: y.fy, value: y.savingRate }))} />,
    });
  }

  const pollTiles: TileGroup['tiles'] = [];
  const tpp = pollAverage(polls, 'tpp_alp_lnp');
  if (tpp) {
    details['polls.voting'] = <><div className="ix-detail-title"><h2>Voting intention</h2><Link href={IX.polls} className="ix-group-link">Every poll →</Link></div><div className="dx-grid three"><VotingCard polls={polls} /></div></>;
    pollTiles.push({ id: 'polls.voting', node: <Tile icon="ballot" label="Labor two-party preferred" badge="Poll" value={`${tpp.value}%`} tone="neutral"
      change={<span className="dash-change">{Math.abs(tpp.value - 50) < 1 ? 'Level: within the margin' : tpp.value > 50 ? 'Labor ahead' : 'Coalition ahead'}</span>}
      period={`${tpp.n} pollsters`} spark={rollingAverage(polls, 'tpp_alp_lnp')} refValue={50} /> });
  }
  const pmMeasure = currentMeasure(polls, 'approval_net', 'pm');
  const pm = pmMeasure ? pollAverage(polls, pmMeasure) : null;
  if (pm && pmMeasure) {
    details['polls.leaders'] = <><div className="ix-detail-title"><h2>Leaders</h2><Link href={`${IX.polls}#leaders`} className="ix-group-link">Every leadership poll →</Link></div><div className="dx-grid three"><LeadersCard polls={polls as Poll[]} /></div></>;
    pollTiles.push({ id: 'polls.leaders', node: <Tile icon="user" label={`${personOf(pmMeasure)}: net approval`} badge="Poll" value={`${pm.value > 0 ? '+' : ''}${pm.value}`} tone="neutral"
      period={`${pm.n} pollsters`} spark={rollingAverage(polls, pmMeasure)} refValue={0} /> });
  }

  const groups: TileGroup[] = [
    { key: 'economy', title: 'Economy', href: IX.economy, linkLabel: 'Economy dashboard', tiles: economyTiles },
    { key: 'qol', title: 'Quality of life', href: IX.qol, linkLabel: 'Quality of life dashboard', tiles: tiles('qol', IX.qol, 'Quality of life', qol) },
    { key: 'sentiment', title: 'Sentiment & polls', href: IX.sentiment, linkLabel: 'Sentiment & polls dashboard', tiles: [...tiles('sentiment', IX.sentiment, 'Sentiment & polls', sentiment), ...pollTiles] },
  ];

  const all = [...economy, ...qol, ...sentiment].map((r) => r.headline);
  const pressure = all.filter(isPressure).length;
  const good = all.filter((h) => tone(h) === 'good').length;
  return (
    <main className="dx ix-home">
      <Hero kicker="Australia, on one page" title="The Indices"
        intro={<>The economy, quality of life and public mood: official data, judged against targets, history and other countries. Of {all.length} headline readings, {good} are on target or better and {pressure} are under pressure. Click any tile for the detail.</>} />
      <div className="dx-body">
        <TileBoard groups={groups} details={details} initial={searchParams.tile ?? null} />
        <Legend note={<>Tiles marked “Poll” are private polls, shown as context and never as official data.</>} />
      </div>
    </main>
  );
}
