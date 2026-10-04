import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Sparkline } from '@/components/dashboard/DashParts';
import type { SectionReading } from '@/lib/economy-dashboard';
import { PARTY_LABEL, dayLabel, latestByPollster, monthlyTrend, moodCheck, pollAverage, type Poll, type PollAverage } from '@/lib/polls';
import type { StoryChartBlock } from '@/lib/story-types';

const PRIVATE_NOTE = 'Private polls: context only, never official data. Compiled from published polls via Wikipedia’s polling tables; every poll links to the release it was reported in. A poll of 1,000 people has a margin of error of about ±3 points.';

function Avg({ a, suffix = '%' }: { a: PollAverage | null; suffix?: string }) {
  return <span className="dash-value big">{a ? `${a.value > 0 && suffix === '' ? '+' : ''}${a.value}${suffix}` : '—'}</span>;
}

const span = (a: PollAverage | null) => (a ? `average of ${a.n} pollster${a.n === 1 ? '' : 's'}, polls ending ${dayLabel(a.from)} to ${dayLabel(a.to)}` : 'no recent polls');

/** Change in a 30-day average against the 30 days before. */
function shift(polls: Poll[], measure: string, a: PollAverage | null) {
  if (!a) return null;
  const before = new Date(new Date(a.to).getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const b = pollAverage(polls, measure, 30, before);
  if (!b) return null;
  const d = Math.round((a.value - b.value) * 10) / 10;
  return d === 0 ? 'unchanged on the month before' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} on the month before`;
}

/** The polls block on the sentiment dashboard: clearly labelled, beside the official numbers that test it. */
export function PollsPanel({ polls, consumers }: { polls: Poll[]; consumers: SectionReading }) {
  const tpp = pollAverage(polls, 'tpp_alp_lnp');
  const tppOnp = pollAverage(polls, 'tpp_alp_onp');
  const net = pollAverage(polls, 'direction_net', 60);
  const wrong = pollAverage(polls, 'direction_wrong', 60);
  const prim = ['alp', 'lnp', 'onp', 'grn', 'oth'].map((p) => ({ p, a: pollAverage(polls, `primary_${p}`) }));
  const check = moodCheck(consumers, net, wrong);
  const tppTrend = monthlyTrend(polls, 'tpp_alp_lnp').slice(-18);
  const netTrend = monthlyTrend(polls, 'direction_net').slice(-18);

  return (
    <section className="polls-block" aria-labelledby="polls-head">
      <div className="polls-head">
        <h2 id="polls-head" className="dashboard-section-title">What the polls say, and whether the numbers back it</h2>
        <span className="polls-private">Private polls · context only</span>
      </div>
      <div className="econ-grid">
        <section className="econ-card polls-card">
          <Link href="/sentiment/polls" className="econ-card-head">
            <h2>Voting intention</h2>
            <span className="econ-card-q">Who would win an election held now?</span>
          </Link>
          <div className="econ-headline static">
            <span className="econ-headline-label">Labor two-party preferred v Coalition</span>
            <span className="econ-headline-row"><Avg a={tpp} /><Sparkline points={tppTrend} width={140} height={40} /></span>
            <span className="econ-headline-meta"><span className="econ-period">{span(tpp)}{shift(polls, 'tpp_alp_lnp', tpp) ? `; ${shift(polls, 'tpp_alp_lnp', tpp)}` : ''}</span></span>
          </div>
          <ul className="econ-tiles">
            {prim.map(({ p, a }) => (
              <li key={p}><span className="econ-tile"><span className="econ-tile-label">{PARTY_LABEL[p]} primary</span><span className="dash-value">{a ? `${a.value}%` : '—'}</span></span></li>
            ))}
            {tppOnp && <li><span className="econ-tile"><span className="econ-tile-label">Labor v One Nation 2PP</span><span className="dash-value">{tppOnp.value}%</span></span></li>}
          </ul>
        </section>

        <section className="econ-card polls-card">
          <Link href="/sentiment/polls#direction" className="econ-card-head">
            <h2>Direction of the country</h2>
            <span className="econ-card-q">Is Australia heading in the right direction?</span>
          </Link>
          <div className="econ-headline static">
            <span className="econ-headline-label">Net right minus wrong direction</span>
            <span className="econ-headline-row"><Avg a={net} suffix="" /><Sparkline points={netTrend} width={140} height={40} /></span>
            <span className="econ-headline-meta"><span className="econ-period">{span(net)}</span></span>
          </div>
          <ul className="econ-tiles">
            <li><span className="econ-tile"><span className="econ-tile-label">Wrong direction</span><span className="dash-value">{wrong ? `${wrong.value}%` : '—'}</span></span></li>
            <li><span className="econ-tile"><span className="econ-tile-label">Right direction</span><span className="dash-value">{(() => { const r = pollAverage(polls, 'direction_right', 60); return r ? `${r.value}%` : '—'; })()}</span></span></li>
          </ul>
        </section>

        <section className="econ-card polls-card polls-check">
          <Link href="/sentiment/consumers" className="econ-card-head">
            <h2>Does the data back the mood?</h2>
            <span className="econ-card-q">The mood against the official numbers households live with</span>
          </Link>
          <span className={`dash-status ${check.verdict === 'backs' ? 'good' : 'watch'}`}>
            {check.verdict === 'backs' ? (check.gloomy ? 'Data backs the gloom' : 'Data backs the optimism') : check.verdict === 'runs-ahead' ? 'Mood runs ahead of the data' : 'Partial support'}
          </span>
          <div className="econ-summary">{check.lines.map((t, i) => <p key={i}>{t}</p>)}</div>
        </section>
      </div>
      <p className="ops-quiet-note">{PRIVATE_NOTE} <Link href="/sentiment/polls" className="studio-link">Every poll →</Link></p>
    </section>
  );
}

function trendChart(title: string, subtitle: string, a: { label: string; points: { period: string; value: number }[] }, b: { label: string; points: { period: string; value: number }[] }): StoryChartBlock {
  return {
    type: 'chart', kind: 'line', title, subtitle,
    series: a.points.map((p) => ({ label: p.period, value: p.value })),
    alt_series: b.points.map((p) => ({ label: p.period, value: p.value })),
    primary_label: a.label, alt_label: b.label,
    caption: 'Monthly average of published polls (by the month fieldwork ended); MRP models excluded. Private polls, compiled via Wikipedia.',
  };
}

/** A title from the latest month's figures, never a fixed claim. */
function directionTitle(right?: number, wrong?: number) {
  if (right == null || wrong == null) return 'Direction of the country';
  if (wrong > 50) return `Most voters say the country is heading in the wrong direction (${wrong}%)`;
  if (wrong > right) return `More voters say wrong direction (${wrong}%) than right (${right}%)`;
  if (right > wrong) return `More voters say right direction (${right}%) than wrong (${wrong}%)`;
  return 'Voters are split on the direction of the country';
}

/** Every poll since the last election, with the trends. */
export function PollsDetail({ polls }: { polls: Poll[] }) {
  const tpp = monthlyTrend(polls, 'tpp_alp_lnp');
  const right = monthlyTrend(polls, 'direction_right');
  const wrong = monthlyTrend(polls, 'direction_wrong');
  const prim = ['alp', 'lnp', 'onp', 'grn', 'oth'].map((p) => ({ p, a: pollAverage(polls, `primary_${p}`) })).filter((x) => x.a);
  const vi = polls.filter((p) => p.table === 'vi');
  const dir = polls.filter((p) => p.table === 'dir');
  const latestTpp = latestByPollster(polls, 'tpp_alp_lnp');
  const lead = tpp.at(-1);

  return (
    <>
      <p className="measure">{PRIVATE_NOTE}</p>
      <h2 className="dashboard-section-title">Two-party preferred</h2>
      {tpp.length >= 2 && (
        <StoryChart chart={trendChart(
          lead ? `Labor ${lead.value >= 50 ? 'leads' : 'trails'} the Coalition ${lead.value}–${Math.round((100 - lead.value) * 10) / 10} in ${new Date(`${lead.period}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })} polls` : 'Two-party preferred',
          'Labor v Coalition two-party preferred vote, % (monthly average of published polls)',
          { label: 'Labor', points: tpp }, { label: 'Coalition', points: tpp.map((p) => ({ period: p.period, value: Math.round((100 - p.value) * 10) / 10 })) },
        )} />
      )}
      {prim.length > 0 && (
        <StoryChart chart={{
          type: 'chart', kind: 'bars',
          title: `${PARTY_LABEL[[...prim].sort((a, b) => b.a!.value - a.a!.value)[0].p]} leads on first preferences`,
          subtitle: `Primary vote, %: average of each pollster's latest poll in the 30 days to ${dayLabel(prim[0].a!.to)}`,
          series: prim.map(({ p, a }) => ({ label: PARTY_LABEL[p], value: a!.value })),
          caption: 'Private polls, compiled via Wikipedia; MRP models excluded.',
        }} />
      )}
      <h3 className="dashboard-section-title">Latest poll from each pollster</h3>
      <PollTable polls={latestTpp} />

      <h2 id="direction" className="dashboard-section-title">Direction of the country</h2>
      {right.length >= 2 && (
        <StoryChart chart={trendChart(
          directionTitle(right.at(-1)?.value, wrong.at(-1)?.value),
          'Share saying the country is heading in the right or wrong direction, % (monthly average of published polls)',
          { label: 'Wrong direction', points: wrong }, { label: 'Right direction', points: right },
        )} />
      )}
      <PollTable polls={dir.slice(0, 12)} direction />

      <h2 className="dashboard-section-title">Every voting-intention poll since the 2025 election</h2>
      <PollTable polls={vi} />
    </>
  );
}

function PollTable({ polls, direction = false }: { polls: Poll[]; direction?: boolean }) {
  const v = (p: Poll, k: string) => (p.values[k] != null ? `${p.values[k]}` : '–');
  return (
    <div className="polls-table-wrap">
      <table className="polls-table">
        <thead>
          <tr>
            <th>Fieldwork</th><th>Pollster</th><th>Client</th>
            {direction ? <><th>Right</th><th>Wrong</th><th>Net</th></> : <><th>2PP ALP</th><th>ALP</th><th>L/NP</th><th>ONP</th><th>GRN</th><th>Oth</th></>}
            <th>Release</th>
          </tr>
        </thead>
        <tbody>
          {polls.map((p) => (
            <tr key={p.key}>
              <td>{p.start === p.end ? dayLabel(p.end) : `${dayLabel(p.start)} – ${dayLabel(p.end)}`}</td>
              <td>{p.pollster}</td><td>{p.client ?? '—'}</td>
              {direction
                ? <><td>{v(p, 'direction_right')}</td><td>{v(p, 'direction_wrong')}</td><td>{v(p, 'direction_net')}</td></>
                : <><td>{v(p, 'tpp_alp_lnp')}</td><td>{v(p, 'primary_alp')}</td><td>{v(p, 'primary_lnp')}</td><td>{v(p, 'primary_onp')}</td><td>{v(p, 'primary_grn')}</td><td>{v(p, 'primary_oth')}</td></>}
              <td><a href={p.source} className="studio-link" rel="noopener">source</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
