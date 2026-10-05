import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';

/**
 * "Australia Inc.": the national accounts read as a profit and loss statement. Quarterly ABS series (pnl_*, loaded by
 * agent/scripts/load-pnl.mjs, $ millions, current prices, original) summed over four quarters.
 *
 * Depreciation (consumption of fixed capital) isn't published at current prices in the API, so it is derived from the
 * national income account identity: net saving = GNI + net transfers from abroad − consumption − depreciation.
 */
type Pt = { period: string; value: number };

const IDS = ['pnl_coe', 'pnl_gos_pnfc', 'pnl_gos_fc', 'pnl_gos_gnfc', 'pnl_gos_gov', 'pnl_gos_dwell', 'pnl_gmi', 'pnl_nit', 'pnl_sdi', 'pnl_gdp',
  'pnl_gni', 'pnl_sav', 'pnl_fce', 'pnl_fce_hh', 'pnl_fce_gov', 'pnl_gfcf', 'pnl_inv', 'pnl_current_account', 'pnl_primary_income', 'pnl_secondary_income',
  'pnl_exports', 'pnl_imports'] as const;
type Id = typeof IDS[number];

export type Statement = {
  end: string;
  coe: number; profitsPrivate: number; profitsFinancial: number; profitsPublic: number; govSurplus: number; homes: number; smallBusiness: number;
  taxes: number; discrepancy: number; gdp: number;
  paidAbroad: number; gni: number; depreciation: number; nni: number; transfers: number; nndi: number;
  consumptionHh: number; consumptionGov: number; saving: number;
  investment: number; grossSaving: number; currentAccount: number; primaryIncomeBop: number; exports: number; imports: number;
};

export type PnlData = {
  now: Statement; prior: Statement | null;
  population: { value: number; period: string } | null;
  /** Financial years (to June): revenue, net saving as a share of GNI, current account as a share of GDP. */
  years: { fy: string; gdp: number; savingRate: number; currentAccountShare: number; depreciationShare: number }[];
};

const qIndex = (p: string) => { const [y, q] = p.split('-Q').map(Number); return y * 4 + q - 1; };
const qLabel = (i: number) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;

function statement(s: Map<Id, Map<string, number>>, end: string): Statement | null {
  const four = Array.from({ length: 4 }, (_, k) => qLabel(qIndex(end) - k));
  const y = (id: Id) => {
    const m = s.get(id);
    if (!m || four.some((q) => !m.has(q))) return null;
    return four.reduce((t, q) => t + m.get(q)!, 0);
  };
  const v = Object.fromEntries(IDS.map((id) => [id, y(id)])) as Record<Id, number | null>;
  if (IDS.some((id) => v[id] == null)) return null;
  const n = v as Record<Id, number>;
  const depreciation = n.pnl_gni + n.pnl_secondary_income - n.pnl_fce - n.pnl_sav;
  return {
    end,
    coe: n.pnl_coe, profitsPrivate: n.pnl_gos_pnfc, profitsFinancial: n.pnl_gos_fc, profitsPublic: n.pnl_gos_gnfc, govSurplus: n.pnl_gos_gov,
    homes: n.pnl_gos_dwell, smallBusiness: n.pnl_gmi, taxes: n.pnl_nit, discrepancy: n.pnl_sdi, gdp: n.pnl_gdp,
    paidAbroad: n.pnl_gdp - n.pnl_gni, gni: n.pnl_gni, depreciation, nni: n.pnl_gni - depreciation, transfers: n.pnl_secondary_income,
    nndi: n.pnl_gni - depreciation + n.pnl_secondary_income,
    consumptionHh: n.pnl_fce_hh, consumptionGov: n.pnl_fce_gov, saving: n.pnl_sav,
    investment: n.pnl_gfcf + n.pnl_inv, grossSaving: n.pnl_sav + depreciation, currentAccount: n.pnl_current_account,
    primaryIncomeBop: n.pnl_primary_income, exports: n.pnl_exports, imports: n.pnl_imports,
  };
}

export async function loadPnl(): Promise<PnlData | null> {
  const db = createClient();
  const series = new Map<Id, Map<string, number>>();
  await Promise.all(IDS.map(async (id) => {
    const obs = await loadObservations(db, id).catch(() => []);
    series.set(id, new Map(obs.filter((o) => o.entity === 'AUS').map((o) => [o.period, o.value])));
  }));
  // The latest quarter every series has.
  const common = [...(series.get('pnl_gdp')?.keys() ?? [])].filter((q) => IDS.every((id) => series.get(id)?.has(q))).sort();
  const end = common.at(-1);
  if (!end) return null;
  const now = statement(series, end);
  if (!now) return null;
  const prior = statement(series, qLabel(qIndex(end) - 4));
  const years = common.filter((q) => q.endsWith('-Q2')).map((q) => {
    const st = statement(series, q);
    if (!st) return null;
    const y = Number(q.slice(0, 4));
    return { fy: `${y - 1}–${String(y).slice(2)}`, gdp: st.gdp, savingRate: (st.saving / st.gni) * 100, currentAccountShare: (st.currentAccount / st.gdp) * 100, depreciationShare: (st.depreciation / st.gdp) * 100 };
  }).filter((x): x is NonNullable<typeof x> => x != null);
  // Population for per-person figures: the latest estimate at or before the end of the statement's year.
  const pop: Pt[] = (await loadObservations(db, 'pop_erp_q').catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
  const p = [...pop].reverse().find((x) => x.period <= end) ?? null;
  return { now, prior, population: p, years };
}
