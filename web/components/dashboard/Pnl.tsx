import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Icon } from '@/components/dashboard/Icons';
import { Hero, tickerStyle } from '@/components/dashboard/Views';
import type { PnlData, Statement } from '@/lib/pnl';

const bn = (m: number) => `${m < 0 ? '−' : ''}$${(Math.abs(m) / 1000).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn`;
const qWord = (p: string) => { const [y, q] = p.split('-Q'); return `${['March', 'June', 'September', 'December'][Number(q) - 1]} quarter ${y}`; };
const yearTo = (p: string) => `Year to the ${qWord(p)}`;

type Line = { key: string; label: string; note?: string; get: (s: Statement) => number; kind?: 'sub' | 'total' | 'bottom' | 'less' | 'plus';
  /** Small lines that can change sign: show the change in dollars, not per cent. */ swing?: boolean };

/** The statement, top to bottom: what the country earns, what it pays out, and what it keeps. */
const LINES: Line[] = [
  { key: 'h1', label: 'Revenue: income earned producing in Australia', get: () => NaN, kind: 'sub' },
  { key: 'coe', label: 'Wages and salaries', note: 'Compensation of employees, including employer super', get: (s) => s.coe },
  { key: 'pp', label: 'Company profits: private businesses', note: 'Gross operating surplus, private non-financial corporations', get: (s) => s.profitsPrivate },
  { key: 'pf', label: 'Company profits: banks and financial firms', get: (s) => s.profitsFinancial },
  { key: 'pg', label: 'Profits of government-owned businesses', get: (s) => s.profitsPublic },
  { key: 'gov', label: 'Government operating surplus', note: 'The depreciation of government assets', get: (s) => s.govSurplus },
  { key: 'homes', label: 'Rental value of owner-occupied homes', note: 'Imputed rent less costs, homes owned by households', get: (s) => s.homes },
  { key: 'small', label: 'Small business and farm income', note: 'Gross mixed income of unincorporated businesses', get: (s) => s.smallBusiness },
  { key: 'tax', label: 'Taxes on production less subsidies', note: 'GST, payroll tax, excise and the like, less subsidies', get: (s) => s.taxes },
  { key: 'sdi', label: 'Statistical discrepancy', get: (s) => s.discrepancy, swing: true },
  { key: 'gdp', label: 'Revenue (gross domestic product)', get: (s) => s.gdp, kind: 'total' },
  { key: 'abroad', label: 'Less: income paid to foreign owners and lenders, net', note: 'Dividends and interest paid abroad less received', get: (s) => -s.paidAbroad, kind: 'less' },
  { key: 'gni', label: 'Gross national income', get: (s) => s.gni, kind: 'total' },
  { key: 'dep', label: 'Less: depreciation', note: 'Wear and tear on buildings, machinery, roads and software', get: (s) => -s.depreciation, kind: 'less' },
  { key: 'nni', label: 'Operating profit (net national income)', get: (s) => s.nni, kind: 'total' },
  { key: 'tr', label: 'Plus: transfers from abroad, net', note: 'Foreign aid, remittances and the like', get: (s) => s.transfers, kind: 'plus', swing: true },
  { key: 'hh', label: 'Less: household spending', get: (s) => -s.consumptionHh, kind: 'less' },
  { key: 'govc', label: 'Less: government spending on services', note: 'Health, education, defence, administration', get: (s) => -s.consumptionGov, kind: 'less' },
  { key: 'sav', label: 'Bottom line: net saving', note: 'What the country keeps after paying its way and replacing worn-out capital', get: (s) => s.saving, kind: 'bottom' },
];

function change(now: number, prior: number | null) {
  if (prior == null || prior === 0 || Number.isNaN(now)) return null;
  return ((now - prior) / Math.abs(prior)) * 100;
}

export function PnlView({ d }: { d: PnlData }) {
  const { now, prior, population } = d;
  const perPerson = (m: number) => (population ? `$${Math.round((m * 1e6) / population.value).toLocaleString('en-AU')}` : '—');
  const margin = (now.saving / now.gni) * 100;
  const funded = Math.round((now.grossSaving / now.investment) * 100);
  const gap = now.investment - now.grossSaving;
  const avg = (k: 'savingRate' | 'currentAccountShare', from: number, to: number) => {
    const ys = d.years.filter((y) => Number(y.fy.slice(0, 4)) + 1 >= from && Number(y.fy.slice(0, 4)) + 1 <= to);
    return ys.length ? ys.reduce((s, y) => s + y[k], 0) / ys.length : null;
  };
  const marginAvg = avg('savingRate', 2010, 2019);
  const tiles = [
    { icon: 'chart' as const, label: 'Revenue (GDP)', value: bn(now.gdp), meta: population ? `${perPerson(now.gdp)} per person` : '' },
    { icon: 'gauge' as const, label: 'Operating profit', value: bn(now.nni), meta: 'after depreciation' },
    { icon: 'wallet' as const, label: 'Bottom line: net saving', value: bn(now.saving), meta: `${margin.toFixed(1)}% of national income` },
    { icon: 'bank' as const, label: 'Borrowed from abroad', value: bn(Math.max(0, -now.currentAccount)), meta: 'current account deficit' },
  ];
  return (
    <main className="dx">
      <Hero kicker={<><Link href="/indices">Economy dashboard</Link> · Australia Inc.</>} title="Australia Inc.: the country's profit and loss"
        intro={<>The national accounts, read as if Australia were one business. {yearTo(now.end)}, the country earned {bn(now.gdp)}, paid {bn(now.paidAbroad)} to foreign owners and lenders, set aside {bn(now.depreciation)} for wear and tear, and spent {bn(now.consumptionHh + now.consumptionGov)}. It kept {bn(now.saving)}: a margin of {margin.toFixed(1)}%{marginAvg != null ? `, against ${marginAvg.toFixed(1)}% on average in the 2010s` : ''}.</>}>
        <div className="dx-ticker" style={tickerStyle(tiles.length)}>
          {tiles.map((t) => (
            <span key={t.label} className="dx-tick neutral"><span className="dx-tick-label"><Icon name={t.icon} size={13} />{t.label}</span><span className="dx-tick-value">{t.value}</span><span className="dx-tick-meta">{t.meta}</span></span>
          ))}
        </div>
      </Hero>

      <div className="dx-body">
        <section className="dx-card dx-span">
          <div className="dx-card-head static">
            <span className="dx-card-icon"><Icon name="chart" size={18} /></span>
            <span className="dx-card-titles"><h2>Income statement</h2><span>{yearTo(now.end)}, current prices, against the same four quarters a year earlier</span></span>
          </div>
          <div className="dx-pnl-wrap">
            <table className="dx-pnl">
              <thead>
                <tr><th /><th>This year</th><th>A year earlier</th><th>Change</th><th>Per person</th><th>Share of revenue</th></tr>
              </thead>
              <tbody>
                {LINES.map((l) => {
                  if (l.kind === 'sub') return <tr key={l.key} className="sub"><td colSpan={6}>{l.label}</td></tr>;
                  const v = l.get(now), p = prior ? l.get(prior) : null;
                  // Costs ("Less:") compare sizes, so a rising cost shows ▲; swing lines show the dollar change.
                  const c = l.kind === 'less' ? change(Math.abs(v), p == null ? null : Math.abs(p)) : l.swing ? null : change(v, p);
                  const dollars = l.swing && p != null ? v - p : null;
                  return (
                    <tr key={l.key} className={l.kind ?? ''}>
                      <td>{l.label}{l.note && <small>{l.note}</small>}</td>
                      <td>{bn(v)}</td>
                      <td>{p != null ? bn(p) : '—'}</td>
                      <td className={c == null ? '' : c >= 0 ? 'up' : 'down'}>{dollars != null ? `${dollars >= 0 ? '+' : '−'}${bn(Math.abs(dollars))}` : c == null ? '—' : `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%`}</td>
                      <td>{l.kind === 'less' ? perPerson(Math.abs(v)) : `${v < 0 ? '−' : ''}${perPerson(Math.abs(v))}`}</td>
                      <td>{((Math.abs(v) / now.gdp) * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="dx-small dx-pad">
            Per person uses the estimated resident population at the {population ? qWord(population.period) : 'latest quarter'} ({population ? population.value.toLocaleString('en-AU') : '—'}).
            Revenue here is value added, not sales: what Australia&apos;s workers, businesses and homes earn after paying for what they buy from each other. Changes are in dollars, before inflation.
          </p>
        </section>

        <div className="dx-grid two">
          <section className="dx-card">
            <div className="dx-card-head static">
              <span className="dx-card-icon"><Icon name="bank" size={18} /></span>
              <span className="dx-card-titles"><h2>Investment and how it was paid for</h2><span>{yearTo(now.end)}</span></span>
            </div>
            <div className="dx-card-body">
              <div className="dx-bridge">
                <div className="dx-bridge-row add"><span className="dx-bridge-label"><span><Icon name="building" size={14} />Investment</span><span className="dx-pchange">new buildings, equipment, software and stock</span></span><span className="dx-bridge-track"><span style={{ width: '100%' }} /></span><span className="dx-bridge-value">{bn(now.investment)}</span></div>
                <div className="dx-bridge-row total"><span className="dx-bridge-label"><span><Icon name="wallet" size={14} />Paid from own saving</span><span className="dx-pchange">net saving plus depreciation set aside</span></span><span className="dx-bridge-track"><span style={{ width: `${Math.min(100, funded)}%` }} /></span><span className="dx-bridge-value">{bn(now.grossSaving)}</span></div>
                <div className="dx-bridge-row sub"><span className="dx-bridge-label"><span><Icon name="bank" size={14} />Borrowed from abroad</span><span className="dx-pchange">the current account deficit</span></span><span className="dx-bridge-track"><span style={{ width: `${Math.max(0, 100 - funded)}%` }} /></span><span className="dx-bridge-value">{bn(gap)}</span></div>
              </div>
              <p className="dx-small">The country paid for {funded}% of its investment from its own saving and borrowed the rest from abroad. The balance of payments puts the current account deficit at {bn(-now.currentAccount)}{Math.abs(-now.currentAccount - gap) > 500 ? `; the two are separate ABS releases and differ by ${bn(Math.abs(-now.currentAccount - gap))}` : ', matching the gap'}.</p>
            </div>
          </section>
          <section className="dx-card">
            <div className="dx-card-head static">
              <span className="dx-card-icon"><Icon name="trend" size={18} /></span>
              <span className="dx-card-titles"><h2>The margin over time</h2><span>Net saving as a share of national income, financial years</span></span>
            </div>
            <div className="dx-card-body">
              {d.years.length >= 2 && (
                <StoryChart chart={{
                  type: 'chart', kind: 'line',
                  title: (() => {
                    const best = [...d.years].sort((a, b) => b.savingRate - a.savingRate)[0];
                    return `The margin was ${d.years.at(-1)!.savingRate.toFixed(1)}% in ${d.years.at(-1)!.fy}, against a high of ${best.savingRate.toFixed(1)}% in ${best.fy}`;
                  })(),
                  subtitle: 'Net national saving as a share of gross national income, %, financial years',
                  series: d.years.map((y) => ({ label: y.fy, value: Math.round(y.savingRate * 10) / 10 })),
                  caption: 'Source: ABS, Australian National Accounts (ANA_AGG, ANA_EXP) and Balance of Payments (BOP).',
                }} />
              )}
            </div>
          </section>
        </div>

        <p className="dx-note">
          Every line is an official ABS figure from the national accounts (ANA_INC, ANA_AGG, ANA_EXP) and the balance of payments (BOP), summed over the four quarters shown, except depreciation, which the ABS data API doesn&apos;t publish at current prices. It is derived from the national income account identity: net saving = gross national income + net transfers from abroad − consumption − depreciation. Before the figures are stored, the loader checks that the income lines sum to GDP and that GDP agrees across the income, expenditure and key-aggregate tables.
        </p>
      </div>
    </main>
  );
}
