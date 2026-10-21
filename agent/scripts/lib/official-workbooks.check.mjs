import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCORECARD_REQUESTS, aesFiles, checkSeries, latestMedicarePage, latestTableOPage, medicareFile, medicareQuarter, nextQuarter,
  nggiFiles, nggiUpdateUrl, nggiUpdates, parseEmissions, parseMedicare, parseOnGrid, parseTableO, prevQuarter, quarterName,
  quarterOfMonth, quarterOfSerial, reconcileGrid, reportHeadline, yearTo,
} from './official-workbooks.mjs';

/**
 * Small extracts of the live official workbooks (October 2026), as the xlsx reader returns them: the emissions data
 * workbook's Contents title and Data Table 1A (March quarter 2026 release); Table O's AUS FY and AUS CY and the
 * supplementary on-grid and off-grid sheets (June 2026 release); and the Medicare state and territory workbook's
 * Table 1 rows for GP non-referred attendances, three quarters (June quarter 2025-26 release).
 */
const F = JSON.parse(readFileSync(new URL('./fixtures/official-workbooks.json', import.meta.url), 'utf8'));
const book = (x, edit) => {
  const sheets = structuredClone(x.sheets);
  edit?.(sheets);
  return { names: Object.keys(sheets), sheet: (n) => sheets[n] ?? null };
};

// ---------- quarters
assert.equal(nextQuarter('2025-Q4'), '2026-Q1');
assert.equal(prevQuarter('2026-Q1'), '2025-Q4');
assert.equal(quarterOfMonth('March', 2026), '2026-Q1');
assert.equal(quarterOfMonth('sept', '2022'), '2022-Q3');
assert.equal(quarterOfMonth('May', 2026), null);
assert.equal(quarterName('2026-Q2'), 'June 2026');
assert.equal(quarterOfSerial(38231), '2004-Q3', 'the workbook dates a quarter by its last month');
assert.equal(quarterOfSerial(38200), null);

// ---------- emissions: discovery
const list = `<a href="/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-december-2025">Dec</a>
<a href="/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-sept-2022">Sep</a>
<a href="https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-june-2025?x=1">Jun</a>
<a href="/climate-change/publications/national-greenhouse-gas-inventory-march-2020">old style</a>`;
assert.deepEqual(nggiUpdates(list).map((u) => u.quarter), ['2025-Q4', '2025-Q2', '2022-Q3'], 'newest first');
assert.equal(nggiUpdates(list)[1].url, 'https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-june-2025');
assert.equal(nggiUpdateUrl('2026-Q1'), 'https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-march-2026');
const page = `<title>National Greenhouse Gas Inventory Quarterly Update: March 2026 - DCCEEW</title>
<a href="/sites/default/files/documents/quarterly-update-australias-national-greenhouse-gas-inventory-march-2026.pdf">pdf</a>
<a href="/sites/default/files/documents/quarterly-update-australias-national-greenhouse-gas-inventory-march-2026.docx">docx</a>
<a href="/sites/default/files/documents/nggi-quarterly-update-march-2026-data-sources.xlsx">xlsx</a>`;
const nf = nggiFiles(page, nggiUpdateUrl('2026-Q1'));
assert.equal(nf.xlsx, 'https://www.dcceew.gov.au/sites/default/files/documents/nggi-quarterly-update-march-2026-data-sources.xlsx');
assert.match(nf.docx, /march-2026\.docx$/);
assert.equal(nf.title, 'National Greenhouse Gas Inventory Quarterly Update: March 2026 - DCCEEW');

// ---------- emissions: Data Table 1A
const em = parseEmissions(book(F.emissions));
assert.equal(em.named, '2026-Q1');
assert.equal(em.preliminary, '2026-Q2');
assert.equal(em.quarters.length, 87, 'September 2004 to March 2026; the preliminary June 2026 quarter left out');
assert.equal(em.quarters.at(-1).period, '2026-Q1');
assert.ok(Math.abs(em.quarters.at(-1).total - 108.715) < 0.001);
assert.equal(em.quarters[0].fy, '2004-05');
const yt = yearTo(em.quarters);
assert.ok(Math.abs(yt.base - 607.73) < 0.01, `year to June 2005 ${yt.base}`);
assert.equal(yt.yearTo[0].period, '2005-Q2');
assert.ok(Math.abs(yt.yearTo.at(-1).value - 455.647) < 0.01, `year to March 2026 ${yt.yearTo.at(-1).value}`);
const ch = yt.change.at(-1);
assert.equal(ch.period, '2026-Q1');
assert.ok(Math.abs(ch.value - -25.025) < 0.01, `the report: 25.0% below the year to June 2005 (${ch.value})`);
assert.equal(yt.change[0].value, 0, 'the baseline year itself');
checkSeries('emissions_change_from_2005_au', yt.change);

const sentence = 'Emissions in the year to March 2026 were 25.0% below emissions for the year to June 2005 (the baseline year for Australia’s 43% reduction by 2030 target under the Paris Agreement).';
assert.deepEqual(reportHeadline(sentence), { period: '2026-Q1', below: 25 });
assert.deepEqual(reportHeadline('Emissions in the year to June 2026 were 1.5 per cent above emissions in the year to June 2005.'), { period: '2026-Q2', below: -1.5 });
assert.equal(reportHeadline('Emissions fell.'), null);

const T = 'Data Table 1A';
const row = (sheets, period) => sheets[T].findIndex((r) => typeof r[1] === 'number' && quarterOfSerial(r[1]) === period);
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s[T][row(s, '2024-Q3')][2] += 1; })), /sectors add to/, 'sectors must add to the total');
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s[T].splice(row(s, '2015-Q1'), 1); })), /is followed by/, 'no gap');
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s.Contents = [['Quarterly Update']]; })), /Figures and Tables/, 'the named quarter is required');
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s.Contents[1][0] = 'Figures and Tables for the December Quarter 2025'; })), /not the preliminary quarter/, 'two quarters after the named one is a layout change');
assert.throws(() => parseEmissions(book(F.emissions, (s) => { const h = s[T].findIndex((r) => r[0] === 'Year'); s[T][h][10] = 'Total'; })), /National Inventory Total/);
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s[T][row(s, '2005-Q3')][0] = '2006-07'; })), /financial year/);
assert.throws(() => parseEmissions(book(F.emissions, (s) => { s[T][3][0] = 'Data Table 1A: Seasonally adjusted emissions (Mt), by sector, by quarter'; })), /Actual emissions/);

// ---------- renewables: discovery
const aes = `<a href="/publications/australian-energy-statistics-table-o-electricity-generation-fuel-type-2023-24-and-2024">x</a>
<a href="/publications/australian-energy-statistics-table-o-electricity-generation-fuel-type-2024-25-and-2025">y</a>
<a href="https://www.energy.gov.au/publications/australian-energy-statistics-table-o-electricity-generation-fuel-type-2019-20-and-2020">z</a>`;
assert.deepEqual(latestTableOPage(aes), { year: 2025, url: 'https://www.energy.gov.au/publications/australian-energy-statistics-table-o-electricity-generation-fuel-type-2024-25-and-2025' });
const rel = `<title>Australian Energy Statistics, Table O Electricity generation by fuel type 2024-25 and 2025 | energy.gov.au</title>
<a href="/sites/default/files/2026-06/table-o-electricity-generation-by-fuel%20type-2024-25-and-2025.xlsx">O</a>
<a href="/sites/default/files/2026-06/aes-2026-supplementary-statistics-on-grid-off-grid-electricity%20generation.xlsx">grid</a>
<a href="/sites/default/files/2026-06/australian-energy-statistics-2026-supplementary-statistics-act-generation.xlsx">act</a>`;
const af = aesFiles(rel, latestTableOPage(aes).url);
assert.match(af.tableO, /table-o-electricity-generation-by-fuel%20type-2024-25-and-2025\.xlsx$/);
assert.match(af.onGrid, /supplementary-statistics-on-grid-off-grid/);
assert.equal(aesFiles('<a href="/x/Australian%20Energy%20Statistics%202025%20Table%20O.xlsx">o</a>', 'https://www.energy.gov.au/p').tableO, 'https://www.energy.gov.au/x/Australian%20Energy%20Statistics%202025%20Table%20O.xlsx', 'the older file naming');

// ---------- renewables: the on-grid measure and Table O
const tO = parseTableO(book(F.renewables.tableO));
const grid = parseOnGrid(book(F.renewables.onGrid));
assert.equal(tO.fy[0].period, '1989-90');
assert.equal(tO.fy.at(-1).period, '2024-25');
assert.deepEqual(tO.cy.filter((y) => y.estimate).map((y) => y.period), ['2025'], '"2025 (est.)" is an estimate');
const cy = grid.cy.filter((y) => !y.estimate);
assert.deepEqual(cy.map((y) => y.period), ['2021', '2022', '2023', '2024']);
assert.ok(Math.abs(cy.at(-1).pct - 38.062) < 0.001, 'on-grid renewable share 2024, as printed');
assert.ok(Math.abs(grid.fy.at(-1).pct - 39.983) < 0.001, 'on-grid 2024-25');
assert.ok(Math.abs(tO.cy.find((y) => y.period === '2024').share - 35.75) < 0.01, 'all generation 2024 (derived)');
assert.ok(grid.cy.at(-1).pumpedHydro > 0, 'pumped hydro, outside the on-grid total');
const lines = reconcileGrid(tO, grid);
assert.ok(lines.some((l) => l.startsWith('CY 2024')) && lines.some((l) => l.startsWith('FY 2024-25')));
const G = 'CY on-grid generation';
const at = (sheets, name, fuelName) => sheets[name].findIndex((r) => String(r[0] ?? '').startsWith(fuelName));
assert.throws(() => parseOnGrid(book(F.renewables.onGrid, (s) => { s[G][at(s, G, 'Wind')][4] += 500; })), /renewable fuels add to/);
assert.throws(() => parseOnGrid(book(F.renewables.onGrid, (s) => { s[G][at(s, G, 'Per cent')][4] = 40; })), /printed renewable share/);
assert.throws(() => parseOnGrid(book(F.renewables.onGrid, (s) => { delete s['FY off-grid generation']; })), /no "FY off-grid generation" sheet/);
assert.throws(() => parseOnGrid(book(F.renewables.onGrid, (s) => { s[G][at(s, G, 'Fuel type')][3] = 'Twenty23'; })), /unrecognised year heading/);
assert.throws(() => reconcileGrid(tO, parseOnGrid(book(F.renewables.onGrid, (s) => {
  // A redefined on-grid measure: 5,000 GWh moved out of on-grid coal that the off-grid sheet does not pick up.
  const i = at(s, G, 'Black coal'), n = at(s, G, 'Total non-renewable'), t = s[G].findIndex((r) => r[0] === 'Total'), p = at(s, G, 'Per cent');
  for (const k of [i, n, t]) s[G][k][4] -= 5000;
  s[G][p][4] = (s[G][at(s, G, 'Total renewable')][4] / s[G][t][4]) * 100;
}))), /Table O's total/);

// ---------- bulk billing: discovery
const col = `<a href="/resources/publications/medicare-quarterly-statistics-state-and-territory-march-quarter-2025-26?language=en">a</a>
<a href="/resources/publications/medicare-quarterly-statistics-state-and-territory-june-quarter-2025-26?language=en">b</a>
<a href="/resources/publications/medicare-quarterly-statistics-bulk-billing-by-primary-health-network-june-quarter-2025-26?language=en">phn</a>`;
assert.deepEqual(latestMedicarePage(col), { quarter: '2026-Q2', url: 'https://www.health.gov.au/resources/publications/medicare-quarterly-statistics-state-and-territory-june-quarter-2025-26?language=en' });
assert.equal(medicareFile('<a href="/sites/default/files/2026-08/medicare-quarterly-statistics-state-and-territory-june-quarter-2025-26.xlsx">x</a>', 'https://www.health.gov.au/r').xlsx,
  'https://www.health.gov.au/sites/default/files/2026-08/medicare-quarterly-statistics-state-and-territory-june-quarter-2025-26.xlsx');
assert.equal(medicareQuarter('2025-26 Q4 (Jun Qtr)'), '2026-Q2');
assert.equal(medicareQuarter('2025-26 Q1 (Sep Qtr)'), '2025-Q3');
assert.equal(medicareQuarter('2009-10 Q2 (Dec Qtr)'), '2009-Q4');
assert.equal(medicareQuarter('2025-26 Q3 (Mar Qtr)'), '2026-Q1');
assert.equal(medicareQuarter('2025-26 Q3 (Jun Qtr)'), null, 'quarter and month disagree');

// ---------- bulk billing: Table 1
const med = parseMedicare(book(F.medicare));
assert.deepEqual(med.quarters.map((q) => q.period), ['2025-Q4', '2026-Q1', '2026-Q2']);
assert.ok(Math.abs(med.quarters.at(-1).rate - 84.075) < 0.001, `June quarter 2025-26 ${med.quarters.at(-1).rate}`);
assert.equal(med.quarters.at(-1).services, 43568190);
const A = 'All Services';
const gpRow = (s, q, st) => s[A].findIndex((r) => r[0] === q && r[1] === st && r[2] === 'Total GP Non-Referred Attendances');
assert.throws(() => parseMedicare(book(F.medicare, (s) => { const i = gpRow(s, '2025-26 Q4 (Jun Qtr)', 'NSW'); s[A][i][3] += 10; s[A][i][6] += 10; })), /states add to/);
assert.throws(() => parseMedicare(book(F.medicare, (s) => { s[A][gpRow(s, '2025-26 Q4 (Jun Qtr)', 'Australia')][9] = 84.07; })), /share between 0 and 1/, 'a rate printed as a per cent is a layout change');
assert.throws(() => parseMedicare(book(F.medicare, (s) => { s[A][gpRow(s, '2025-26 Q4 (Jun Qtr)', 'Australia')][9] = 0.85; })), /bulk billed ÷ services/);
assert.throws(() => parseMedicare(book(F.medicare, (s) => { s[A][gpRow(s, '2025-26 Q4 (Jun Qtr)', 'Australia')][6] += 1; })), /patient billed/);
assert.throws(() => parseMedicare(book(F.medicare, (s) => { s[A] = s[A].filter((r) => r[0] !== '2026-Q1' && r[0] !== '2025-26 Q3 (Mar Qtr)'); })), /is followed by/);
assert.throws(() => parseMedicare(book(F.medicare, (s) => { const h = s[A].findIndex((r) => r[0] === 'Quarter'); s[A][h][5] = 'Bulk billed'; })), /"Bulk Billed Services"/);

// ---------- shared checks
assert.throws(() => checkSeries('x', [{ period: '2024', value: 1 }, { period: '2024', value: 2 }]), /twice/);
assert.throws(() => checkSeries('x', [{ period: '2024', value: 101 }], { share: true }), /0 to 100/);
assert.throws(() => checkSeries('x', [{ period: '2024', value: NaN }]), /not a number/);
assert.deepEqual(Object.values(SCORECARD_REQUESTS).map((r) => r.metric_id), ['emissions_change_from_2005_au', 'renewable_share_ongrid_au', 'gp_bulk_billing_rate_au']);

console.log('official workbook checks passed');
