import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Trend } from '@/components/dashboard/DashParts';
import { Icon } from '@/components/dashboard/Icons';
import { DriverRow } from '@/components/dashboard/Views';
import type { SectionReading } from '@/lib/economy-dashboard';
import {
  PARTY_LABEL, ROLE_LABEL, ageDays, currentMeasure, dayLabel, headToHead, latestByPollster, monthlyTrend, moodCheck, personOf,
  pollAverage, roleTrend, rollingAverage, type Poll, type PollAverage, type Role,
} from '@/lib/polls';
import type { StoryChartBlock } from '@/lib/story-types';

const PRIVATE_NOTE = 'Private polls: context only, never official data. Compiled from published polls via Wikipedia’s polling tables; every poll links to the release it was reported in. A poll of 1,000 people has a margin of error of about ±3 points.';

/** Party colours as the parties use them, for bars only (never to imply good or bad). */
const PARTY_COLOUR: Record<string, string> = { alp: '#d62b38', lnp: '#1f4e9e', onp: '#f07f1e', grn: '#2f9e44', oth: '#8a94a6' };

const span = (a: PollAverage | null) => (a ? `${a.n} pollster${a.n === 1 ? '' : 's'}, polls ending ${dayLabel(a.from)} to ${dayLabel(a.to)}` : 'no recent polls');
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Change in a 30-day average against the 30 days before. */
function shift(polls: Poll[], measure: string, a: PollAverage | null) {
  if (!a) return null;
  const before = new Date(new Date(a.to).getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const b = pollAverage(polls, measure, 30, before);
  if (!b) return null;
  const d = Math.round((a.value - b.value) * 10) / 10;
  return d === 0 ? 'unchanged on the month before' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts on the month before`;
}

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

/** Two (or three) shares side by side in one bar, labelled. */
function SplitBar({ parts }: { parts: { label: string; value: number; colour: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="dx-split">
      <div className="dx-split-bar">
        {parts.map((p) => <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.colour }} title={`${p.label} ${p.value}%`} />)}
      </div>
      <div className="dx-split-labels">
        {parts.map((p) => <span key={p.label}><i style={{ background: p.colour }} />{p.label} <b>{p.value}%</b></span>)}
      </div>
    </div>
  );
}

/** Net approval on a −50 to +50 scale, bar from the centre. */
function NetBar({ label, sub, value }: { label: string; sub?: string; value: number }) {
  const w = Math.min(50, Math.abs(value)) ;
  return (
    <div className="dx-net">
      <span className="dx-net-label">{label}{sub && <small>{sub}</small>}</span>
      <span className="dx-net-track">
        <span className={`dx-net-fill ${value < 0 ? 'neg' : 'pos'}`} style={value < 0 ? { right: '50%', width: `${w}%` } : { left: '50%', width: `${w}%` }} />
        <span className="dx-dev-mid" />
      </span>
      <span className={`dx-net-value ${value < 0 ? 'neg' : 'pos'}`}>{signed(value)}</span>
    </div>
  );
}

function CardHead({ icon, title, sub, href }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; href: string }) {
  return (
    <Link href={href} className="dx-card-head">
      <span className="dx-card-icon"><Icon name={icon} size={18} /></span>
      <span className="dx-card-titles"><h2>{title}</h2><span>{sub}</span></span>
    </Link>
  );
}

function VotingCard({ polls }: { polls: Poll[] }) {
  const tpp = pollAverage(polls, 'tpp_alp_lnp');
  const onp = pollAverage(polls, 'tpp_alp_onp');
  const prim = ['alp', 'onp', 'lnp', 'grn', 'oth'].map((p) => ({ p, a: pollAverage(polls, `primary_${p}`) })).filter((x) => x.a).sort((a, b) => b.a!.value - a.a!.value);
  const top = Math.max(...prim.map((x) => x.a!.value), 1);
  const level = tpp && Math.abs(tpp.value - 50) < 1;
  return (
    <section className="dx-card dx-private">
      <CardHead icon="ballot" title="Voting intention" sub="Who would win an election held now?" href="/sentiment/polls" />
      <div className="dx-headline static">
        <span className="dx-headline-label">Labor two-party preferred v Coalition</span>
        <span className="dx-headline-row">
          <span className="dx-big">{tpp ? `${tpp.value}%` : '—'}</span>
          <span className="dx-headline-side">
            {tpp && <span className="dx-chip neutral">{level ? 'Level: within the margin' : tpp.value > 50 ? 'Labor ahead' : 'Coalition ahead'}</span>}
            <span className="dash-change">{shift(polls, 'tpp_alp_lnp', tpp)}</span>
          </span>
        </span>
        {tpp && <SplitBar parts={[{ label: 'Labor', value: tpp.value, colour: PARTY_COLOUR.alp }, { label: 'Coalition', value: Math.round((100 - tpp.value) * 10) / 10, colour: PARTY_COLOUR.lnp }]} />}
        <Trend points={rollingAverage(polls, 'tpp_alp_lnp')} refValue={50} height={56} />
        <span className="dx-reflabel"><span className="dx-refkey" />50: dead heat · 30-day average across pollsters, by week · {span(tpp)}</span>
      </div>
      <div className="dx-drivers">
        <p className="dx-drivers-head">First preferences</p>
        {prim.map(({ p, a }) => (
          <div key={p} className="dx-party">
            <span className="dx-party-name"><i style={{ background: PARTY_COLOUR[p] }} />{PARTY_LABEL[p]}</span>
            <span className="dx-party-track"><span style={{ width: `${(a!.value / top) * 100}%`, background: PARTY_COLOUR[p] }} /></span>
            <span className="dx-party-value">{a!.value}%</span>
          </div>
        ))}
        {onp && <p className="dx-small">Labor v One Nation, two-party: <b>{onp.value}–{Math.round((100 - onp.value) * 10) / 10}</b></p>}
      </div>
    </section>
  );
}

function DirectionCard({ polls }: { polls: Poll[] }) {
  const net = pollAverage(polls, 'direction_net', 60);
  const right = pollAverage(polls, 'direction_right', 60);
  const wrong = pollAverage(polls, 'direction_wrong', 60);
  const age = net ? ageDays(net.to) : null;
  return (
    <section className="dx-card dx-private">
      <CardHead icon="compass" title="Direction of the country" sub="Is Australia heading in the right direction?" href="/sentiment/polls#direction" />
      <div className="dx-headline static">
        <span className="dx-headline-label">Net: right minus wrong direction</span>
        <span className="dx-headline-row">
          <span className={`dx-big ${net && net.value < 0 ? 'neg' : ''}`}>{net ? signed(net.value) : '—'}</span>
          <span className="dx-headline-side">{age != null && age > 31 && <span className="dx-chip watch"><Icon name="alert" size={11} /> Latest poll {Math.round(age / 30)} months old</span>}</span>
        </span>
        {right && wrong && (
          <SplitBar parts={[
            { label: 'Right', value: right.value, colour: '#2f9e44' },
            { label: 'Unsure', value: Math.max(0, Math.round((100 - right.value - wrong.value) * 10) / 10), colour: '#c3cad6' },
            { label: 'Wrong', value: wrong.value, colour: '#c0392b' },
          ]} />
        )}
        <Trend points={rollingAverage(polls, 'direction_net', 60)} refValue={0} height={56} />
        <span className="dx-reflabel"><span className="dx-refkey" />0: as many say right as wrong · {span(net)}</span>
      </div>
    </section>
  );
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
  const pmMeasure = currentMeasure(polls, 'approval_net', 'pm');
  return (
    <section className="dx-card dx-private">
      <CardHead icon="user" title="Leaders" sub="How do voters rate the people who would lead?" href="/sentiment/polls#leaders" />
      <div className="dx-headline static">
        <span className="dx-headline-label">Net approval: approve minus disapprove</span>
        {pm?.a && <NetBar label={pm.name} sub={ROLE_LABEL.pm} value={pm.a.value} />}
        {opp?.a && <NetBar label={opp.name} sub={ROLE_LABEL.opposition} value={opp.a.value} />}
        {others.map((o) => <NetBar key={o.name} label={o.name} sub="Other leader" value={o.a!.value} />)}
        {pmMeasure && <Trend points={rollingAverage(polls, pmMeasure)} refValue={0} height={48} />}
        <span className="dx-reflabel"><span className="dx-refkey" />{pm?.name ?? 'PM'} net approval, 30-day average by week · {span(pm?.a ?? null)}</span>
      </div>
      {ppm && (
        <div className="dx-drivers">
          <p className="dx-drivers-head">Preferred prime minister (head-to-head polls)</p>
          <SplitBar parts={[
            { label: ppm.pm, value: ppm.a.value, colour: '#1d2a48' },
            { label: 'Unsure', value: Math.max(0, Math.round((100 - ppm.a.value - ppm.b.value) * 10) / 10), colour: '#c3cad6' },
            { label: ppm.opp, value: ppm.b.value, colour: '#6b7fa8' },
          ]} />
        </div>
      )}
    </section>
  );
}

/** The mood against the evidence, full width: what people feel, what the official numbers show, and the verdict. */
function MoodStrip({ polls, consumers }: { polls: Poll[]; consumers: SectionReading }) {
  const net = pollAverage(polls, 'direction_net', 60);
  const wrong = pollAverage(polls, 'direction_wrong', 60);
  const check = moodCheck(consumers, net, wrong);
  const cc = consumers.headline;
  const verdict = check.verdict === 'backs' ? (check.gloomy ? 'The data backs the gloom' : 'The data backs the optimism')
    : check.verdict === 'runs-ahead' ? 'The mood runs ahead of the data' : check.verdict === 'unknown' ? 'No reading of the mood yet' : 'The data gives partial support';
  return (
    <section className="dx-card dx-mood">
      <div className="dx-card-head static">
        <span className="dx-card-icon"><Icon name="scale" size={18} /></span>
        <span className="dx-card-titles"><h2>Does the data back the mood?</h2><span>How people feel, set against the official numbers households live with</span></span>
        <span className="dx-verdict">{verdict}</span>
      </div>
      <div className="dx-mood-cols">
        <div>
          <p className="dx-drivers-head">The mood</p>
          <DriverRow href="/sentiment/consumers/consumer_confidence_oecd" r={cc} />
          {wrong && (
            <div className={`dx-driver ${wrong.value > 50 ? 'bad' : 'neutral'}`}>
              <span className={`dx-driver-icon ${wrong.value > 50 ? 'bad' : 'neutral'}`}><Icon name="compass" size={15} /></span>
              <span className="dx-driver-label">Say wrong direction<span className="dx-driver-ref">polls to {dayLabel(wrong.to)} · private</span></span>
              <span className="dx-dev"><span className="dx-dev-fill" style={{ left: 0, width: `${wrong.value}%` }} /></span>
              <span className="dx-driver-value">{wrong.value}%</span>
              <span className="dx-driver-change" />
            </div>
          )}
        </div>
        <div>
          <p className="dx-drivers-head">The evidence: {check.worse.length} of {consumers.others.filter((r) => r.latest).length} household pressures worse than usual</p>
          {consumers.others.filter((r) => r.latest).map((r) => <DriverRow key={r.key} href={`/sentiment/consumers/${r.key}`} r={r} />)}
        </div>
      </div>
      <p className="dx-mood-text">{check.lines.join(' ')}</p>
    </section>
  );
}

/** The polls block on the sentiment dashboard: clearly labelled, beside the official numbers that test it. */
export function PollsPanel({ polls, consumers }: { polls: Poll[]; consumers: SectionReading }) {
  return (
    <section className="dx-polls" aria-labelledby="polls-head">
      <div className="dx-band">
        <span className="dx-band-icon"><Icon name="ballot" size={18} /></span>
        <div>
          <h2 id="polls-head">What the polls say, and whether the numbers back it</h2>
          <p>Published polls, averaged across pollsters (each firm&apos;s latest poll in the past 30 days)</p>
        </div>
        <span className="dx-private-badge">Private polls · context only</span>
      </div>
      <div className="dx-grid three">
        <VotingCard polls={polls} />
        <DirectionCard polls={polls} />
        <LeadersCard polls={polls} />
      </div>
      <MoodStrip polls={polls} consumers={consumers} />
      <p className="dx-note">{PRIVATE_NOTE} <Link href="/sentiment/polls" className="studio-link">Every poll →</Link></p>
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
      <p className="dx-note">{PRIVATE_NOTE}</p>
      <h2 className="dx-h2">Two-party preferred</h2>
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
      <h3 className="dx-h2">Latest poll from each pollster</h3>
      <PollTable polls={latestTpp} />

      <h2 id="direction" className="dx-h2">Direction of the country</h2>
      {right.length >= 2 && (
        <StoryChart chart={trendChart(
          directionTitle(right.at(-1)?.value, wrong.at(-1)?.value, right.at(-1)?.period),
          'Share saying the country is heading in the right or wrong direction, % (monthly average of published polls)',
          { label: 'Wrong direction', points: wrong }, { label: 'Right direction', points: right },
        )} />
      )}
      <PollTable polls={dir.slice(0, 12)} direction />

      <LeadersDetail polls={polls} />

      <h2 className="dx-h2">Every voting-intention poll since the 2025 election</h2>
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
      <h2 id="leaders" className="dx-h2">Leaders</h2>
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
      <h3 className="dx-h2">Latest approval from each pollster</h3>
      <LeaderTable polls={latestByPollster(appr, currentMeasure(appr, 'approval_net', 'pm') ?? '')} prefix="approval_net" />
      <h3 className="dx-h2">Preferred prime minister</h3>
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
