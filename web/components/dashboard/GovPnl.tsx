import StoryChart from '@/components/StoryChart';
import { Icon } from '@/components/dashboard/Icons';
import { GOV_LINES, consecutiveTail, govChange, type GovPnlData } from '@/lib/gov-pnl-core';

const bn = (m: number) => `${m < 0 ? '−' : ''}$${(Math.abs(m) / 1000).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn`;
const opt = (m: number | null | undefined) => (m == null ? '—' : bn(m));
const qWord = (p: string) => { const [y, q] = p.split('-Q'); return `${['March', 'June', 'September', 'December'][Number(q) - 1]} quarter ${y}`; };
const yearTo = (p: string) => `Year to the ${qWord(p)}`;
const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

/** The government's profit and loss: the Commonwealth's statement of operations, with all governments beside it. */
export function GovPnlView({ d }: { d: GovPnlData }) {
  const { end, cwth, all, population, gdp } = d;
  const perPerson = (m: number | null) => (m == null || !population ? '—' : `${m < 0 ? '−' : ''}$${Math.round((Math.abs(m) * 1e6) / population.value).toLocaleString('en-AU')}`);
  const c = cwth.now;
  const borrowWord = (v: number) => (v < 0 ? `borrowed ${bn(-v)}` : `had ${bn(v)} to lend`);
  // The chart compares the years both sectors have, the latest unbroken run (the axis is evenly spaced, so a missing
  // year would close up without showing).
  const both = consecutiveTail(d.years.filter((y) => y.cwthNlb != null && y.allNlb != null));
  const lastAll = [...d.years].reverse().find((y) => y.allNlb != null);
  return (
    <div className="dx-body dx-gov">
      <h2 className="dx-h2">The government&apos;s profit and loss</h2>
      <p className="dx-lead">
        {yearTo(end)}, the Commonwealth government took in {bn(c.revenue)} and spent {bn(c.expense)} on running costs, benefits and grants,
        an operating {c.nob < 0 ? 'deficit' : 'surplus'} of {bn(Math.abs(c.nob))}. After investing in new assets, it {borrowWord(c.nlb)}
        {gdp ? `, ${pct(Math.abs(c.nlb / gdp) * 100)} of GDP` : ''}. All governments together {borrowWord(all.now.nlb)}.
      </p>

      <section className="dx-card dx-span">
        <div className="dx-card-head static">
          <span className="dx-card-icon"><Icon name="bank" size={18} /></span>
          <span className="dx-card-titles"><h2>Income statement</h2><span>{yearTo(end)}, Commonwealth general government, current prices, against the same four quarters a year earlier; all governments combined in the last column</span></span>
        </div>
        <div className="dx-pnl-wrap">
          <table className="dx-pnl dx-pnl-gov">
            <thead>
              <tr><th /><th>This year</th><th>A year earlier</th><th>Change</th><th>Per person</th><th>Share of revenue</th><th><span className="dx-wide">All governments</span><span className="dx-narrow">All govts</span></th></tr>
            </thead>
            <tbody>
              {GOV_LINES.map((l) => {
                if (l.kind === 'sub') return <tr key={l.key} className="sub"><td colSpan={7}>{l.label}</td></tr>;
                const v = l.get(c), p = cwth.prior ? l.get(cwth.prior) : null, a = l.get(all.now);
                const ch = govChange(l, v, p);
                return (
                  <tr key={l.key} className={l.kind === 'bottom' ? 'bottom' : l.kind === 'total' ? 'total' : l.kind === 'less' ? 'less' : ''}>
                    <td>{l.label}{l.note && <small>{l.note}</small>}</td>
                    <td>{opt(v)}</td>
                    <td>{opt(p)}</td>
                    <td className={ch == null ? '' : ch.up ? 'up' : 'down'}>{ch?.text ?? '—'}</td>
                    <td>{perPerson(v)}</td>
                    <td>{v == null ? '—' : `${((Math.abs(v) / c.revenue) * 100).toFixed(1)}%`}</td>
                    <td>{opt(a)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="dx-small dx-pad">
          Revenue and expenses are shown as positive amounts; a negative balance is a deficit or borrowing. Per person uses the estimated resident population at the {population ? qWord(population.period) : 'latest quarter'}{population ? ` (${population.value.toLocaleString('en-AU')})` : ''}.
          Changes are before inflation; for the balances and net investment the change is in dollars.
          {d.allAhead && <> All governments also have the {qWord(d.allAhead.end)}: in the year to then they {borrowWord(d.allAhead.nlb)}.</>}
        </p>
      </section>

      <section className="dx-card dx-span">
        <div className="dx-card-head static">
          <span className="dx-card-icon"><Icon name="trend" size={18} /></span>
          <span className="dx-card-titles"><h2>The fiscal balance over time</h2><span>Net lending (+) or borrowing (−) as a share of GDP, financial years</span></span>
        </div>
        <div className="dx-card-body">
          {both.length >= 2 ? (
            <StoryChart chart={{
              type: 'chart', kind: 'line',
              title: (() => {
                const worst = [...both].sort((x, y) => x.cwthNlb! - y.cwthNlb!)[0];
                const last = both.at(-1)!;
                return `The Commonwealth ${last.cwthNlb! < 0 ? 'borrowed' : 'lent'} ${pct(Math.abs(last.cwthNlb!))} of GDP in ${last.fy}, against ${pct(Math.abs(worst.cwthNlb!))} at the worst, in ${worst.fy}`;
              })(),
              subtitle: 'Net lending (+) / net borrowing (−), % of GDP, financial years',
              series: both.map((y) => ({ label: y.fy, value: y.cwthNlb! })),
              alt_series: both.map((y) => ({ label: y.fy, value: y.allNlb! })),
              primary_label: 'Commonwealth', alt_label: 'All governments',
              caption: 'Source: IMF Quarterly Government Finance Statistics (reported by the Australian authorities); GDP from ABS Australian National Accounts (ANA_INC).',
            }} />
          ) : <p className="dx-small">The history appears once two financial years are loaded.</p>}
          {lastAll && lastAll !== both.at(-1) && lastAll.allNlb != null && (
            <p className="dx-small">All governments, {lastAll.fy}: {lastAll.allNlb < 0 ? 'borrowing' : 'lending'} of {pct(Math.abs(lastAll.allNlb))} of GDP (the Commonwealth&apos;s figures for that year are not complete yet).</p>
          )}
        </div>
      </section>

      <p className="dx-note">
        Government Finance Statistics (GFS), the international standard for government accounts: accrual basis (revenue and expenses when earned or incurred, not when cash moves),
        general government sector only (excluding government-owned businesses such as Australia Post), current prices, original (not seasonally adjusted) quarterly figures, summed over the four quarters to the {qWord(end)}.
        The ABS data API does not carry GFS, so the figures come from the IMF&apos;s data API, as reported by the Australian authorities: the Commonwealth series is compiled monthly and summed to quarters; the all-governments series is quarterly.
        All governments is consolidated: money passed between levels of government, chiefly Commonwealth grants to the states (including GST revenue), is netted out, so the Commonwealth plus the states does not equal the total.
        The two series also classify some lines differently (the Commonwealth&apos;s use of goods and services exceeds all governments&apos; combined), so compare totals and balances across the columns, not individual expense lines.
        Taxes on goods and services are shown with customs duty and other taxes because the Commonwealth series moves most of them into other taxes in each June quarter.
        Before anything is stored, the loader checks every quarter: revenue less expenses equals the net operating balance, and the net operating balance less net investment in non-financial assets equals net lending, within rounding; a quarter that fails is not stored.
      </p>
    </div>
  );
}

export function GovPnlEmpty() {
  return (
    <div className="dx-body dx-gov">
      <h2 className="dx-h2">The government&apos;s profit and loss</h2>
      <p className="dx-small">The government&apos;s statement will appear here once the government finance statistics have loaded.</p>
    </div>
  );
}
