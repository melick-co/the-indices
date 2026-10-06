import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { SECTIONS, type Indicator } from '@/content/dashboard/economy';
import { QOL_SECTIONS } from '@/content/dashboard/quality-of-life';
import { SENTIMENT_SECTIONS } from '@/content/dashboard/sentiment';
import { peerTable } from '@/lib/economy-dashboard';
import { entityNames } from '@/lib/entity-names';
import { loadPnl } from '@/lib/pnl';
import { shortName } from '@/lib/population';
import { isCountryItem } from '@/lib/breakdown-categories';

/**
 * Chart-ready datasets for Visuals, built only from stored official series. Each one carries everything the graphic
 * draws (`spec`) and where it came from (`sources`); the generator writes words around it and checks them against it.
 */
export type VisualRow = { label: string; code: string; value: number; prior?: number | null; highlight?: boolean };
export type VisualUnit = Indicator['unit'] | 'aud_m' | 'persons';
export type VisualSpec = {
  template: 'ranked' | 'treemap' | 'change' | 'race';
  unit: VisualUnit;
  /** What a value is ("Life satisfaction, 0–10", "People born overseas"). */
  measure: string;
  rows: VisualRow[];
  period: string;
  priorPeriod?: string;
  /** Rankings: the OECD median and Australia's place (best first when the measure has a direction). */
  median?: number; rank?: number; of?: number; bestFirst?: boolean; higherIsBetter?: boolean;
  /** Treemaps: the whole the tiles are shares of. */
  total?: number;
};
export type Dataset = { key: string; spec: VisualSpec; sources: { org: string; dataset: string; url?: string }[]; context: string;
  /** Extra exact statements the words may rely on (e.g. how a total relates to a headline figure). */
  notes?: string[] };

type Db = ReturnType<typeof createClient>;

/** Cross-country measures the dashboards already define, with their direction and unit. */
function rankable(): { metric_id: string; label: string; unit: Indicator['unit']; higherIsBetter?: boolean; why: string }[] {
  const out = new Map<string, { metric_id: string; label: string; unit: Indicator['unit']; higherIsBetter?: boolean; why: string }>();
  for (const s of [...QOL_SECTIONS, ...SENTIMENT_SECTIONS, ...SECTIONS]) {
    for (const i of [s.headline, ...s.others]) {
      if (/^hsl_|_oecd$/.test(i.metric_id)) out.set(i.metric_id, { metric_id: i.metric_id, label: i.label, unit: i.unit, higherIsBetter: i.higherIsBetter, why: i.why });
      if (i.peers) out.set(i.peers.metric_id, { metric_id: i.peers.metric_id, label: i.peers.label, unit: (i.peers.unit as Indicator['unit']) ?? i.unit, higherIsBetter: i.higherIsBetter, why: i.why });
    }
  }
  return [...out.values()];
}

async function rankings(db: Db): Promise<Dataset[]> {
  const names = await entityNames();
  const out: Dataset[] = [];
  for (const m of rankable()) {
    const all = await loadObservations(db, m.metric_id).catch(() => []);
    const peers = peerTable(all, m.metric_id, m.label, m.unit, m.higherIsBetter);
    if (!peers || peers.of < 15) continue;
    const { data: meta } = await db.from('metrics').select('source_org, source_dataset, source_url, unit, basis').eq('metric_id', m.metric_id).maybeSingle();
    out.push({
      key: `rank:${m.metric_id}`,
      spec: {
        template: 'ranked', unit: m.unit, measure: m.label, period: peers.period,
        rows: peers.rows.map((r) => ({ label: names.get(r.entity) ?? r.entity, code: r.entity, value: r.value, highlight: r.entity === 'AUS' })),
        median: peers.median, rank: peers.rank, of: peers.of, bestFirst: peers.bestFirst, higherIsBetter: m.higherIsBetter,
      },
      sources: [{ org: meta?.source_org ?? 'OECD', dataset: meta?.source_dataset ?? m.metric_id, url: meta?.source_url ?? undefined }],
      // The source's own definition, so the words can't drift ("eligible" where the source says "registered").
      context: `${m.why}${meta?.unit ? ` Unit, as the source defines it: ${meta.unit}.` : ''}${meta?.basis ? ` Definition: ${meta.basis}.` : ''}`,
    });
  }
  return out;
}

async function breakdown(db: Db, dataset: string, since: string) {
  const rows: { category: string; category_name: string; category_level: string; period: string; value: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('breakdowns').select('category, category_name, category_level, period, value').eq('dataset', dataset).eq('region', 'AUS').gte('period', since).order('period').range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data.map((r) => ({ ...r, value: Number(r.value) })));
    if (data.length < 1000) break;
  }
  return rows;
}

/** Sum the twelve months (monthly) or four quarters (quarterly) to `end` for each category; null if any is missing. */
function twelve(rows: { category: string; period: string; value: number }[], end: string) {
  const q = /-Q\d$/.test(end);
  const n = q ? 4 : 12;
  const idx = q ? Number(end.slice(0, 4)) * 4 + Number(end.slice(-1)) - 1 : Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  const lab = (i: number) => (q ? `${Math.floor(i / 4)}-Q${(i % 4) + 1}` : `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  const want = new Set(Array.from({ length: n }, (_, k) => lab(idx - k)));
  const seen = new Set<string>();
  const sums = new Map<string, number>();
  for (const r of rows) if (want.has(r.period)) { seen.add(r.period); sums.set(r.category, (sums.get(r.category) ?? 0) + r.value); }
  return seen.size === n ? sums : null;
}

const monthWord = (p: string) => new Date(`${p.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function travel(db: Db, dataset: 'visitors_country' | 'residents_trips_country'): Promise<Dataset[]> {
  const rows = await breakdown(db, dataset, '2018-01');
  const end = rows.at(-1)?.period;
  if (!end) return [];
  const now = twelve(rows, end), base = twelve(rows, `2019-${end.slice(5, 7)}`);
  if (!now) return [];
  const names = new Map(rows.map((r) => [r.category, { name: shortName(r.category_name), level: r.category_level, raw: r.category_name }]));
  const items = [...now.entries()].filter(([c]) => { const n = names.get(c); return !!n && isCountryItem(c, n.raw, n.level); }).sort((a, b) => b[1] - a[1]);
  const total = now.get('TOT') ?? items.reduce((s, [, v]) => s + v, 0);
  const visitors = dataset === 'visitors_country';
  const label = visitors ? 'Short-term visitor arrivals' : 'Short-term trips abroad by Australian residents';
  const period = `12 months to ${monthWord(end)}`;
  const src = [{ org: 'ABS', dataset: 'Overseas Arrivals and Departures (OAD_COUNTRY)', url: 'https://data.api.abs.gov.au/rest/data/ABS,OAD_COUNTRY' }];
  const top = items.slice(0, 12);
  const out: Dataset[] = [{
    key: `mix:${dataset}`,
    spec: { template: 'treemap', unit: 'persons', measure: `${label}, by ${visitors ? 'country of residence' : 'destination'}`, period, total,
      rows: [...top.map(([c, v]) => ({ label: names.get(c)!.name, code: c, value: v })), { label: 'All others', code: 'OTHER', value: total - top.reduce((s, [, v]) => s + v, 0) }] },
    sources: src, context: visitors ? 'Visitors staying less than a year, by where they live.' : 'Australians returning from trips of less than a year, by main destination.',
  }];
  if (base) {
    out.push({
      key: `change:${dataset}:2019`,
      spec: { template: 'change', unit: 'persons', measure: `${label}, ${period} against the same months of 2019`, period, priorPeriod: `12 months to ${monthWord(`2019-${end.slice(5, 7)}`)}`,
        rows: items.slice(0, 15).map(([c, v]) => ({ label: names.get(c)!.name, code: c, value: v, prior: base.get(c) ?? null })) },
      sources: src, context: '2019 is the last full year before the border closures of 2020 and 2021.',
    });
  }
  return out;
}

async function bornOverseas(db: Db): Promise<Dataset[]> {
  const rows = await breakdown(db, 'erp_cob', '2000');
  const end = rows.at(-1)?.period;
  if (!end) return [];
  const p10 = String(Number(end) - 10);
  const at = (p: string) => new Map(rows.filter((r) => r.period === p).map((r) => [r.category, r]));
  const now = at(end), then = at(p10);
  const items = [...now.values()].filter((r) => isCountryItem(r.category, r.category_name, r.category_level) && r.category !== '1101').sort((a, b) => b.value - a.value);
  const overseas = (now.get('TOT')?.value ?? 0) - (now.get('1101')?.value ?? 0);
  const src = [{ org: 'ABS', dataset: 'Estimated resident population by country of birth (ERP_COB)', url: 'https://data.api.abs.gov.au/rest/data/ABS,ERP_COB' }];
  const top = items.slice(0, 12);
  return [
    { key: 'mix:erp_cob', spec: { template: 'treemap', unit: 'persons', measure: 'Australian residents born overseas, by country of birth', period: `30 June ${end}`, total: overseas,
        rows: [...top.map((r) => ({ label: shortName(r.category_name), code: r.category, value: r.value })), { label: 'All other countries', code: 'OTHER', value: overseas - top.reduce((s, r) => s + r.value, 0) }] },
      sources: src, context: `${overseas.toLocaleString('en-AU')} of ${(now.get('TOT')?.value ?? 0).toLocaleString('en-AU')} residents were born overseas.` },
    { key: 'change:erp_cob:10y', spec: { template: 'change', unit: 'persons', measure: 'Australian residents by country of birth, the 15 largest overseas-born groups', period: `30 June ${end}`, priorPeriod: `30 June ${p10}`,
        rows: items.slice(0, 15).map((r) => ({ label: shortName(r.category_name), code: r.category, value: r.value, prior: then.get(r.category)?.value ?? null })) },
      sources: src, context: 'Ten years of change in where Australia\'s overseas-born residents come from.' },
  ];
}

async function visas(db: Db): Promise<Dataset[]> {
  const rows = await breakdown(db, 'migrant_arrivals_visa', '2015-Q1');
  const end = rows.at(-1)?.period;
  if (!end) return [];
  const now = twelve(rows, end);
  if (!now) return [];
  const names = new Map(rows.map((r) => [r.category, { name: r.category_name, level: r.category_level }]));
  const items = [...now.entries()].filter(([c, v]) => names.get(c)?.level === 'item' && v > 0).sort((a, b) => b[1] - a[1]);
  const clean = (n: string) => n.replace(/^Temporary visa ?- ?/i, '').replace(/^Permanent visa - /i, 'Permanent: ').replace(/^Student ?- ?/i, 'Student: ').replace(/^student - /i, 'Student: ').replace(/ \(subclass 444\)/, '').replace(/^Student: Higher education sector$/i, 'University students');
  const total = now.get('1041') ?? items.reduce((s, [, v]) => s + v, 0);
  const [y, q] = end.split('-Q');
  return [{
    key: 'mix:migrant_arrivals_visa', spec: { template: 'treemap', unit: 'persons', measure: 'Overseas migrant arrivals, by visa', total,
      period: `12 months to the ${['March', 'June', 'September', 'December'][Number(q) - 1]} quarter ${y}`, rows: items.map(([c, v]) => ({ label: clean(names.get(c)!.name), code: c, value: v })) },
    sources: [{ org: 'ABS', dataset: 'Overseas migrant arrivals and departures by visa (OMAD_VISA)', url: 'https://data.api.abs.gov.au/rest/data/ABS,OMAD_VISA' }],
    context: 'People arriving to stay at least 12 of the next 16 months.',
  }];
}

async function economyMix(): Promise<Dataset[]> {
  const d = await loadPnl();
  if (!d) return [];
  const n = d.now;
  const [y, q] = n.end.split('-Q');
  const rows = [
    ['Wages and salaries', 'coe', n.coe], ['Company profits (private)', 'pnfc', n.profitsPrivate], ['Banks and financial firms', 'fc', n.profitsFinancial],
    ['Taxes on production', 'tax', n.taxes], ['Owner-occupied homes', 'homes', n.homes], ['Small business and farms', 'gmi', n.smallBusiness],
    ['Government', 'gov', n.govSurplus], ['Government-owned businesses', 'gnfc', n.profitsPublic],
  ] as const;
  return [{
    key: 'mix:pnl_income', spec: { template: 'treemap', unit: 'aud_m', measure: 'Australia\'s GDP by who earns it (income approach)', total: n.gdp,
      period: `year to the ${['March', 'June', 'September', 'December'][Number(q) - 1]} quarter ${y}`, rows: rows.map(([label, code, value]) => ({ label, code, value })) },
    sources: [{ org: 'ABS', dataset: 'Australian National Accounts: income from GDP (ANA_INC)', url: 'https://data.api.abs.gov.au/rest/data/ABS,ANA_INC' }],
    context: 'GDP measured by income: what workers, businesses, home owners and government earn producing in Australia.',
    // Shares are of GDP itself, so the only total in the facts is GDP. The ABS's small statistical discrepancy isn't
    // a slice, so the parts' shares sum to a touch over 100%; the note says so without giving the parts' sum.
    notes: [`Shares are of GDP. A statistical discrepancy of ${n.discrepancy < 0 ? '−' : ''}$${(Math.abs(n.discrepancy) / 1000).toFixed(1)} billion is not shown, so the shares add to slightly more than 100%.`],
  }];
}

export async function buildDatasets(): Promise<Dataset[]> {
  const db = createClient();
  const parts = await Promise.all([rankings(db), travel(db, 'visitors_country'), travel(db, 'residents_trips_country'), bornOverseas(db), visas(db), economyMix()]);
  return parts.flat();
}
