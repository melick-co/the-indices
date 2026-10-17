import { fyLabel, qIndex, qLabel, yearStatement, yearSum } from '../../agent/scripts/lib/gfs.mjs';

/**
 * Pure helpers for the government's profit and loss (lib/gov-pnl.ts loads the data; components/dashboard/GovPnl.tsx
 * shows it). Kept apart from the database client so gov-pnl.check.ts can run them.
 */
export type Sector = 'cwth' | 'all';
export type GovStatement = Record<string, number | null> & { revenue: number; expense: number; nob: number; net_investment: number; nlb: number };
export type Quarters = Map<string, Record<string, number>>;

export type GovPnlData = {
  /** Last quarter of the four summed, the latest both sectors have. */
  end: string;
  cwth: { now: GovStatement; prior: GovStatement | null };
  all: { now: GovStatement; prior: GovStatement | null };
  /** All governments' own latest four quarters, when it runs a quarter or more ahead of the Commonwealth. */
  allAhead: { end: string; nob: number; nlb: number } | null;
  population: { value: number; period: string } | null;
  /** GDP over the same four quarters (ABS national accounts, pnl_gdp), for shares of GDP. */
  gdp: number | null;
  /** Financial years (to June): net operating balance and net lending as % of GDP, each sector where it has the year. */
  years: { fy: string; cwthNob: number | null; cwthNlb: number | null; allNob: number | null; allNlb: number | null }[];
};

/** Rows from the store → Map(period → { suffix: value }) for one sector. */
export function toQuarters(rows: { suffix: string; period: string; value: number }[]): Quarters {
  const m: Quarters = new Map();
  for (const r of rows) {
    if (!m.has(r.period)) m.set(r.period, {});
    m.get(r.period)![r.suffix] = r.value;
  }
  return m;
}

/** The statement for the four quarters to `end`, or null. */
export function govStatement(q: Quarters, end: string): GovStatement | null {
  return yearStatement(q, end) as GovStatement | null;
}

/** The latest quarter both sectors can make a four-quarter statement for. */
export function commonEnd(cwth: Quarters, all: Quarters): string | null {
  const ends = [...cwth.keys()].filter((p) => all.has(p)).sort().reverse();
  return ends.find((p) => govStatement(cwth, p) && govStatement(all, p)) ?? null;
}

/** Sum of a quarterly series over the four quarters to `end`, or null. */
export function sumFour(series: Map<string, number>, end: string): number | null {
  let t = 0;
  for (let k = 0; k < 4; k++) {
    const v = series.get(qLabel(qIndex(end) - k));
    if (v == null) return null;
    t += v;
  }
  return t;
}

/** Financial-year history of the balances as % of GDP. */
export function fiscalYears(cwth: Quarters, all: Quarters, gdp: Map<string, number>) {
  const junes = [...new Set([...cwth.keys(), ...all.keys()])].filter((p) => p.endsWith('-Q2')).sort();
  return junes.map((q) => {
    const g = sumFour(gdp, q);
    if (!g) return null;
    const pct = (m: Quarters, s: 'nob' | 'nlb') => { const v = yearSum(m, s, q); return v == null ? null : Math.round((v / g) * 1000) / 10; };
    const row = { fy: fyLabel(q), cwthNob: pct(cwth, 'nob'), cwthNlb: pct(cwth, 'nlb'), allNob: pct(all, 'nob'), allNlb: pct(all, 'nlb') };
    return row.cwthNlb == null && row.allNlb == null ? null : row;
  }).filter((x): x is NonNullable<typeof x> => x != null);
}

/** The latest run of consecutive financial years ("2023–24", "2024–25", ...). */
export function consecutiveTail<T extends { fy: string }>(years: T[]): T[] {
  let i = years.length - 1;
  while (i > 0 && Number(years[i].fy.slice(0, 4)) - Number(years[i - 1].fy.slice(0, 4)) === 1) i--;
  return years.slice(Math.max(0, i));
}

export type GovLine = {
  key: string; label: string; note?: string; kind?: 'sub' | 'total' | 'bottom' | 'less';
  get: (s: GovStatement) => number | null;
  /** Balances that can change sign: show the change in dollars, not per cent. */
  swing?: boolean;
};

/** The statement, top to bottom: what the government takes in, what it spends, and what it has to borrow. */
export const GOV_LINES: GovLine[] = [
  { key: 'h1', label: 'Revenue', get: () => null, kind: 'sub' },
  { key: 'inc', label: 'Income tax', note: 'Taxes on income, profits and capital gains: individuals and companies', get: (s) => s.tax_income },
  { key: 'pay', label: 'Payroll tax', note: 'Taxes on payroll and workforce, almost all levied by the states', get: (s) => s.tax_payroll },
  { key: 'prop', label: 'Property taxes', note: 'Stamp duty, land tax and council rates: state and local', get: (s) => s.tax_property },
  { key: 'gst', label: 'GST, excise, customs and other taxes', note: 'Taxes on goods and services, international trade and other taxes', get: (s) => s.tax_goods_other },
  { key: 'orev', label: 'Other revenue', note: 'Sales of goods and services, interest, dividends and the like', get: (s) => s.other_rev_all },
  { key: 'rev', label: 'Revenue', get: (s) => s.revenue, kind: 'total' },
  { key: 'h2', label: 'Expenses', get: () => null, kind: 'sub' },
  { key: 'ben', label: 'Benefits to people', note: 'Pensions, allowances, family payments and other social benefits', get: (s) => s.social_benefits },
  { key: 'grants', label: 'Grants', note: 'Mostly to the states, including the GST; grants between governments are netted out of all governments', get: (s) => s.grants_paid },
  { key: 'goods', label: 'Running costs and services bought in', note: 'Use of goods and services', get: (s) => s.goods_services },
  { key: 'emp', label: 'Wages and super', note: 'Compensation of public servants, including superannuation', get: (s) => s.employees },
  { key: 'int', label: 'Interest', note: 'Interest on government debt and other liabilities', get: (s) => s.interest },
  { key: 'subs', label: 'Subsidies', note: 'Payments to businesses and producers', get: (s) => s.subsidies },
  { key: 'dep', label: 'Depreciation', note: 'Wear and tear on buildings, roads, defence equipment and the like', get: (s) => s.depreciation },
  { key: 'oexp', label: 'Other expenses', get: (s) => s.other_exp },
  { key: 'exp', label: 'Expenses', get: (s) => s.expense, kind: 'total' },
  { key: 'nob', label: 'Operating balance', note: 'Revenue less expenses: the operating surplus (+) or deficit (−)', get: (s) => s.nob, kind: 'bottom', swing: true },
  { key: 'inv', label: 'Less: net investment in assets', note: 'New buildings, roads and equipment, less depreciation and asset sales', get: (s) => -s.net_investment, kind: 'less', swing: true },
  { key: 'nlb', label: 'Borrowing (net lending / borrowing)', note: 'The fiscal balance: borrowed (−) or available to lend (+) after paying for new assets', get: (s) => s.nlb, kind: 'bottom', swing: true },
];

/** The change column: per cent for lines that keep their sign, dollars for balances; null when there's no comparison. */
export function govChange(l: GovLine, now: number | null, prior: number | null): { text: string; up: boolean } | null {
  if (now == null || prior == null) return null;
  if (l.swing) {
    const dlt = now - prior;
    const b = `$${(Math.abs(dlt) / 1000).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}bn`;
    return { text: `${dlt >= 0 ? '+' : '−'}${b}`, up: dlt >= 0 };
  }
  if (prior === 0) return null;
  const c = ((now - prior) / Math.abs(prior)) * 100;
  return { text: `${c >= 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%`, up: c >= 0 };
}

