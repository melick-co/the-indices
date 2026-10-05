import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Sparkline } from '@/components/dashboard/DashParts';
import type { SectionReading } from '@/lib/economy-dashboard';
import { PARTY_LABEL, ROLE_LABEL, currentMeasure, dayLabel, headToHead, latestByPollster, monthlyTrend, moodCheck, personOf, pollAverage, roleTrend, type Poll, type PollAverage, type Role } from '@/lib/polls';
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
  return d === 0 ? 'unchanged on the month before' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points on the month before`;
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Net approval for whoever holds a role now, averaged across pollsters. */
function netFor(polls: Poll[], role: Role) {
  const m = currentMeasure(polls, 'approval_net', role);
  return m ? { name: personOf(m), a: pollAverage(polls, m) } : null;
}

/** Preferred PM, head-to-head polls only: the PM's and Opposition leader's average shares. */
function preferredPm(polls: Poll[]) {
  const h2h = headToHead(polls);
  const pm = currentMeasure(h2h, 'ppm', 'pm'), opp = currentMeasure(h2h, 'ppm', 'opposition');
  if (!pm || !opp) return null;
  const a = pollAverage(h2h, pm), b = pollAverage(h2h, opp);
  return a && b ? { pm: personOf(pm), opp: personOf(opp), a, b } : null;
}

function LeadersCard({ polls }: { polls: Poll[] }) {
  const pm = netFor(polls, 'pm');
  const opp = netFor(polls, 'opposition');
  const ppm = preferredPm(polls);
  // Other leaders only while pollsters still ask about them: named in one of the three latest approval polls.
  const recent = polls.filter((p) => p.table === 'appr' && !/\bMRP\b/i.test(p.pollster)).slice(0, 3);
  const others = [...new Set(recent.flatMap((p) => Object.keys(p.values).filter((k) => k.startsWith('approval_net:other:')).map(personOf)))]
    .map((name) => ({ name, a: pollAverage(polls, currentMeasure(polls, 'approval_net', 'other', name)!) }))
    .filter((x) => x.a).slice(0, 2);
  return (
    <section className="econ-card polls-card">
      <Link href="/sentiment/polls#leaders" className="econ-card-head">
        <h2>Leaders</h2>
        <span className="econ-card-q">How do voters rate the people who would lead?</span>
      </Link>
      <div className="econ-headline static">
        <span className="econ-headline-label">{pm ? `${pm.name}, ${ROLE_LABEL.pm}: net approval` : 'Net approval'}</span>
        <span className="econ-headline-row">
          <span className="dash-value big">{pm?.a ? signed(pm.a.value) : '—'}</span>
          <Sparkline points={roleTrend(polls, 'approval_net', 'pm').points.slice(-18)} width={140} height={40} />
        </span>
        <span className="econ-headline-meta"><span className="econ-period">{span(pm?.a ?? null)}</span></span>
      </div>
      <ul className="econ-tiles">
        {opp?.a && <li><span className="econ-tile"><span className="econ-tile-label">{opp.name} ({ROLE_LABEL.opposition.toLowerCase()}) net</span><span className="dash-value">{signed(opp.a.value)}</span></span></li>}
        {ppm && <li><span className="econ-tile"><span className="econ-tile-label">Preferred PM: {ppm.pm} v {ppm.opp}</span><span className="dash-value">{ppm.a.value}–{ppm.b.value}</span></span></li>}
        {others.map((o) => <li key={o.name}><span className="econ-tile"><span className="econ-tile-label">{o.name} net</span><span className="dash-value">{signed(o.a!.value)}</span></span></li>)}
      </ul>
    </section>
  );
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

        <LeadersCard polls={polls} />

        <section className="econ-card polls-card polls-check">
          <Link href="/sentiment/consumers" className="econ-card-head">
            <h2>Does the data back the mood?</h2>
            <span className="econ-card-q">The mood against the official numbers households live with</span>
          </Link>
          <span className={`dash-status ${check.verdict === 'backs' ? 'good' : 'watch'}`}>
            {check.verdict === 'backs' ? (check.gloomy ? 'Data backs the gloom' : 'Data backs the optimism') : check.verdict === 'runs-ahead' ? 'Mood runs ahead of the data' : check.verdict === 'unknown' ? 'No reading yet' : 'Partial support'}
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
function directionTitle(right?: number, wrong?: number, period?: string) {
  if (right == null || wrong == null) return 'Direction of the country';
  const when = period ? ` in ${new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : '';
  if (wrong > 50) return `Most voters said the country was heading in the wrong direction${when} (${wrong}%)`;
  if (wrong > right) return `More voters said wrong direction (${wrong}%) than right (${right}%)${when}`;
  if (right > wrong) return `More voters said right direction (${right}%) than wrong (${wrong}%)${when}`;
  return `Voters were split on the direction of the country${when}`;
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
  const tppAvg = pollAverage(polls, 'tpp_alp_lnp');
  const ranked = [...prim].sort((a, b) => b.a!.value - a.a!.value);
  // Within two points is inside a typical poll's margin of error: call it level, not a lead.
  const primTitle = ranked.length < 2 ? 'First preferences'
    : ranked[0].a!.value - ranked[1].a!.value < 2 ? `${PARTY_LABEL[ranked[0].p]} and ${PARTY_LABEL[ranked[1].p]} are neck and neck on first preferences`
      : `${PARTY_LABEL[ranked[0].p]} leads on first preferences`;

  return (
    <>
      <p className="measure">{PRIVATE_NOTE}</p>
      <h2 className="dashboard-section-title">Two-party preferred</h2>
      {tpp.length >= 2 && (
        <StoryChart chart={trendChart(
          tppAvg ? (Math.abs(tppAvg.value - 50) < 1 ? `Labor and the Coalition are level on two-party preferred (${tppAvg.value}–${Math.round((100 - tppAvg.value) * 10) / 10}) across pollsters in the past 30 days`
            : `Labor ${tppAvg.value > 50 ? 'leads' : 'trails'} the Coalition ${tppAvg.value}–${Math.round((100 - tppAvg.value) * 10) / 10} across pollsters in the past 30 days`) : 'Two-party preferred',
          'Labor v Coalition two-party preferred vote, % (monthly average of published polls)',
          { label: 'Labor', points: tpp }, { label: 'Coalition', points: tpp.map((p) => ({ period: p.period, value: Math.round((100 - p.value) * 10) / 10 })) },
        )} />
      )}
      {prim.length > 0 && (
        <StoryChart chart={{
          type: 'chart', kind: 'bars',
          title: primTitle,
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
          directionTitle(right.at(-1)?.value, wrong.at(-1)?.value, right.at(-1)?.period),
          'Share saying the country is heading in the right or wrong direction, % (monthly average of published polls)',
          { label: 'Wrong direction', points: wrong }, { label: 'Right direction', points: right },
        )} />
      )}
      <PollTable polls={dir.slice(0, 12)} direction />

      <LeadersDetail polls={polls} />

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

const holdersText = (h: { name: string; from: string; to: string }[]) =>
  h.length <= 1 ? (h[0]?.name ?? '') : h.map((x) => `${x.name} (${x.from} to ${x.to})`).join(', then ');

function LeadersDetail({ polls }: { polls: Poll[] }) {
  const pm = roleTrend(polls, 'approval_net', 'pm');
  const opp = roleTrend(polls, 'approval_net', 'opposition');
  const appr = polls.filter((p) => p.table === 'appr');
  const ppm = polls.filter((p) => p.table.startsWith('ppm'));
  const pmNow = netFor(polls, 'pm'), oppNow = netFor(polls, 'opposition');
  const months = new Set(opp.points.map((p) => p.period));
  const both = pm.points.filter((p) => months.has(p.period));
  return (
    <>
      <h2 id="leaders" className="dashboard-section-title">Leaders</h2>
      {both.length >= 2 && (
        <StoryChart chart={{
          type: 'chart', kind: 'line',
          title: pmNow?.a && oppNow?.a
            ? `${pmNow.name} is on net ${signed(pmNow.a.value)} and ${oppNow.name} on ${signed(oppNow.a.value)} across pollsters in the past 30 days`
            : 'Net approval of the leaders',
          subtitle: 'Net approval (approve minus disapprove), points: monthly average of published polls',
          series: both.map((p) => ({ label: p.period, value: p.value })),
          alt_series: opp.points.filter((p) => both.some((b) => b.period === p.period)).map((p) => ({ label: p.period, value: p.value })),
          primary_label: ROLE_LABEL.pm, alt_label: ROLE_LABEL.opposition,
          caption: `Prime Minister: ${holdersText(pm.holders)}. Opposition leader: ${holdersText(opp.holders)}. Private polls, compiled via Wikipedia; MRP models excluded.`,
        }} />
      )}
      <h3 className="dashboard-section-title">Latest approval from each pollster</h3>
      <LeaderTable polls={latestByPollster(appr, currentMeasure(appr, 'approval_net', 'pm') ?? '')} prefix="approval_net" />
      <h3 className="dashboard-section-title">Preferred prime minister</h3>
      <LeaderTable polls={ppm.slice(0, 16)} prefix="ppm" />
    </>
  );
}

function LeaderTable({ polls, prefix }: { polls: Poll[]; prefix: string }) {
  const names = [...new Set(polls.flatMap((p) => Object.keys(p.values).filter((k) => k.startsWith(`${prefix}:`))))]
    .sort((a, b) => ['pm', 'opposition', 'other'].indexOf(a.split(':')[1]) - ['pm', 'opposition', 'other'].indexOf(b.split(':')[1]));
  const people = [...new Set(names.map(personOf))];
  const value = (p: Poll, person: string) => {
    const k = Object.keys(p.values).find((x) => x.startsWith(`${prefix}:`) && x.endsWith(`:${person}`));
    return k == null ? '–' : prefix === 'approval_net' ? signed(p.values[k]) : `${p.values[k]}`;
  };
  return (
    <div className="polls-table-wrap">
      <table className="polls-table">
        <thead><tr><th>Fieldwork</th><th>Pollster</th>{people.map((n) => <th key={n}>{n}{prefix === 'approval_net' ? ' net' : ''}</th>)}{prefix === 'ppm' && <th>Unsure</th>}<th>Release</th></tr></thead>
        <tbody>
          {polls.map((p) => (
            <tr key={p.key}>
              <td>{p.start === p.end ? dayLabel(p.end) : `${dayLabel(p.start)} – ${dayLabel(p.end)}`}</td>
              <td>{p.pollster}</td>
              {people.map((n) => <td key={n}>{value(p, n)}</td>)}
              {prefix === 'ppm' && <td>{p.values.ppm_unsure ?? '–'}</td>}
              <td><a href={p.source} className="studio-link" rel="noopener">source</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
