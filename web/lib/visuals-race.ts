import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { OECD } from '@/lib/economy-dashboard';
import { entityNames } from '@/lib/entity-names';
import { shortName } from '@/lib/population';

/**
 * Bar-chart races: one value per entity per period, from stored official series. Captions are derived from the
 * data (who leads, who overtakes whom), never written by a model, so there is nothing in a race to fact-check.
 */
export type RaceFrame = { period: string; values: Record<string, number> };
export type Race = {
  key: string;
  title: string;
  subtitle: string;
  unit: 'persons' | 'usd' | 'percent';
  labels: Record<string, string>;
  frames: RaceFrame[];
  /** Data-derived captions, each tied to the frame where it becomes true. */
  captions: { frame: number; text: string }[];
  takeaways: string[];
  source: { org: string; dataset: string; url?: string };
  /** Entities to keep (the ones that are ever in the top N). */
  topN: number;
};

type Db = ReturnType<typeof createClient>;

async function breakdownRows(db: Db, dataset: string) {
  const rows: { category: string; category_name: string; category_level: string; period: string; value: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('breakdowns').select('category, category_name, category_level, period, value').eq('dataset', dataset).eq('region', 'AUS').order('period').range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data.map((r) => ({ ...r, value: Number(r.value) })));
    if (data.length < 1000) break;
  }
  return rows;
}

const fmt = (v: number, unit: Race['unit']) => (unit === 'usd' ? `US$${Math.round(v).toLocaleString('en-AU')}` : unit === 'percent' ? `${v.toFixed(1)}%` : Math.round(v).toLocaleString('en-AU'));

/** Keep entities that reach the top N in any period; captions for changes of leader; plain takeaways. */
function finish(r: Omit<Race, 'captions' | 'takeaways'>): Race {
  const keep = new Set<string>();
  for (const f of r.frames) Object.entries(f.values).sort((a, b) => b[1] - a[1]).slice(0, r.topN).forEach(([k]) => keep.add(k));
  const frames = r.frames.map((f) => ({ period: f.period, values: Object.fromEntries(Object.entries(f.values).filter(([k]) => keep.has(k))) }));
  const leader = (f: RaceFrame) => Object.entries(f.values).sort((a, b) => b[1] - a[1])[0]?.[0];
  const captions: Race['captions'] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = leader(frames[i - 1]), b = leader(frames[i]);
    if (a && b && a !== b) captions.push({ frame: i, text: `${frames[i].period}: ${r.labels[b]} overtakes ${r.labels[a]} for first place` });
  }
  const first = frames[0], last = frames.at(-1)!;
  const top = (f: RaceFrame) => Object.entries(f.values).sort((a, b) => b[1] - a[1]);
  const growth = Object.keys(last.values).filter((k) => (first.values[k] ?? 0) > 0)
    .map((k) => ({ k, g: last.values[k] / first.values[k] })).sort((a, b) => b.g - a.g);
  const takeaways = [
    `In ${first.period}, ${r.labels[top(first)[0][0]]} led with ${fmt(top(first)[0][1], r.unit)}; in ${last.period}, ${r.labels[top(last)[0][0]]} leads with ${fmt(top(last)[0][1], r.unit)}.`,
    ...(growth[0] ? [`The fastest growth among those shown: ${r.labels[growth[0].k]}, from ${fmt(first.values[growth[0].k], r.unit)} to ${fmt(last.values[growth[0].k], r.unit)}.`] : []),
    ...captions.slice(-2).map((c) => `${c.text}.`),
  ];
  return { ...r, frames, captions, takeaways };
}

async function bornOverseas(db: Db): Promise<Race | null> {
  const rows = (await breakdownRows(db, 'erp_cob')).filter((r) => r.category_level === 'item' && r.category !== '1101');
  if (!rows.length) return null;
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const labels = Object.fromEntries(rows.map((r) => [r.category, shortName(r.category_name)]));
  return finish({
    key: 'race:erp_cob', title: `Australia's largest overseas-born groups, ${periods[0]} to ${periods.at(-1)}`,
    subtitle: 'Australian residents by country of birth, at 30 June each year', unit: 'persons', labels, topN: 10,
    frames: periods.map((p) => ({ period: p, values: Object.fromEntries(rows.filter((r) => r.period === p).map((r) => [r.category, r.value])) })),
    source: { org: 'ABS', dataset: 'Estimated resident population by country of birth (ERP_COB)', url: 'https://data.api.abs.gov.au/rest/data/ABS,ERP_COB' },
  });
}

/** Monthly travel by country, summed into complete calendar years. */
async function travel(db: Db, dataset: 'visitors_country' | 'residents_trips_country'): Promise<Race | null> {
  const rows = (await breakdownRows(db, dataset)).filter((r) => r.category_level === 'item');
  if (!rows.length) return null;
  const sums = new Map<string, Map<string, { n: number; v: number }>>();
  for (const r of rows) {
    const y = r.period.slice(0, 4);
    const m = sums.get(y) ?? new Map();
    const e = m.get(r.category) ?? { n: 0, v: 0 };
    e.n++; e.v += r.value; m.set(r.category, e); sums.set(y, m);
  }
  const years = [...sums.keys()].sort().filter((y) => [...sums.get(y)!.values()].some((e) => e.n === 12));
  const labels = Object.fromEntries(rows.map((r) => [r.category, shortName(r.category_name)]));
  const visitors = dataset === 'visitors_country';
  return finish({
    key: `race:${dataset}`, title: visitors ? `Where Australia's visitors come from, ${years[0]} to ${years.at(-1)}` : `Where Australians travel, ${years[0]} to ${years.at(-1)}`,
    subtitle: visitors ? 'Short-term visitor arrivals by country of residence, calendar years' : 'Short-term trips abroad by Australian residents, by main destination, calendar years',
    unit: 'persons', labels, topN: 10,
    frames: years.map((y) => ({ period: y, values: Object.fromEntries([...sums.get(y)!.entries()].filter(([, e]) => e.n === 12).map(([c, e]) => [c, e.v])) })),
    source: { org: 'ABS', dataset: 'Overseas Arrivals and Departures (OAD_COUNTRY)', url: 'https://data.api.abs.gov.au/rest/data/ABS,OAD_COUNTRY' },
  });
}

async function gdpPerPerson(db: Db): Promise<Race | null> {
  // World Bank history from 1960 (gdp_per_capita_usd_wb); every year with enough OECD members to fill the top 10.
  const obs = (await loadObservations(db, 'gdp_per_capita_usd_wb').catch(() => [])).filter((o) => OECD.has(o.entity));
  if (!obs.length) return null;
  const names = await entityNames();
  const years = [...new Set(obs.map((o) => o.period))].sort().filter((y) => obs.filter((o) => o.period === y).length >= 10);
  const labels = Object.fromEntries([...new Set(obs.map((o) => o.entity))].map((e) => [e, names.get(e) ?? e]));
  return finish({
    key: 'race:gdp_per_capita', title: `GDP per person in OECD countries, ${years[0]} to ${years.at(-1)}`, subtitle: 'Gross domestic product per person, current US dollars',
    unit: 'usd', labels, topN: 10,
    frames: years.map((y) => ({ period: y, values: Object.fromEntries(obs.filter((o) => o.period === y).map((o) => [o.entity, o.value])) })),
    source: { org: 'World Bank', dataset: 'World Development Indicators, GDP per capita (current US$)', url: 'https://data.worldbank.org/indicator/NY.GDP.PCAP.CD' },
  });
}

export async function buildRaces(): Promise<Race[]> {
  const db = createClient();
  const all = await Promise.all([bornOverseas(db), travel(db, 'visitors_country'), travel(db, 'residents_trips_country'), gdpPerPerson(db)]);
  return all.filter((r): r is Race => !!r && r.frames.length >= 5);
}
