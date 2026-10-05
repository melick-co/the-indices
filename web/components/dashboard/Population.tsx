import Link from 'next/link';
import StoryChart from '@/components/StoryChart';
import { Trend } from '@/components/dashboard/DashParts';
import { Icon } from '@/components/dashboard/Icons';
import { DriverRow, Hero, Legend, type DashboardRef } from '@/components/dashboard/Views';
import type { SectionReading } from '@/lib/economy-dashboard';
import { windowLabel, type PopulationData, type Ranked } from '@/lib/population';

const n = (v: number) => Math.round(v).toLocaleString('en-AU');
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;
const pct = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10 ** d) / 10 ** d)}%`;
const change = (now: number, then: number | null) => (then ? ((now - then) / then) * 100 : null);
const millions = (v: number) => `${(v / 1e6).toFixed(2)} million`;
const qWord = (p: string) => { const [y, q] = p.split('-Q'); return `${['March', 'June', 'September', 'December'][Number(q) - 1]} quarter ${y}`; };

function ChangeTag({ now, then, label }: { now: number; then: number | null; label: string }) {
  const c = change(now, then);
  if (c == null) return null;
  return <span className={`dx-pchange ${c > 0 ? 'up' : c < 0 ? 'down' : ''}`}>{c > 0 ? '▲' : c < 0 ? '▼' : '■'} {pct(c)} {label}</span>;
}

function Card({ icon, title, sub, children, wide = false }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`dx-card${wide ? ' dx-span' : ''}`}>
      <div className="dx-card-head static">
        <span className="dx-card-icon"><Icon name={icon} size={18} /></span>
        <span className="dx-card-titles"><h2>{title}</h2><span>{sub}</span></span>
      </div>
      <div className="dx-card-body">{children}</div>
    </section>
  );
}

/** Births and arrivals add; deaths and departures subtract; the net is the year's growth. */
function GrowthBridge({ d }: { d: PopulationData }) {
  const max = Math.max(...d.flows.map((f) => f.value), 1);
  const net = d.flows.reduce((s, f) => s + f.sign * f.value, 0);
  const official = d.change12.at(-1)?.value ?? net;
  return (
    <div className="dx-bridge">
      {d.flows.map((f) => (
        <div key={f.key} className={`dx-bridge-row ${f.sign > 0 ? 'add' : 'sub'}`}>
          <span className="dx-bridge-label"><Icon name={f.key === 'births' ? 'heart' : f.key === 'deaths' ? 'alert' : f.key === 'arrivals' ? 'users' : 'trend'} size={14} />{f.label}</span>
          <span className="dx-bridge-track"><span style={{ width: `${(f.value / max) * 100}%` }} /></span>
          <span className="dx-bridge-value">{f.sign > 0 ? '+' : '−'}{n(f.value)}</span>
          <ChangeTag now={f.value} then={f.prior} label="on a year earlier" />
        </div>
      ))}
      <div className="dx-bridge-row total">
        <span className="dx-bridge-label"><Icon name="chart" size={14} />Population growth</span>
        <span className="dx-bridge-track"><span style={{ width: `${(Math.abs(official) / max) * 100}%` }} /></span>
        <span className="dx-bridge-value">{signed(official)}</span>
        <span className="dx-pchange">{d.rate12.at(-1) ? `${d.rate12.at(-1)!.value}% a year` : ''}</span>
      </div>
      {Math.abs(official - net) > 500 && <p className="dx-small">Growth differs from the sum of the flows by {n(Math.abs(official - net))}: the ABS revises components and population separately.</p>}
    </div>
  );
}

/** Natural increase and net overseas migration by calendar year, stacked (migration below the line when negative). */
function ComponentsChart({ data }: { data: PopulationData['annual'] }) {
  const rows = data.slice(-26);
  if (rows.length < 2) return null;
  const W = 720, H = 240, padL = 44, padB = 26, padT = 10;
  const hi = Math.max(...rows.map((r) => Math.max(0, r.natural) + Math.max(0, r.nom)));
  const lo = Math.min(0, ...rows.map((r) => Math.min(0, r.nom) + Math.min(0, r.natural)));
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const bw = (W - padL) / rows.length;
  const ticks = [lo < 0 ? lo : null, 0, hi / 2, hi].filter((t): t is number => t != null);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dx-stack" role="img" aria-label="Natural increase and net overseas migration by year">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end">{t === 0 ? '0' : `${Math.round(t / 1000)}k`}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = padL + i * bw + bw * 0.15, w = bw * 0.7;
        const natTop = y(Math.max(0, r.natural)), natBottom = y(Math.min(0, r.natural));
        const nomPos = r.nom >= 0;
        const nomTop = nomPos ? y(Math.max(0, r.natural) + r.nom) : y(Math.min(0, r.natural));
        const nomBottom = nomPos ? y(Math.max(0, r.natural)) : y(Math.min(0, r.natural) + r.nom);
        const label = r.period.length === 4 ? r.period : 'Latest';
        return (
          <g key={r.period}>
            <title>{`${r.period}: natural increase ${n(r.natural)}, net overseas migration ${signed(r.nom)}`}</title>
            <rect x={x} width={w} y={natTop} height={Math.max(0.5, natBottom - natTop)} className="nat" />
            <rect x={x} width={w} y={nomTop} height={Math.max(0.5, nomBottom - nomTop)} className={`nom${nomPos ? '' : ' neg'}`} />
            {(i % 5 === 0 || i === rows.length - 1) && <text x={x + w / 2} y={H - 8} textAnchor="middle">{label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Bars({ rows, max, total }: { rows: Ranked[]; max: number; total?: string }) {
  return (
    <div className="dx-rank">
      {rows.map((r) => (
        <div key={r.code} className="dx-rank-row">
          <span className="dx-rank-name">{r.name}</span>
          <span className="dx-rank-track"><span style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="dx-rank-value">{n(r.value)}</span>
          <span className="dx-rank-meta">
            <ChangeTag now={r.value} then={r.prior} label="1 yr" />
            {r.base != null && <ChangeTag now={r.value} then={r.base} label={total ?? '5 yrs'} />}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PopulationView({ dash, reading, d }: { dash: DashboardRef; reading: SectionReading; d: PopulationData }) {
  const { section, others } = reading;
  const pop = d.erp.at(-1);
  const growth = d.change12.at(-1);
  const rate = d.rate12.at(-1);
  const ni = d.ni12.at(-1), nom = d.nom12.at(-1);
  const migShare = growth && nom ? Math.round((nom.value / growth.value) * 100) : null;
  const births = d.births12.filter((p) => p.period.endsWith('-Q4')).slice(-30);
  const deaths = d.deaths12.filter((p) => p.period.endsWith('-Q4')).slice(-30);
  const v = d.visitors;
  return (
    <main className="dx">
      <Hero kicker={<><Link href={dash.base}>{dash.name}</Link> · {section.title}</>} title="How fast is the population growing, and why?"
        intro={growth && pop && d.latestQ ? <>Australia&apos;s population was {millions(pop.value)} at the end of the {qWord(d.latestQ)}, up {n(growth.value)} ({rate?.value}%) in a year. {migShare != null && <>Net overseas migration supplied {migShare}% of that growth and natural increase (births less deaths) the rest.</>}</> : null}>
        <div className="dx-ticker">
          {pop && <span className="dx-tick neutral"><span className="dx-tick-label"><Icon name="users" size={13} />Population</span><span className="dx-tick-value">{millions(pop.value)}</span><span className="dx-tick-meta">{qWord(pop.period)}</span></span>}
          {growth && <span className="dx-tick neutral"><span className="dx-tick-label"><Icon name="trend" size={13} />Growth, 12 months</span><span className="dx-tick-value">{signed(growth.value)}</span><span className="dx-tick-meta">{rate ? `${rate.value}% a year` : ''}</span></span>}
          {ni && <span className="dx-tick neutral"><span className="dx-tick-label"><Icon name="heart" size={13} />Natural increase</span><span className="dx-tick-value">{signed(ni.value)}</span><span className="dx-tick-meta">births less deaths</span></span>}
          {nom && <span className="dx-tick neutral"><span className="dx-tick-label"><Icon name="users" size={13} />Net overseas migration</span><span className="dx-tick-value">{signed(nom.value)}</span><span className="dx-tick-meta">arrivals less departures</span></span>}
          {v && <span className="dx-tick neutral"><span className="dx-tick-label"><Icon name="compass" size={13} />Visitor arrivals, 12 months</span><span className="dx-tick-value">{(v.total / 1e6).toFixed(2)}m</span><span className="dx-tick-meta">{v.base2019 ? `${Math.round((v.total / v.base2019) * 100)}% of 2019` : ''}</span></span>}
        </div>
      </Hero>

      <div className="dx-body">
        <div className="dx-grid two">
          <Card icon="chart" title="Where the growth comes from" sub={d.latestQ ? `${windowLabel(d.latestQ)[0].toUpperCase()}${windowLabel(d.latestQ).slice(1)}` : ''}>
            <GrowthBridge d={d} />
          </Card>
          <Card icon="trend" title="Growth by year" sub="Natural increase and net overseas migration, calendar years">
            <ComponentsChart data={d.annual} />
            <p className="dx-reflabel"><span className="dx-swatch nat" />Natural increase <span className="dx-swatch nom" />Net overseas migration (below the line when more left than arrived)</p>
          </Card>
        </div>

        {d.visa && (
          <Card wide icon="ballot" title="Who arrives and who leaves, by visa" sub={`Overseas migrants, ${windowLabel(d.visa.end)} (people arriving or leaving for 12 of the next 16 months)`}>
            <div className="dx-visa">
              <div className="dx-visa-head"><span>Visa or citizenship</span><span>Arrivals</span><span>Departures</span><span>Net</span><span>Net a year earlier</span></div>
              {(() => {
                const max = Math.max(...d.visa.rows.map((r) => Math.max(r.arrivals, r.departures)), 1);
                let group = '';
                return d.visa.rows.map((r) => {
                  const head = r.group !== group ? (group = r.group) : null;
                  const net = r.arrivals - r.departures;
                  return (
                    <div key={r.code}>
                      {head && <p className="dx-drivers-head">{head}</p>}
                      <div className="dx-visa-row">
                        <span className="dx-visa-name">{r.name}</span>
                        <span className="dx-visa-bar in"><span style={{ width: `${(r.arrivals / max) * 100}%` }} /><b>{n(r.arrivals)}</b></span>
                        <span className="dx-visa-bar out"><span style={{ width: `${(r.departures / max) * 100}%` }} /><b>{n(r.departures)}</b></span>
                        <span className={`dx-visa-net ${net < 0 ? 'neg' : ''}`}>{signed(net)}</span>
                        <span className="dx-visa-prior">{r.priorNet != null ? signed(r.priorNet) : '—'}</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </Card>
        )}

        <div className="dx-grid two">
          {d.born && (
            <Card icon="users" title="Where residents were born" sub={`Top overseas countries of birth, 30 June ${d.born.year}`}>
              <p className="dx-small dx-lead">
                <b>{millions(d.born.overseas)}</b> residents ({Math.round((d.born.overseas / d.born.total) * 1000) / 10}%) were born overseas
                {d.born.overseasPrior5 != null && d.born.totalPrior5 ? <>, up from {Math.round((d.born.overseasPrior5 / d.born.totalPrior5) * 1000) / 10}% five years earlier</> : null}.
              </p>
              <Bars rows={d.born.top} max={d.born.top[0]?.value ?? 1} />
            </Card>
          )}
          <Card icon="heart" title="Births and deaths" sub="Calendar years: what natural increase is made of">
            {births.length >= 2 && (
              <StoryChart chart={{
                type: 'chart', kind: 'line',
                title: `${n(births.at(-1)!.value)} births and ${n(deaths.at(-1)?.value ?? 0)} deaths in ${births.at(-1)!.period.slice(0, 4)}`,
                subtitle: 'Births and deaths, calendar years (sum of the four quarters to December)',
                series: births.map((p) => ({ label: p.period.slice(0, 4), value: p.value })),
                alt_series: deaths.filter((p) => births.some((b) => b.period === p.period)).map((p) => ({ label: p.period.slice(0, 4), value: p.value })),
                primary_label: 'Births', alt_label: 'Deaths', caption: 'Source: ABS, National, state and territory population.',
              }} />
            )}
          </Card>
        </div>

        {v && (
          <>
            <div className="dx-band">
              <span className="dx-band-icon"><Icon name="compass" size={18} /></span>
              <div>
                <h2>Visitors</h2>
                <p>Short-term visitor arrivals (staying less than a year), {windowLabel(v.end)}, against a year earlier and the same months of 2019, before the border closures</p>
              </div>
            </div>
            <div className="dx-grid two">
              <Card icon="compass" title="Why they come" sub="Arrivals by main reason for the trip">
                <div className="dx-kpis">
                  <span><b>{n(v.total)}</b> visitor arrivals</span>
                  {v.prior != null && <ChangeTag now={v.total} then={v.prior} label="on a year earlier" />}
                  {v.base2019 != null && <span className="dx-pchange">{Math.round((v.total / v.base2019) * 100)}% of 2019</span>}
                </div>
                <div className="dx-reasons">
                  {v.reasons.map((r) => {
                    const yrs = (v.annualByReason.get(r.code) ?? []).slice(-20);
                    return (
                      <div key={r.code} className="dx-reason">
                        <span className="dx-reason-name">{r.name}<small>{Math.round(r.share * 1000) / 10}% of visitors</small></span>
                        <span className="dx-reason-trend"><Trend points={yrs} height={30} /></span>
                        <span className="dx-reason-value">{n(r.value)}</span>
                        <span className="dx-reason-meta">
                          <ChangeTag now={r.value} then={r.prior} label="1 yr" />
                          {r.base != null && <span className={`dx-recovery ${r.value >= r.base ? 'up' : 'down'}`}>{Math.round((r.value / r.base) * 100)}% of 2019</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="dx-small">Trend lines: calendar-year arrivals for each reason, last 20 years.</p>
              </Card>
              <Card icon="users" title="Where they come from" sub="Top countries of residence">
                <Bars rows={v.countries} max={v.countries[0]?.value ?? 1} total="vs 2019" />
              </Card>
            </div>
            {v.annual.length >= 2 && (
              <section className="dx-card dx-span">
                <div className="dx-card-body">
                  <StoryChart chart={{
                    type: 'chart', kind: 'line',
                    title: `${(v.annual.at(-1)!.value / 1e6).toFixed(2)} million visitor arrivals in ${v.annual.at(-1)!.period}`,
                    subtitle: 'Short-term visitor arrivals, calendar years',
                    series: v.annual.filter((p) => Number(p.period) >= 1990).map((p) => ({ label: p.period, value: p.value })),
                    caption: 'Source: ABS, Overseas arrivals and departures (OAD_REASON).',
                  }} />
                </div>
              </section>
            )}
          </>
        )}

        <section className="dx-card dx-span">
          <div className="dx-card-head static">
            <span className="dx-card-icon"><Icon name="chart" size={18} /></span>
            <span className="dx-card-titles"><h2>The dashboard readings</h2><span>Each against its benchmark</span></span>
          </div>
          <div className="dx-drivers">{[reading.headline, ...others].map((r) => <DriverRow key={r.key} href={`${dash.base}/${section.id}/${r.key}`} r={r} />)}</div>
        </section>
        <p className="dx-note">All figures are official ABS counts from the ABS Data API: population and components of change (ERP_COMP_Q), residents by country of birth (ERP_COB), migrant arrivals and departures by visa (OMAD_VISA) and short-term visitor arrivals (OAD_REASON, OAD_COUNTRY). Twelve-month figures sum the published quarters or months. Overseas migrants are people arriving or leaving for at least 12 of the next 16 months; visitors stay less than a year.</p>
        <Legend />
      </div>
    </main>
  );
}
