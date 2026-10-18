/**
 * The Australian Government's budget balances by financial year, from Treasury's historical tables: Budget Paper
 * No. 1, Statement 11 "Historical Australian Government Data", in the current Budget at budget.gov.au. Official, tier 1.
 * The statement is published as a Word document only (no spreadsheet, CSV or API carries these tables); the editor
 * approved it as an exception to the official-API rule (October 2026).
 *
 *   budget_fiscal_balance_au                    fiscal balance (accrual net lending (+) / borrowing (−)), $m   Table 11.6
 *   budget_fiscal_balance_pct_gdp_au            the same, per cent of GDP, as the table prints it            Table 11.6
 *   budget_underlying_cash_balance_au           underlying cash balance (the headline budget measure), $m     Table 11.1
 *   budget_underlying_cash_balance_pct_gdp_au   the same, per cent of GDP                                      Table 11.1
 * General government sector; period = financial year ("2024-25"); entity AUS. Outcomes only: rows the table marks
 * "(e)" (the Budget year and forward estimates) are left out, and an estimate that ever comes before an outcome stops
 * the load.
 *
 * Checks before anything is stored: every row must add up (revenue − expenses = net operating balance, less net capital
 * investment = fiscal balance; receipts − payments [− net Future Fund earnings, 2005–06 to 2019–20] = underlying cash
 * balance; within $2m of rounding), years must run without a break, and the fiscal balance is reconciled with the IMF's
 * quarterly GFS for the Commonwealth (four quarters to June, the series load-gfs.mjs stores): differences are logged,
 * and a gross one (more than 25% and more than $2bn) stops the load.
 *
 * The tables change once a year, with the Budget; the daily sources run re-reads them and upserts (nothing changes
 * between Budgets).
 *
 *   node scripts/load-budget-history.mjs --dry-run   fetch, check and print, write nothing
 *   node scripts/load-budget-history.mjs             upsert
 */
import { budgetName, docxTables, parseFiscal, parseUnderlyingCash, reconcile, statement11Url, unzipEntry } from './lib/budget-history.mjs';
import { usableQuarter } from './lib/gfs.mjs';

const UA = 'caveat-indices/0.1 (+https://caveat.news)';
export const BP1_PAGE = 'https://budget.gov.au/content/bp1/index.htm';

async function get(url, as = 'text') {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
    if (res.ok) return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text();
    if (!(res.status >= 500 || res.status === 429) || i >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
}

/** The IMF's Commonwealth net lending by financial year (four complete, usable quarters to June), $m. */
async function imfByYear() {
  const { fetchAll } = await import('./load-gfs.mjs');
  const raw = await fetchAll();
  const out = new Map();
  for (const [p] of raw.cwth) {
    if (!p.endsWith('-Q2')) continue;
    const y = Number(p.slice(0, 4));
    const qs = [`${y - 1}-Q3`, `${y - 1}-Q4`, `${y}-Q1`, `${y}-Q2`];
    if (qs.some((q) => !usableQuarter('cwth', q) || raw.cwth.get(q)?.nlb == null)) continue;
    out.set(`${y - 1}-${String(y).slice(2)}`, qs.reduce((t, q) => t + raw.cwth.get(q).nlb, 0));
  }
  return out;
}

export async function loadBudgetHistory({ dry = false } = {}) {
  const page = await get(BP1_PAGE);
  const budget = budgetName(page);
  const url = statement11Url(page, BP1_PAGE);
  if (!budget || !url) throw new Error(`Budget Paper No. 1 page: ${budget ? '' : 'no Budget in the title; '}${url ? '' : 'no Statement 11 .docx link'}`);
  const docx = await get(url, 'buffer');
  const xml = unzipEntry(docx, 'word/document.xml');
  if (!xml) throw new Error(`${url}: no word/document.xml`);
  const tables = docxTables(xml.toString('utf8'));
  const fiscal = parseFiscal(tables), cash = parseUnderlyingCash(tables);
  const last = fiscal.rows.at(-1).fy;
  console.log(`${budget}, Budget Paper No. 1, Statement 11 (${url})`);
  console.log(`  Table 11.6 fiscal balance: ${fiscal.rows.length} outcome years ${fiscal.rows[0].fy} to ${last}; estimates left out: ${fiscal.estimates.join(', ')}`);
  console.log(`  Table 11.1 underlying cash balance: ${cash.rows.length} outcome years ${cash.rows[0].fy} to ${cash.rows.at(-1).fy}; estimates left out: ${cash.estimates.join(', ')}`);
  for (const r of fiscal.rows.slice(-20)) {
    const c = cash.rows.find((x) => x.fy === r.fy);
    console.log(`  ${r.fy}  fiscal balance ${(r.fiscalBalance / 1000).toFixed(1).padStart(7)}bn ${r.fiscalBalancePct.toFixed(1).padStart(5)}% of GDP   underlying cash ${c ? `${(c.underlyingCash / 1000).toFixed(1).padStart(7)}bn ${c.underlyingCashPct.toFixed(1).padStart(5)}%` : '—'}`);
  }

  // Against the IMF's quarterly GFS: the same accrual measure, reported to the IMF; small differences are revisions.
  const imf = await imfByYear().catch((e) => { console.log(`  IMF reconciliation skipped: ${e.message}`); return new Map(); });
  const { lines, gross } = reconcile(new Map(fiscal.rows.map((r) => [r.fy, r.fiscalBalance])), imf);
  console.log(`Reconciliation with IMF QGFS (Commonwealth net lending, four quarters to June), ${lines.length} years:`);
  for (const l of lines) console.log(`  ${l}`);
  if (gross.length) throw new Error(`Fiscal balance differs grossly from the IMF's quarterly GFS in ${gross.join(', ')}; nothing stored.`);
  if (dry) return { fiscal, cash, budget, url };

  const { createDb, upsertSeries } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  const dataset = (table) => `${budget} Budget Paper No. 1, Statement 11: Historical Australian Government Data, ${table}`;
  const common = `general government sector, by financial year, outcomes from the Final Budget Outcomes as published in ${budget} Budget Paper No. 1 Statement 11 (${BP1_PAGE}); estimates marked (e) are not stored`;
  const series = [
    ['budget_fiscal_balance_au', 'Australian Government fiscal balance', 'AUD millions', 'Table 11.6', fiscal.rows.map((r) => [r.fy, r.fiscalBalance]),
      `Fiscal balance: revenue less expenses less net capital investment (accrual net lending (+) / borrowing (−)), ${common}`],
    ['budget_fiscal_balance_pct_gdp_au', 'Australian Government fiscal balance, % of GDP', 'percent of GDP', 'Table 11.6', fiscal.rows.map((r) => [r.fy, r.fiscalBalancePct]),
      `Fiscal balance as a share of nominal GDP, as printed in the table (one decimal), ${common}`],
    ['budget_underlying_cash_balance_au', 'Australian Government underlying cash balance', 'AUD millions', 'Table 11.1', cash.rows.map((r) => [r.fy, r.underlyingCash]),
      `Underlying cash balance: receipts less payments, less net Future Fund earnings from 2005–06 to 2019–20, ${common}`],
    ['budget_underlying_cash_balance_pct_gdp_au', 'Australian Government underlying cash balance, % of GDP', 'percent of GDP', 'Table 11.1', cash.rows.map((r) => [r.fy, r.underlyingCashPct]),
      `Underlying cash balance as a share of nominal GDP, as printed in the table (one decimal), ${common}`],
  ];
  for (const [id, name, unit, table, rows, basis] of series) {
    await upsertSeries(db, {
      metric_id: id, name, unit, basis, direction: 'neutral', category: 'government_finance', source_tier: 1, source_org: 'Treasury',
      source_dataset: dataset(table), source_url: url,
    }, rows.map(([period, value]) => ({ metric_id: id, entity: 'AUS', period, value })));
  }
  console.log(`Stored ${series.length} series, outcomes to ${last}.`);
  return { fiscal, cash, budget, url };
}

if (process.argv[1]?.endsWith('load-budget-history.mjs')) {
  await loadBudgetHistory({ dry: process.argv.includes('--dry-run') });
}
