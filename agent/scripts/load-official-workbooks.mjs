/**
 * Official government workbooks for the government scorecard's three commitments that no API measures. Each is a
 * spreadsheet published by the department itself (no API, SDMX or CSV service carries these series); the editor
 * approved them as an exception to the official-API rule (October 2026), on the precedent of load-budget-history.mjs.
 * Official, tier 1. Each run finds the current file from the publisher's own pages, parses it, checks it, and stores
 * nothing for a source whose layout has changed or whose checks fail (the other sources still load).
 *
 *   emissions     DCCEEW, Quarterly Update of Australia's National Greenhouse Gas Inventory: data workbook, Data Table 1A
 *     emissions_quarter_lulucf_au      national inventory total (all sectors incl. LULUCF), quarter, Mt CO2-e   published
 *     emissions_total_lulucf_au        the same over the year to each quarter (four quarters summed), Mt CO2-e   derived
 *     emissions_change_from_2005_au    year to each quarter, % change on the year to June 2005 (the target's    derived
 *                                      baseline year), checked against the report's own headline figure
 *   renewables    DCCEEW, Australian Energy Statistics: Supplementary statistics (on-grid and off-grid generation) and Table O
 *     renewable_share_ongrid_au        renewable share of on-grid generation, calendar year, % (as printed)     published
 *     renewable_share_ongrid_fy_au     the same, financial year                                                  published
 *     renewable_share_generation_au    renewable share of all generation (Table O, incl. off-grid), calendar    derived
 *     renewable_share_generation_fy_au the same, financial year                                                  derived
 *   bulk-billing  Department of Health, Disability and Ageing, Medicare quarterly statistics, state and territory, Table 1
 *     gp_bulk_billing_rate_au          GP non-referred attendances bulk billed, % of services, quarter          published
 *
 * Actuals only: the emissions workbook's preliminary next quarter and Table O's "(est.)" years are left out. A run
 * that finds an older release than the one already stored stores nothing for that source (no vintage goes backwards).
 * After a source stores, the scorecard's pending series request for it (source_suggestions, origin 'scorecard') is
 * marked approved with the metric it was answered by.
 *
 *   node scripts/load-official-workbooks.mjs --dry-run                 fetch, check and print, write nothing
 *   node scripts/load-official-workbooks.mjs                           upsert
 *   node scripts/load-official-workbooks.mjs emissions --dry-run       one source (emissions, renewables, bulk-billing)
 */
import {
  AES_LIST, MEDICARE_COLLECTION, NGGI_LIST, SCORECARD_REQUESTS, aesFiles, checkSeries, docxText, latestMedicarePage,
  latestTableOPage, medicareFile, nextQuarter, nggiFiles, nggiUpdateUrl, nggiUpdates, parseEmissions, parseMedicare,
  parseOnGrid, parseTableO, quarterName, reconcileGrid, reportHeadline, yearTo,
} from './lib/official-workbooks.mjs';
import { readWorkbook } from './lib/xlsx.mjs';

const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.8',
  'accept-language': 'en-AU,en;q=0.9',
};

/** A page or file; retried on 429 and 5xx. `optional` returns null instead of throwing (a page not yet published). */
async function get(url, { as = 'text', optional = false, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    let res;
    try { res = await fetch(url, { headers: BROWSER, redirect: 'follow', signal: AbortSignal.timeout(120000) }); } catch (e) {
      if (i < tries) { await new Promise((r) => setTimeout(r, 4000 * i)); continue; }
      if (optional) return null;
      throw new Error(`${url}: ${e.message}`);
    }
    if (res.ok) return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : res.text();
    if ((res.status >= 500 || res.status === 429) && i < tries) { await new Promise((r) => setTimeout(r, 4000 * i)); continue; }
    if (optional) return null;
    throw new Error(`${url}: HTTP ${res.status}`);
  }
}

const show = (rows, n, fmt) => rows.slice(-n).map((r) => `${r.period} ${fmt(r.value)}`).join(', ');

// ---------------------------------------------------------------------------------------------------- the sources

/**
 * The newest quarterly update: the department's list page, then (because the list lags) the update pages its own URL
 * pattern gives for the next quarters, newest found wins. A page not published yet answers 404 or 503.
 */
async function emissions(log) {
  const list = nggiUpdates(await get(NGGI_LIST));
  if (!list.length) throw new Error(`${NGGI_LIST}: no quarterly update links`);
  let best = list[0];
  for (let q = nextQuarter(best.quarter), k = 0; k < 3; q = nextQuarter(q), k++) {
    const url = nggiUpdateUrl(q);
    const html = await get(url, { optional: true, tries: 1 });
    if (html && /Quarterly Update/i.test(html) && nggiFiles(html, url).xlsx) best = { quarter: q, url, html };
  }
  const html = best.html ?? await get(best.url);
  const files = nggiFiles(html, best.url);
  if (!files.xlsx) throw new Error(`${best.url}: no data workbook (.xlsx) link`);
  const parsed = parseEmissions(readWorkbook(await get(files.xlsx, { as: 'buffer' })));
  if (parsed.named !== best.quarter) throw new Error(`the ${quarterName(best.quarter)} update's workbook is for ${quarterName(parsed.named)}`);
  const { base, yearTo: yt, change } = yearTo(parsed.quarters);
  log(`${files.title} (${best.url})`);
  log(`  workbook ${files.xlsx}: Data Table 1A, ${parsed.quarters.length} actual quarters ${parsed.quarters[0].period} to ${parsed.named}${parsed.preliminary ? `; preliminary ${parsed.preliminary} left out` : ''}`);
  log(`  year to June 2005 (baseline): ${base.toFixed(1)} Mt CO2-e`);

  // The report's own headline figure for the latest year must match what we derive from its workbook.
  const latest = change.at(-1);
  const report = files.docx ? await get(files.docx, { as: 'buffer', optional: true }) : null;
  const headline = report ? reportHeadline(docxText(report)) : null;
  if (headline) {
    if (headline.period !== latest.period || Math.abs(-latest.value - headline.below) > 0.051) {
      throw new Error(`the report says the year to ${quarterName(headline.period)} was ${headline.below}% below the year to June 2005; the workbook gives ${(-latest.value).toFixed(2)}% for the year to ${quarterName(latest.period)}`);
    }
    log(`  report headline: year to ${quarterName(headline.period)} ${headline.below.toFixed(1)}% below the year to June 2005; workbook ${(-latest.value).toFixed(2)}%: agrees`);
  } else log(`  report headline not found (${files.docx ?? 'no .docx link'}); the change from 2005 is derived from the workbook alone`);

  const source = { source_org: 'DCCEEW', source_url: files.xlsx, source_dataset: `${files.title.replace(/\s*[-|]\s*DCCEEW\s*$/i, '')}: data workbook, Data Table 1A (actual emissions by sector by quarter)` };
  const common = `national inventory total, all sectors including Land Use, Land Use Change and Forestry (LULUCF, held at the latest National Inventory Report levels, as the department does), from Data Table 1A of the DCCEEW Quarterly Update of Australia's National Greenhouse Gas Inventory (${best.url}); actual quarters only, the preliminary next quarter is not stored`;
  return {
    latest: parsed.named,
    series: [
      { metric_id: 'emissions_quarter_lulucf_au', name: 'Australia\'s greenhouse gas emissions, quarter, including LULUCF', unit: 'Mt CO2-e', share: false, status: 'published',
        basis: `Emissions in the quarter, ${common}.`, rows: parsed.quarters.map((q) => ({ period: q.period, value: q.total })), fmt: (v) => `${v.toFixed(1)} Mt` },
      { metric_id: 'emissions_total_lulucf_au', name: 'Australia\'s greenhouse gas emissions, year to quarter, including LULUCF', unit: 'Mt CO2-e', share: false, status: 'derived',
        basis: `Emissions over the year to each quarter (the four quarters to it, summed; period = the last quarter), ${common}.`, rows: yt, fmt: (v) => `${v.toFixed(1)} Mt` },
      { metric_id: 'emissions_change_from_2005_au', name: 'Australia\'s greenhouse gas emissions, change on the year to June 2005', unit: 'percent', share: false, status: 'derived',
        basis: `Per cent change in emissions over the year to each quarter on the year to June 2005 (${base.toFixed(3)} Mt CO2-e in this release), the baseline year for the 43% by 2030 target as the Quarterly Update states it; negative = below 2005. Derived from the same workbook and checked against the report's headline figure; ${common}.`,
        rows: change, fmt: (v) => `${v.toFixed(1)}%` },
    ].map((s) => ({ ...s, ...source })),
    request: SCORECARD_REQUESTS.emissions,
  };
}

/** The newest Australian Energy Statistics Table O release, with its supplementary on-grid statistics. */
async function renewables(log) {
  const page = latestTableOPage(await get(AES_LIST));
  if (!page) throw new Error(`${AES_LIST}: no Table O release link`);
  const html = await get(page.url);
  const files = aesFiles(html, page.url);
  if (!files.tableO) throw new Error(`${page.url}: no Table O workbook link`);
  if (!files.onGrid) throw new Error(`${page.url}: no supplementary on-grid statistics workbook (the measure for the 82% target)`);
  const tableO = parseTableO(readWorkbook(await get(files.tableO, { as: 'buffer' })));
  const grid = parseOnGrid(readWorkbook(await get(files.onGrid, { as: 'buffer' })));
  const lines = reconcileGrid(tableO, grid);
  log(`${files.title} (${page.url})`);
  log(`  Table O ${files.tableO}`);
  log(`  on-grid ${files.onGrid}`);
  for (const l of lines.slice(-4)) log(`  reconciled ${l}`);
  const est = (ys) => ys.filter((y) => y.estimate).map((y) => y.period);
  const actual = (ys) => ys.filter((y) => !y.estimate);
  log(`  estimates left out: on-grid CY ${est(grid.cy).join(', ') || 'none'}; Table O CY ${est(tableO.cy).join(', ') || 'none'}; FY ${est(grid.fy).concat(est(tableO.fy)).join(', ') || 'none'}`);

  const release = files.title.replace(/\s*\|\s*energy\.gov\.au\s*$/i, '');
  const onGridBasis = (kind) => `Renewable share of on-grid electricity generation (the major grids: NEM, SWIS, NWIS, DKIS and Mt Isa), ${kind}, per cent, as printed in DCCEEW's Australian Energy Statistics supplementary statistics, which the department built to track the target of 82% renewable electricity on-grid by 2030. Pumped hydro is excluded, as the target excludes storage. Years marked (est.) are not stored. Release: ${release} (${page.url}).`;
  const allBasis = (kind) => `Renewable share of all Australian electricity generation (Table O: on-grid and off-grid, including generation for own use), ${kind}: Total renewable ÷ Total from Table O, per cent, derived. Not the target's measure (that is on-grid); kept for context. Years marked (est.) are not stored. Release: ${release} (${page.url}).`;
  const pick = (ys, key) => actual(ys).map((y) => ({ period: y.period, value: +y[key].toFixed(3) }));
  return {
    latest: actual(grid.cy).at(-1)?.period,
    series: [
      { metric_id: 'renewable_share_ongrid_au', name: 'Renewable share of on-grid electricity generation, calendar year', unit: 'percent', share: true, status: 'published', basis: onGridBasis('calendar year'),
        rows: pick(grid.cy, 'pct'), source_url: files.onGrid, source_dataset: `${release}: Supplementary statistics, Table 2 (on-grid generation, calendar years)` },
      { metric_id: 'renewable_share_ongrid_fy_au', name: 'Renewable share of on-grid electricity generation, financial year', unit: 'percent', share: true, status: 'published', basis: onGridBasis('financial year'),
        rows: pick(grid.fy, 'pct'), source_url: files.onGrid, source_dataset: `${release}: Supplementary statistics, Table 1 (on-grid generation, financial years)` },
      { metric_id: 'renewable_share_generation_au', name: 'Renewable share of all electricity generation (Table O), calendar year', unit: 'percent', share: true, status: 'derived', basis: allBasis('calendar year'),
        rows: pick(tableO.cy, 'share'), source_url: files.tableO, source_dataset: `${release}: Table O, AUS CY` },
      { metric_id: 'renewable_share_generation_fy_au', name: 'Renewable share of all electricity generation (Table O), financial year', unit: 'percent', share: true, status: 'derived', basis: allBasis('financial year'),
        rows: pick(tableO.fy, 'share'), source_url: files.tableO, source_dataset: `${release}: Table O, AUS FY` },
    ].map((s) => ({ ...s, source_org: 'DCCEEW', fmt: (v) => `${v.toFixed(1)}%` })),
    request: SCORECARD_REQUESTS.renewables,
  };
}

/** The newest Medicare quarterly statistics (state and territory) on the department's Medicare statistics collection. */
async function bulkBilling(log) {
  const page = latestMedicarePage(await get(MEDICARE_COLLECTION));
  if (!page) throw new Error(`${MEDICARE_COLLECTION}: no "Medicare quarterly statistics – state and territory" link`);
  const html = await get(page.url);
  const file = medicareFile(html, page.url);
  if (!file.xlsx) throw new Error(`${page.url}: no workbook link`);
  const { quarters } = parseMedicare(readWorkbook(await get(file.xlsx, { as: 'buffer' })));
  if (quarters.at(-1).period !== page.quarter) throw new Error(`the ${page.quarter} publication's workbook ends at ${quarters.at(-1).period}`);
  log(`${file.title} (${page.url})`);
  log(`  workbook ${file.xlsx}: Table 1, ${quarters.length} quarters ${quarters[0].label} to ${quarters.at(-1).label}; every quarter: bulk + patient billed = services, rate = bulk ÷ services, states add to Australia`);
  const last = quarters.at(-1);
  log(`  ${last.label}: ${last.bulkBilled.toLocaleString('en-AU')} of ${last.services.toLocaleString('en-AU')} GP non-referred attendances bulk billed`);
  return {
    latest: last.period,
    series: [{
      metric_id: 'gp_bulk_billing_rate_au', name: 'GP bulk billing rate (GP non-referred attendances, share of services)', unit: 'percent', share: true, status: 'published',
      basis: 'Share of GP non-referred attendance services (Broad Type of Service "Total GP Non-Referred Attendances") that were bulk billed, Australia, by quarter of processing, per cent: the "MBS Bulk Billing Rate" in Table 1 (All Services) of the Department of Health, Disability and Ageing\'s Medicare quarterly statistics, state and territory. The services measure: the share of GP visits bulk billed, the measure of the "9 in 10 GP visits" target (not the patient bulk billing rate, the share of patients all of whose GP services were bulk billed).',
      rows: quarters.map((q) => ({ period: q.period, value: q.rate })), source_org: 'Department of Health, Disability and Ageing', source_url: file.xlsx,
      source_dataset: `${file.title.replace(/\s*\|.*$/, '')}: Table 1, Quarterly Medicare Statistics by Broad Type of Service and State`, fmt: (v) => `${v.toFixed(1)}%`,
    }],
    request: SCORECARD_REQUESTS['bulk-billing'],
  };
}

export const SOURCES = { emissions, renewables, 'bulk-billing': bulkBilling };

// ---------------------------------------------------------------------------------------------------- storing

/** The latest stored period of a series (AUS), or null. Periods of one series sort as text. */
async function storedLatest(db, metricId) {
  const { data } = await db.from('observations').select('period').eq('metric_id', metricId).eq('entity', 'AUS').order('period', { ascending: false }).limit(1);
  return data?.[0]?.period ?? null;
}

/** The scorecard's pending request for this series, marked approved with the metric that answers it. */
async function adoptRequest(db, request, log) {
  const { data, error } = await db.from('source_suggestions').select('suggestion_id, payload')
    .eq('action', 'register_data_source').eq('status', 'pending').eq('summary', request.series).eq('payload->>origin', 'scorecard');
  if (error) { log(`  scorecard request not updated: ${error.message}`); return; }
  for (const s of data ?? []) {
    const { error: e } = await db.from('source_suggestions').update({
      status: 'approved', reviewed_at: new Date().toISOString(),
      review_note: `Adopted by the official workbook loader (load-official-workbooks.mjs) as ${request.metric_id}.`,
      payload: { ...(s.payload ?? {}), adopted_metric_id: request.metric_id },
    }).eq('suggestion_id', s.suggestion_id);
    log(e ? `  scorecard request not updated: ${e.message}` : `  scorecard request "${request.series}" marked approved (${request.metric_id})`);
  }
}

export async function loadOfficialWorkbooks({ dry = false, only = null, log = console.log } = {}) {
  const names = only?.length ? only : Object.keys(SOURCES);
  const results = {};
  let db = null;
  for (const name of names) {
    const run = SOURCES[name];
    if (!run) throw new Error(`unknown source ${name} (${Object.keys(SOURCES).join(', ')})`);
    log(`\n== ${name}`);
    try {
      const got = await run(log);
      for (const s of got.series) {
        checkSeries(s.metric_id, s.rows, { share: s.share });
        log(`  ${s.metric_id}: ${s.rows.length} readings ${s.rows[0].period} to ${s.rows.at(-1).period}; latest ${show(s.rows, 4, s.fmt)}`);
      }
      results[name] = { ok: true, latest: got.latest, series: got.series.map((s) => ({ metric_id: s.metric_id, rows: s.rows })) };
      if (dry) continue;
      if (!db) { const { createDb } = await import('./lib/obs-loader.mjs'); db = createDb(); }
      const { upsertSeries } = await import('./lib/obs-loader.mjs');
      // Never replace a newer release with an older one (a lagging page, a cached file).
      const main = got.series.find((s) => s.metric_id === got.request.metric_id) ?? got.series[0];
      const before = await storedLatest(db, main.metric_id);
      if (before && main.rows.at(-1).period < before) { log(`  not stored: this release ends at ${main.rows.at(-1).period}, the store already has ${before}`); continue; }
      for (const s of got.series) {
        const res = await upsertSeries(db, {
          metric_id: s.metric_id, name: s.name, unit: s.unit, basis: s.basis, direction: 'neutral', category: name === 'bulk-billing' ? 'health' : name === 'emissions' ? 'environment' : 'energy',
          source_tier: 1, source_org: s.source_org, source_dataset: s.source_dataset, source_url: s.source_url,
        }, s.rows.map((r) => ({ metric_id: s.metric_id, entity: 'AUS', period: r.period, value: r.value, status: s.status })));
        log(`  stored ${s.metric_id}: ${res.total} readings, ${res.fresh} new`);
      }
      await adoptRequest(db, got.request, log);
    } catch (e) {
      results[name] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      log(`  NOT LOADED: ${results[name].error}`);
    }
  }
  return results;
}

if (process.argv[1]?.endsWith('load-official-workbooks.mjs')) {
  const args = process.argv.slice(2);
  const res = await loadOfficialWorkbooks({ dry: args.includes('--dry-run'), only: args.filter((a) => !a.startsWith('--')) });
  const failed = Object.entries(res).filter(([, r]) => !r.ok);
  if (failed.length) { console.error(`\nNot loaded: ${failed.map(([n, r]) => `${n} (${r.error})`).join('; ')}`); process.exit(1); }
}
