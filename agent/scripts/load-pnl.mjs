/**
 * "Australia Inc.": the national accounts read as a profit and loss statement (ABS Data API, official, tier 1).
 *
 * Quarterly, current prices, original series (so four quarters sum exactly to a year), $ millions, entity AUS:
 *   income side of GDP (ANA_INC)   pnl_coe, pnl_gos_<sector>, pnl_gmi, pnl_nit, pnl_sdi, pnl_gdp
 *   national aggregates (ANA_AGG)  pnl_gni, pnl_sav
 *   spending (ANA_EXP)             pnl_fce, pnl_fce_hh, pnl_fce_gov, pnl_gfcf, pnl_inv, pnl_exports, pnl_imports
 *   balance of payments (BOP)      pnl_current_account, pnl_primary_income, pnl_secondary_income
 *
 * Depreciation (consumption of fixed capital) isn't published at current prices in the API, so the page derives it
 * from the national income account identity: net saving = GNI + net transfers from abroad − consumption − depreciation.
 *
 * Before storing, it checks the statement adds up: the income components sum to GDP, and GDP from the income side
 * matches GDP in the other tables. A failure stops the load.
 *
 *   node scripts/load-pnl.mjs --dry-run   fetch, check and print the latest year, write nothing
 *   node scripts/load-pnl.mjs             upsert
 */
import { absCsv } from './load-population.mjs';

const base = 'https://data.api.abs.gov.au/rest/data/ABS,';
const IN_MILLIONS = new Set(['ANA_INC']);

const SERIES = [
  // [metric_id, name, flow, key, filter(row) → boolean]
  ['pnl_coe', 'Compensation of employees (wages, salaries and employer contributions)', 'ANA_INC', 'C.COE.SSS.10.AUS.Q'],
  ['pnl_gos_pnfc', 'Gross operating surplus: private non-financial corporations', 'ANA_INC', 'C.GOS.PTS.10.AUS.Q'],
  ['pnl_gos_gnfc', 'Gross operating surplus: public non-financial corporations', 'ANA_INC', 'C.GOS.GTS.10.AUS.Q'],
  ['pnl_gos_fc', 'Gross operating surplus: financial corporations', 'ANA_INC', 'C.GOS.SFS.10.AUS.Q'],
  ['pnl_gos_gov', 'Gross operating surplus: general government', 'ANA_INC', 'C.GOS.GGS.10.AUS.Q'],
  ['pnl_gos_dwell', 'Gross operating surplus: dwellings owned by persons', 'ANA_INC', 'C.GOS.PHD.10.AUS.Q'],
  ['pnl_gos', 'Gross operating surplus: all sectors', 'ANA_INC', 'C.GOS.SSS.10.AUS.Q'],
  ['pnl_gmi', 'Gross mixed income (unincorporated businesses)', 'ANA_INC', 'C.GMI.SSS.10.AUS.Q'],
  ['pnl_nit', 'Taxes less subsidies on production and imports', 'ANA_INC', 'C.NIT.SSS.10.AUS.Q'],
  ['pnl_sdi', 'Statistical discrepancy (income)', 'ANA_INC', 'C.SDI.SSS.10.AUS.Q'],
  ['pnl_gdp', 'Gross domestic product (income)', 'ANA_INC', 'C.GPM.SSS.10.AUS.Q'],
  ['pnl_gni', 'Gross national income', 'ANA_AGG', 'M3.GNI.10.AUS.Q'],
  ['pnl_sav', 'Net saving (national)', 'ANA_AGG', 'M3.SAV.10.AUS.Q'],
  ['pnl_gdp_agg', 'Gross domestic product (key aggregates)', 'ANA_AGG', 'M3.GPM.10.AUS.Q'],
  ['pnl_fce', 'Final consumption expenditure (all sectors)', 'ANA_EXP', 'C.FCE.SSS.10.AUS.Q'],
  ['pnl_fce_hh', 'Household final consumption expenditure', 'ANA_EXP', 'C.FCE.PHS.10.AUS.Q'],
  ['pnl_fce_gov', 'General government final consumption expenditure', 'ANA_EXP', 'C.FCE.GGS.10.AUS.Q'],
  ['pnl_gfcf', 'Gross fixed capital formation (all sectors)', 'ANA_EXP', 'C.GFC.SSS.10.AUS.Q'],
  ['pnl_inv', 'Changes in inventories', 'ANA_EXP', 'C.IST.SSS.10.AUS.Q'],
  ['pnl_exports', 'Exports of goods and services', 'ANA_EXP', 'C.XGS.SSS.10.AUS.Q'],
  ['pnl_imports', 'Imports of goods and services', 'ANA_EXP', 'C.MGS.SSS.10.AUS.Q'],
  ['pnl_gdp_exp', 'Gross domestic product (expenditure)', 'ANA_EXP', 'C.GPM.SSS.10.AUS.Q'],
  ['pnl_current_account', 'Current account balance', 'BOP', '1.100.10.Q'],
  ['pnl_primary_income', 'Net primary income (income from abroad less income paid abroad)', 'BOP', '1.8700.10.Q'],
  ['pnl_secondary_income', 'Net secondary income (current transfers from abroad less to abroad)', 'BOP', '1.8100.10.Q'],
];

async function fetchAll() {
  const out = new Map();
  for (const [id, name, flow, key] of SERIES) {
    const rows = await absCsv(flow, key, '?startPeriod=1990-Q1');
    // Stored in $ millions. ANA_AGG, ANA_EXP and BOP carry UNIT_MULT 6 (applied by absCsv, so divide back down);
    // ANA_INC publishes millions with no multiplier (UNIT_MULT 0: COE 368,607 for June quarter 2026 is $368.6 billion).
    const toMillions = (r) => (IN_MILLIONS.has(flow) && Number(r.UNIT_MULT || 0) === 0 ? r.value : r.value / 1e6);
    const pts = rows.map((r) => ({ period: r.TIME_PERIOD, value: Math.round(toMillions(r)) })).sort((a, b) => a.period.localeCompare(b.period));
    if (!pts.length) throw new Error(`${id}: no data for ${flow}/${key}`);
    out.set(id, { id, name, flow, key, pts });
  }
  return out;
}

/** The four quarters to `end`, summed. */
function year(series, end) {
  const i = series.pts.findIndex((p) => p.period === end);
  if (i < 3) return null;
  return series.pts.slice(i - 3, i + 1).reduce((s, p) => s + p.value, 0);
}

export async function loadPnl({ dry = false } = {}) {
  const all = await fetchAll();
  const end = all.get('pnl_gdp').pts.at(-1).period;
  const y = (id) => year(all.get(id), end);

  // Checks: the statement must add up before anything is stored.
  const income = y('pnl_coe') + y('pnl_gos') + y('pnl_gmi') + y('pnl_nit') + y('pnl_sdi');
  const gosParts = y('pnl_gos_pnfc') + y('pnl_gos_gnfc') + y('pnl_gos_fc') + y('pnl_gos_gov') + y('pnl_gos_dwell');
  const checks = [
    ['income components sum to GDP', income, y('pnl_gdp')],
    ['sector operating surpluses sum to the total', gosParts, y('pnl_gos')],
    ['GDP (income) equals GDP (key aggregates)', y('pnl_gdp'), y('pnl_gdp_agg')],
    ['GDP (income) equals GDP (expenditure)', y('pnl_gdp'), y('pnl_gdp_exp')],
    ['household + government consumption equals total consumption', y('pnl_fce_hh') + y('pnl_fce_gov'), y('pnl_fce')],
  ];
  // Reported, not enforced: the balance of payments and the national accounts are separate releases and their
  // primary income can differ by a few per cent. The statement uses the national accounts (GNI − GDP) so it adds up.
  const warnings = [
    ['GNI less GDP against net primary income (balance of payments)', y('pnl_gni') - y('pnl_gdp'), y('pnl_primary_income')],
  ];
  let failed = false;
  for (const [what, a, b] of checks) {
    const ok = Math.abs(a - b) <= Math.max(5, Math.abs(b) * 0.0005);
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${a.toLocaleString('en-AU')} vs ${b.toLocaleString('en-AU')} ($m, four quarters to ${end})`);
  }

  for (const [what, a, b] of warnings) {
    console.log(`note ${what}: ${a.toLocaleString('en-AU')} vs ${b.toLocaleString('en-AU')} (${Math.round(Math.abs(a - b) / Math.abs(b) * 1000) / 10}% apart)`);
  }

  // The statement for the latest four quarters, as the page will show it.
  const gdp = y('pnl_gdp'), gni = y('pnl_gni'), si = y('pnl_secondary_income'), fce = y('pnl_fce'), sav = y('pnl_sav');
  const cfc = gni + si - fce - sav;
  const nni = gni - cfc, nndi = nni + si;
  console.log(`\nAustralia Inc., four quarters to ${end} ($ billion)`);
  for (const [label, v] of [
    ['GDP (revenue)', gdp], ['less net income paid abroad', gdp - gni], ['= GNI', gni], ['less depreciation', cfc], ['= net national income', nni],
    ['plus net transfers from abroad', si], ['less household consumption', y('pnl_fce_hh')], ['less government consumption', y('pnl_fce_gov')],
    ['= net saving (bottom line)', sav], ['investment (GFCF + inventories)', y('pnl_gfcf') + y('pnl_inv')], ['current account', y('pnl_current_account')],
    ['(net national disposable income)', nndi],
  ]) console.log(`  ${label.padEnd(36)} ${(v / 1000).toFixed(1).padStart(8)}`);
  if (failed) throw new Error('The statement does not add up; nothing stored.');
  if (dry) return;

  const { createDb, upsertSeries } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  for (const s of all.values()) {
    await upsertSeries(db, {
      metric_id: s.id, name: s.name, unit: 'AUD millions', basis: `${s.name}, current prices, original, quarterly`,
      direction: 'neutral', category: 'national_accounts', source_tier: 1, source_org: 'ABS',
      source_dataset: `${s.flow} (ABS Data API)`, source_url: `${base}${s.flow}/${s.key}`,
    }, s.pts.map((p) => ({ metric_id: s.id, entity: 'AUS', period: p.period, value: p.value })));
  }
  console.log(`Stored ${all.size} series.`);
}

if (process.argv[1]?.endsWith('load-pnl.mjs')) {
  await loadPnl({ dry: process.argv.includes('--dry-run') });
}
