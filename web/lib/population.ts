import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';

/**
 * The population page's data: components of change (observations, pop_*), and the ABS breakdowns (agent/supabase/
 * 38_breakdowns.sql) by country of birth, visa group and visitor reason and origin. Every figure is an official
 * ABS count; twelve-month figures are sums of the published quarters or months.
 */
type Db = ReturnType<typeof createClient>;
export type Pt = { period: string; value: number };
export type Row = { category: string; category_name: string; category_level: string; period: string; value: number };

async function series(db: Db, id: string): Promise<Pt[]> {
  return (await loadObservations(db, id).catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
}

async function rows(db: Db, dataset: string, since?: string, periods?: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from('breakdowns').select('category, category_name, category_level, period, value').eq('dataset', dataset).eq('region', 'AUS');
    if (since) q = q.gte('period', since);
    if (periods) q = q.in('period', periods);
    const { data, error } = await q.order('period').range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...data.map((r) => ({ ...r, value: Number(r.value) }) as Row));
    if (data.length < 1000) break;
  }
  return out;
}

async function latestPeriod(db: Db, dataset: string): Promise<string | null> {
  const { data } = await db.from('breakdowns').select('period').eq('dataset', dataset).order('period', { ascending: false }).limit(1);
  return data?.[0]?.period ?? null;
}

// ---------------------------------------------------------------------------------------------------- periods

const qIndex = (p: string) => { const [y, q] = p.split('-Q').map(Number); return y * 4 + q - 1; };
const qLabel = (i: number) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
const mIndex = (p: string) => { const [y, m] = p.split('-').map(Number); return y * 12 + m - 1; };
const mLabel = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** The twelve months (four quarters or twelve months) ending at `end`, summed per category. */
function window(all: Row[], end: string, back = 0): Map<string, number> | null {
  const quarterly = /-Q\d$/.test(end);
  const n = quarterly ? 4 : 12;
  const idx = quarterly ? qIndex(end) - back * 4 : mIndex(end) - back * 12;
  const want = new Set(Array.from({ length: n }, (_, k) => (quarterly ? qLabel(idx - k) : mLabel(idx - k))));
  const got = new Set<string>();
  const sums = new Map<string, number>();
  for (const r of all) {
    if (!want.has(r.period)) continue;
    got.add(r.period);
    sums.set(r.category, (sums.get(r.category) ?? 0) + r.value);
  }
  return got.size === n ? sums : null;
}

export const windowLabel = (end: string) => {
  const quarterly = /-Q\d$/.test(end);
  const [y, x] = quarterly ? end.split('-Q').map(Number) : end.split('-').map(Number);
  const endMonth = quarterly ? x * 3 : x;
  const d = new Date(Date.UTC(y, endMonth - 1, 1));
  return `the twelve months to ${d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
};

/** The same twelve months in 2019, the last full year before the border closures (for visitor recovery). */
function sameMonths2019(end: string) {
  return `2019-${end.split('-')[1]}`;
}

/** Display names: the ABS's official names, shortened where they are long. */
export function shortName(name: string): string {
  return name
    .replace(/ \(excludes SARs and Taiwan\)/, '')
    .replace(/^Hong Kong \(SAR of China\)$/, 'Hong Kong')
    .replace(/^United States of America$/, 'United States')
    .replace(/^UK, CIs & IOM$/, 'United Kingdom')
    .replace(/^Korea, South$/, 'South Korea');
}

// ---------------------------------------------------------------------------------------------------- shapes

export type Travel = {
  end: string; total: number; prior: number | null; base2019: number | null;
  reasons: Ranked[]; countries: Ranked[]; annual: Pt[]; annualByReason: Map<string, Pt[]>;
};

/** Who leaves: Australian citizens' departures and returns over time, and all departures by group. */
export type Leaving = {
  end: string;
  /** Calendar years (December quarter) plus the latest twelve months: citizens leaving and returning. */
  citizens: { period: string; left: number; returned: number; share: number | null }[];
  groups: { group: string; value: number; prior: number | null; base: number | null; share: number }[];
  total: number;
};

export type Flow = { key: string; label: string; value: number; prior: number | null; sign: 1 | -1 };
export type Ranked = { code: string; name: string; value: number; prior: number | null; base: number | null; share: number };

export type PopulationData = {
  erp: Pt[]; change12: Pt[]; rate12: Pt[]; births12: Pt[]; deaths12: Pt[]; ni12: Pt[]; nom12: Pt[];
  latestQ: string | null;
  flows: Flow[];
  /** Calendar-year (December quarter) components for the long-run chart, plus the latest twelve months. */
  annual: { period: string; natural: number; nom: number }[];
  visa: { end: string; rows: { code: string; name: string; group: string; arrivals: number; departures: number; priorNet: number | null }[] } | null;
  born: { year: string; total: number; overseas: number; overseasPrior5: number | null; totalPrior5: number | null; top: Ranked[] } | null;
  visitors: Travel | null;
  /** Australian residents' short trips abroad (returning from), by reason and destination. */
  outbound: Travel | null;
  leaving: Leaving | null;
};

/** Which part of the visa system a group belongs to, in the order the page lists them. */
export function visaGroup(code: string): string {
  if (['2203', '2208', '1009'].includes(code)) return 'Students';
  if (['23', '24', '25', '1010'].includes(code)) return 'Other temporary visas';
  if (['11', '12', '15', '1030'].includes(code)) return 'Permanent visas';
  if (code === '01') return 'New Zealand citizens';
  if (code === '02') return 'Australian citizens';
  return 'Other';
}
const GROUP_ORDER = ['Students', 'Other temporary visas', 'Permanent visas', 'New Zealand citizens', 'Australian citizens', 'Other'];

export async function loadPopulation(): Promise<PopulationData> {
  const db = createClient();
  const [erp, change12, rate12, births12, deaths12, ni12, nom12, arr12, dep12] = await Promise.all(
    ['pop_erp_q', 'pop_change_12m', 'pop_growth_rate_12m', 'pop_births_12m', 'pop_deaths_12m', 'pop_natural_increase_12m', 'pop_nom_12m', 'pop_os_arrivals_12m', 'pop_os_departures_12m']
      .map((id) => series(db, id)),
  );
  const latestQ = change12.at(-1)?.period ?? null;
  const at = (s: Pt[], p: string | null) => (p ? s.find((x) => x.period === p)?.value ?? null : null);
  const yearBefore = latestQ ? qLabel(qIndex(latestQ) - 4) : null;
  const flows: Flow[] = latestQ ? [
    { key: 'births', label: 'Births', value: at(births12, latestQ) ?? 0, prior: at(births12, yearBefore), sign: 1 },
    { key: 'arrivals', label: 'Overseas migrant arrivals', value: at(arr12, latestQ) ?? 0, prior: at(arr12, yearBefore), sign: 1 },
    { key: 'deaths', label: 'Deaths', value: at(deaths12, latestQ) ?? 0, prior: at(deaths12, yearBefore), sign: -1 },
    { key: 'departures', label: 'Overseas migrant departures', value: at(dep12, latestQ) ?? 0, prior: at(dep12, yearBefore), sign: -1 },
  ] : [];
  const nomByQ = new Map(nom12.map((p) => [p.period, p.value]));
  const annual = ni12.filter((p) => p.period.endsWith('-Q4') || p.period === latestQ)
    .filter((p) => nomByQ.has(p.period))
    .map((p) => ({ period: p.period.endsWith('-Q4') ? p.period.slice(0, 4) : `12 mths to ${p.period}`, natural: p.value, nom: nomByQ.get(p.period)! }));

  // Visa groups: the latest four quarters, arrivals and departures, and last year's net.
  let visa: PopulationData['visa'] = null;
  let leaving: Leaving | null = null;
  const vEnd = await latestPeriod(db, 'migrant_arrivals_visa');
  if (vEnd) {
    const [a, d] = await Promise.all([rows(db, 'migrant_arrivals_visa'), rows(db, 'migrant_departures_visa')]);
    leaving = leavingFrom(a, d, vEnd);
    const [aw, dw, ap, dp] = [window(a, vEnd), window(d, vEnd), window(a, vEnd, 1), window(d, vEnd, 1)];
    if (aw && dw) {
      const names = new Map(a.map((r) => [r.category, r.category_name]));
      const items = [...new Set(a.filter((r) => r.category_level === 'item').map((r) => r.category))];
      visa = {
        end: vEnd,
        rows: items.map((code) => ({
          code, name: names.get(code)!.replace(/^Temporary visa ?- ?/i, '').replace(/^Permanent visa - /i, '').replace(/^Student ?- ?/i, 'Student: ').replace(/^student - /i, 'Student: ').replace(/ \(subclass 444\)/, ''),
          group: visaGroup(code), arrivals: aw.get(code) ?? 0, departures: dw.get(code) ?? 0,
          priorNet: ap && dp ? (ap.get(code) ?? 0) - (dp.get(code) ?? 0) : null,
        })).filter((r) => r.arrivals + r.departures > 0).sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || (y.arrivals - y.departures) - (x.arrivals - x.departures)),
      };
    }
  }

  // Country of birth: the latest 30 June, against five years earlier.
  let born: PopulationData['born'] = null;
  const cEnd = await latestPeriod(db, 'erp_cob');
  if (cEnd) {
    const p5 = String(Number(cEnd) - 5), p1 = String(Number(cEnd) - 1);
    const all = await rows(db, 'erp_cob', undefined, [cEnd, p1, p5]);
    const v = (code: string, p: string) => all.find((r) => r.category === code && r.period === p)?.value ?? null;
    const total = v('TOT', cEnd) ?? 0;
    const aus = v('1101', cEnd) ?? 0;
    const items = all.filter((r) => r.period === cEnd && r.category_level === 'item' && r.category !== '1101').sort((x, y) => y.value - x.value).slice(0, 15);
    born = {
      year: cEnd, total, overseas: total - aus,
      totalPrior5: v('TOT', p5), overseasPrior5: v('TOT', p5) != null && v('1101', p5) != null ? v('TOT', p5)! - v('1101', p5)! : null,
      top: items.map((r) => ({ code: r.category, name: shortName(r.category_name), value: r.value, prior: v(r.category, p1), base: v(r.category, p5), share: total ? r.value / total : 0 })),
    };
  }

  // Visitors arriving, and Australians' trips abroad: the latest twelve months by reason and by country.
  const [visitors, outbound] = await Promise.all([travel(db, 'visitors'), travel(db, 'residents_trips')]);

  return { erp, change12, rate12, births12, deaths12, ni12, nom12, latestQ, flows, annual, visa, born, visitors, outbound, leaving };
}

/** Short-term travel (visitors arriving, or residents returning from trips), against a year earlier and 2019. */
async function travel(db: Db, prefix: 'visitors' | 'residents_trips'): Promise<Travel | null> {
  const end = await latestPeriod(db, `${prefix}_reason`);
  if (!end) return null;
  const [reason, country] = await Promise.all([rows(db, `${prefix}_reason`, '1990-01'), rows(db, `${prefix}_country`, '2018-01')]);
  const base = sameMonths2019(end);
  const rw = window(reason, end), rp = window(reason, end, 1), rb = window(reason, base);
  const cw = window(country, end), cp = window(country, end, 1), cb = window(country, base);
  const rNames = new Map(reason.map((r) => [r.category, r.category_name]));
  const cNames = new Map(country.map((r) => [r.category, { name: r.category_name, level: r.category_level }]));
  const total = rw?.get('TOT') ?? 0;
  const rank = (w: Map<string, number> | null, p: Map<string, number> | null, b: Map<string, number> | null, keep: (c: string) => boolean, name: (c: string) => string) =>
    w ? [...w.entries()].filter(([c]) => keep(c)).sort((x, y) => y[1] - x[1]).map(([c, value]) => ({ code: c, name: name(c), value, prior: p?.get(c) ?? null, base: b?.get(c) ?? null, share: total ? value / total : 0 })) : [];
  // Calendar-year totals (complete years only), for the long-run trend.
  const years = (cat: string) => {
    const by = new Map<string, { n: number; v: number }>();
    for (const r of reason) if (r.category === cat) { const y = r.period.slice(0, 4); const e = by.get(y) ?? { n: 0, v: 0 }; e.n++; e.v += r.value; by.set(y, e); }
    return [...by.entries()].filter(([, e]) => e.n === 12).map(([period, e]) => ({ period, value: e.v }));
  };
  const reasonCodes = [...new Set(reason.map((r) => r.category))].filter((c) => c !== 'TOT');
  return {
    end, total, prior: rp?.get('TOT') ?? null, base2019: rb?.get('TOT') ?? null,
    reasons: rank(rw, rp, rb, (c) => c !== 'TOT', (c) => rNames.get(c) ?? c),
    countries: rank(cw, cp, cb, (c) => cNames.get(c)?.level === 'item', (c) => shortName(cNames.get(c)?.name ?? c)).slice(0, 15),
    annual: years('TOT'),
    annualByReason: new Map(reasonCodes.map((c) => [c, years(c)])),
  };
}

/** Australian citizens leaving and returning by year, and the latest twelve months' departures by group. */
function leavingFrom(arrivals: Row[], departures: Row[], end: string): Leaving | null {
  const quarters = [...new Set(departures.map((r) => r.period))].sort();
  const ends = quarters.filter((q) => q.endsWith('-Q4') || q === end);
  const citizens = ends.map((q) => {
    const d = window(departures, q), a = window(arrivals, q);
    if (!d || !a) return null;
    const left = d.get('02') ?? 0, total = d.get('1041') ?? null;
    return { period: q.endsWith('-Q4') && q !== end ? q.slice(0, 4) : `12 mths to ${q}`, left, returned: a.get('02') ?? 0, share: total ? left / total : null };
  }).filter((x): x is NonNullable<typeof x> => x != null);
  const now = window(departures, end), prior = window(departures, end, 1);
  // 2019: the same four quarters of 2019 (the last full year before the border closures).
  const base = window(departures, `2019-Q${end.slice(-1)}`);
  if (!now) return null;
  const sumGroup = (w: Map<string, number> | null, g: string) => (w ? [...w.entries()].filter(([c]) => visaGroup(c) === g && /^(2203|2208|1009|23|24|25|1010|11|12|15|1030|01|02)$/.test(c)).reduce((s, [, v]) => s + v, 0) : null);
  const total = now.get('1041') ?? 0;
  const groups = GROUP_ORDER.filter((g) => g !== 'Other').map((group) => {
    const value = sumGroup(now, group) ?? 0;
    return { group, value, prior: sumGroup(prior, group), base: sumGroup(base, group), share: total ? value / total : 0 };
  }).sort((x, y) => y.value - x.value);
  return { end, citizens, groups, total };
}
