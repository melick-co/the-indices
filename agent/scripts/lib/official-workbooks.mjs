/**
 * Official government workbooks that no API carries, read for the government scorecard (approved exception to the
 * official-API rule, October 2026, on the Budget Paper precedent). Pure and dependency-free: discovery of the current
 * file from the publisher's own pages, parsers for the tables used, and the checks that must pass before anything is
 * stored. Shared by agent/scripts/load-official-workbooks.mjs; tested by official-workbooks.check.mjs.
 *
 *   emissions    DCCEEW, Quarterly Update of Australia's National Greenhouse Gas Inventory, data workbook,
 *                Data Table 1A "Actual emissions (Mt), by sector, by quarter" (national inventory total incl. LULUCF)
 *   renewables   DCCEEW, Australian Energy Statistics: Supplementary statistics, on-grid and off-grid electricity
 *                generation (the measure built to track the 82% on-grid target), and Table O (all generation)
 *   bulk billing Department of Health, Disability and Ageing, Medicare quarterly statistics, state and territory,
 *                Table 1 "All Services", Total GP Non-Referred Attendances, Australia
 *
 * Every parser fails loudly on a layout it does not recognise; nothing is estimated and nothing is filled in.
 */
import { cleanText, unzipEntry } from './budget-history.mjs';
import { excelDate, label } from './xlsx.mjs';

const QUARTER_MONTH = { march: 1, june: 2, september: 3, sept: 3, december: 4 };

/** "2026-Q1" → the next quarter "2026-Q2"; and back. */
export const nextQuarter = (p) => { const y = +p.slice(0, 4), q = +p.slice(6); return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`; };
export const prevQuarter = (p) => { const y = +p.slice(0, 4), q = +p.slice(6); return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`; };
/** "March 2026" (a quarter's last month) → "2026-Q1"; null for a month that does not end a quarter. */
export function quarterOfMonth(month, year) {
  const q = QUARTER_MONTH[String(month).toLowerCase()];
  return q && /^\d{4}$/.test(String(year)) ? `${year}-Q${q}` : null;
}
const QUARTER_NAME = { 1: 'March', 2: 'June', 3: 'September', 4: 'December' };
/** "2026-Q1" → "March 2026". */
export const quarterName = (p) => `${QUARTER_NAME[+p.slice(6)]} ${p.slice(0, 4)}`;

const abs = (href, base) => new URL(href.replace(/&amp;/g, '&'), base).toString();
const hrefs = (html) => [...String(html).matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
const titleOf = (html) => cleanText((String(html).match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/&ndash;/g, '–'));

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------------------------------- emissions

export const NGGI_LIST = 'https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-gas-inventory-quarterly-updates';
const NGGI_SLUG = /\/climate-change\/publications\/national-greenhouse-gas-inventory-quarterly-update-(march|june|september|sept|december)-(\d{4})\b/i;

/** The quarterly updates the list page links to, newest first: [{ quarter: '2025-Q4', url }]. */
export function nggiUpdates(html, base = NGGI_LIST) {
  const out = new Map();
  for (const h of hrefs(html)) {
    const m = NGGI_SLUG.exec(h);
    const q = m && quarterOfMonth(m[1], m[2]);
    if (q && !out.has(q)) out.set(q, abs(h.split(/[?#]/)[0], base));
  }
  return [...out].map(([quarter, url]) => ({ quarter, url })).sort((a, b) => b.quarter.localeCompare(a.quarter));
}

/** The update page the department would publish for a quarter (its own URL pattern), for quarters the list lags on. */
export const nggiUpdateUrl = (quarter) => `https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-gas-inventory-quarterly-update-${quarterName(quarter).split(' ')[0].toLowerCase()}-${quarter.slice(0, 4)}`;

/** The data workbook (.xlsx) and the report (.docx) linked from an update page. */
export function nggiFiles(html, base) {
  const links = hrefs(html).map((h) => abs(h, base));
  return {
    title: titleOf(html),
    xlsx: links.find((u) => /\.xlsx(\?|$)/i.test(u) && /nggi|greenhouse|inventory/i.test(u)) ?? null,
    docx: links.find((u) => /\.docx(\?|$)/i.test(u) && /greenhouse|inventory|nggi/i.test(u)) ?? null,
  };
}

/** A quarter-end serial date (1 Sep 2004 for the September quarter 2004) as "2004-Q3"; null if not a quarter's last month. */
export function quarterOfSerial(serial) {
  const iso = excelDate(serial);
  if (!iso) return null;
  const m = Number(iso.slice(5, 7));
  return m % 3 === 0 ? `${iso.slice(0, 4)}-Q${m / 3}` : null;
}

/**
 * Data Table 1A of the quarterly update's data workbook: actual emissions by sector and quarter, with the national
 * inventory total (all sectors including LULUCF). The workbook's named quarter (the Contents title, "Figures and Tables
 * for the March Quarter 2026") is the last actual quarter; anything after it is the preliminary next quarter and is
 * left out. Checks: the layout (Year, Quarter, sector columns, LULUCF, National Inventory Total), each financial year
 * label on its September quarter, quarters in order without a gap or a repeat, the sectors adding to the total (within
 * 0.01 Mt of rounding), totals in a plausible range, and the 2004-05 baseline year complete.
 * Returns { named, preliminary, quarters: [{ period, total, lulucf }] } (actuals only, oldest first).
 */
export function parseEmissions(wb) {
  const contents = wb.sheet('Contents') ?? [];
  const namedText = contents.flat().map(label).find((t) => /Figures and Tables for the (\w+) Quarter (\d{4})/i.test(t)) ?? '';
  const nm = /Figures and Tables for the (\w+) Quarter (\d{4})/i.exec(namedText);
  const named = nm && quarterOfMonth(nm[1], nm[2]);
  if (!named) throw new Error('emissions workbook: no "Figures and Tables for the <Month> Quarter <Year>" title on the Contents sheet');
  const sheetName = wb.names.find((n) => /^Data Table 1A\b/i.test(label(n)));
  if (!sheetName) throw new Error('emissions workbook: no "Data Table 1A" sheet');
  const rows = wb.sheet(sheetName);
  const title = rows.flat().map(label).find((t) => /^Data Table 1A:/i.test(t)) ?? '';
  if (!/Actual emissions \(Mt\)/i.test(title) || !/by quarter/i.test(title)) throw new Error(`emissions workbook: Data Table 1A is not "Actual emissions (Mt), by sector, by quarter" ("${title}")`);
  const pm = /including preliminary (\w+) (\d{4})/i.exec(title);
  const preliminary = pm ? quarterOfMonth(pm[1], pm[2]) : null;
  const h = rows.findIndex((r) => label(r[0]) === 'Year' && label(r[1]) === 'Quarter');
  if (h < 0) throw new Error('emissions workbook: Data Table 1A has no Year / Quarter header');
  const head = rows[h].map(label);
  const totalCol = head.findIndex((t) => /^National Inventory Total$/i.test(t));
  const lulucfCol = head.findIndex((t) => /^Land Use, Land Use Change and Forestry/i.test(t));
  if (totalCol < 0 || lulucfCol < 0 || lulucfCol > totalCol) throw new Error('emissions workbook: Data Table 1A has no National Inventory Total or LULUCF column where expected');
  const sectorCols = [];
  for (let c = 2; c < totalCol; c++) sectorCols.push(c);
  const sub = rows[h + 1]?.map(label) ?? [];
  if (!/^Electricity$/i.test(sub[2] ?? '')) throw new Error('emissions workbook: Data Table 1A sector headings have moved');

  const out = [];
  let fy = null;
  for (const r of rows.slice(h + 2)) {
    if (typeof r[1] !== 'number') continue;
    const period = quarterOfSerial(r[1]);
    if (!period) throw new Error(`emissions workbook: quarter ${r[1]} is not a quarter-end month`);
    if (r[0] != null && label(r[0]) !== '') {
      const m = /^(\d{4})-(\d{2})$/.exec(label(r[0]));
      if (!m || period !== `${m[1]}-Q3`) throw new Error(`emissions workbook: financial year ${label(r[0])} does not start on a September quarter (${period})`);
      fy = label(r[0]);
    }
    const sectors = sectorCols.map((c) => r[c]);
    const total = r[totalCol];
    if (sectors.some((v) => typeof v !== 'number') || typeof total !== 'number') throw new Error(`emissions workbook: ${period} has a missing figure`);
    const sum = sectors.reduce((s, v) => s + v, 0);
    if (!near(sum, total, 0.01)) throw new Error(`emissions workbook: ${period} sectors add to ${sum.toFixed(3)} but the total is ${total}`);
    if (!(total > 50 && total < 250)) throw new Error(`emissions workbook: ${period} total ${total} Mt is outside 50 to 250 Mt a quarter`);
    out.push({ period, fy, total, lulucf: r[lulucfCol] });
  }
  if (!out.length) throw new Error('emissions workbook: Data Table 1A has no quarters');
  for (let i = 1; i < out.length; i++) if (out[i].period !== nextQuarter(out[i - 1].period)) throw new Error(`emissions workbook: ${out[i - 1].period} is followed by ${out[i].period}`);
  if (out[0].period !== '2004-Q3') throw new Error(`emissions workbook: the table starts at ${out[0].period}, not the September quarter 2004 (the 2005 baseline year)`);
  const quarters = out.filter((q) => q.period <= named);
  if (quarters.at(-1)?.period !== named) throw new Error(`emissions workbook: the named quarter ${named} is not in Data Table 1A`);
  const dropped = out.filter((q) => q.period > named).map((q) => q.period);
  if (dropped.some((p) => p !== preliminary)) throw new Error(`emissions workbook: quarters after ${named} that are not the preliminary quarter: ${dropped.join(', ')}`);
  return { named, preliminary, quarters };
}

/**
 * Emissions over the year to each quarter (four quarters summed), and the per cent change on the year to June 2005,
 * the baseline year for the 2030 target (the Quarterly Update: "the year to June 2005, which is the baseline year for
 * Australia's 2030 target under the Paris Agreement"). Derived from Data Table 1A; rounded as stored (3 decimals).
 */
export function yearTo(quarters) {
  const byP = new Map(quarters.map((q) => [q.period, q.total]));
  const out = [];
  for (const q of quarters) {
    const ps = [q.period];
    while (ps.length < 4) ps.push(prevQuarter(ps.at(-1)));
    if (ps.every((p) => byP.has(p))) out.push({ period: q.period, value: +ps.reduce((s, p) => s + byP.get(p), 0).toFixed(3) });
  }
  const base = out.find((o) => o.period === '2005-Q2');
  if (!base) throw new Error('emissions: no year to June 2005 (the baseline year)');
  return {
    base: base.value,
    yearTo: out,
    change: out.map((o) => ({ period: o.period, value: +(((o.value - base.value) / base.value) * 100).toFixed(3) })),
  };
}

/** Paragraph text of a .docx (the Quarterly Update report). */
export function docxText(buf) {
  const xml = unzipEntry(buf, 'word/document.xml')?.toString('utf8');
  if (!xml) return '';
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) => cleanText((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
    .filter(Boolean).join('\n');
}

/**
 * The report's own headline: "Emissions in the year to March 2026 were 25.0% below emissions for the year to June
 * 2005". Returns { period, below } or null when the sentence is not there.
 */
export function reportHeadline(text) {
  const m = /emissions in the year to (\w+) (\d{4}) were ([\d.]+)\s*(?:%|per cent) (below|above) (?:emissions )?(?:for|in) the year to june 2005/i.exec(String(text).replace(/\s+/g, ' '));
  if (!m) return null;
  const period = quarterOfMonth(m[1], m[2]);
  return period ? { period, below: (m[4].toLowerCase() === 'below' ? 1 : -1) * Number(m[3]) } : null;
}

// ---------------------------------------------------------------------------------------------------- renewables

export const AES_LIST = 'https://www.energy.gov.au/energy-data/australian-energy-statistics';
const TABLE_O_SLUG = /\/publications\/australian-energy-statistics-table-o-electricity-generation-fuel-type-(\d{4})-(\d{2})-and-(\d{4})\b/i;

/** The newest Table O release page the Australian Energy Statistics page links to: { year: 2025, url } or null. */
export function latestTableOPage(html, base = AES_LIST) {
  let best = null;
  for (const h of hrefs(html)) {
    const m = TABLE_O_SLUG.exec(h);
    if (!m) continue;
    const year = Number(m[3]);
    if (Number(m[1]) + 1 !== year || (Number(m[1]) + 1) % 100 !== Number(m[2])) continue;
    if (!best || year > best.year) best = { year, url: abs(h.split(/[?#]/)[0], base) };
  }
  return best;
}

/** The release page's workbooks: Table O, and the supplementary on-grid and off-grid statistics. */
export function aesFiles(html, base) {
  const links = hrefs(html).filter((h) => /\.xlsx(\?|$)/i.test(h)).map((h) => abs(h, base));
  const name = (u) => decodeURIComponent(u).toLowerCase();
  return {
    title: titleOf(html),
    tableO: links.find((u) => /table[ -_]?o\b/.test(name(u)) && !/supplementary/.test(name(u))) ?? null,
    onGrid: links.find((u) => /on-grid/.test(name(u)) && /supplementary/.test(name(u))) ?? null,
  };
}

const fuel = (v) => label(v).replace(/\s*\[note [a-z]\]\s*/gi, '').trim();
const yearLabel = (v) => {
  const t = label(v);
  let m;
  if ((m = /^(\d{4})-(\d{2})(\s*\(est\.?\))?$/i.exec(t))) return (Number(m[1]) + 1) % 100 === Number(m[2]) ? { period: `${m[1]}-${m[2]}`, estimate: !!m[3] } : null;
  if ((m = /^(\d{4})(\s*\(est\.?\))?$/i.exec(t))) return { period: m[1], estimate: !!m[2] };
  return null;
};

/**
 * One generation table (Table O's AUS FY / AUS CY, or a supplementary on-grid / off-grid sheet): fuel rows by year
 * columns. Returns { years: [{ period, estimate, nonRenewable, renewable, total, pumpedHydro, pct }] } with each year
 * checked: the renewable fuels add to Total renewable, the non-renewable fuels to Total non-renewable, the two to
 * Total, and the printed "Per cent renewable generation" (where the sheet has it) is Total renewable ÷ Total.
 */
export function parseGeneration(rows, what) {
  const h = rows.findIndex((r) => label(r[0]) === 'Fuel type');
  if (h < 0) throw new Error(`${what}: no "Fuel type" header row`);
  const cols = [];
  rows[h].forEach((v, c) => { if (c > 0) { const y = yearLabel(v); if (y) cols.push({ c, ...y }); else if (label(v)) throw new Error(`${what}: unrecognised year heading "${label(v)}"`); } });
  if (!cols.length) throw new Error(`${what}: no year columns`);
  const body = [];
  for (const r of rows.slice(h + 1)) {
    const name = fuel(r[0]);
    if (!name || /^\[/.test(name)) break;
    body.push({ name, r });
  }
  const at = (name) => body.findIndex((b) => b.name.toLowerCase() === name.toLowerCase());
  const iNon = at('Total non-renewable'), iRen = at('Total renewable'), iTot = at('Total');
  if (iNon < 0 || iRen < 0 || iTot < 0 || !(iNon < iRen && iRen < iTot)) throw new Error(`${what}: Total non-renewable, Total renewable and Total rows not found in order`);
  const iPump = at('Pumped hydro'), iPct = at('Per cent renewable generation');
  const num = (v) => (typeof v === 'number' ? v : v == null || label(v) === '' ? 0 : NaN);
  const years = [];
  for (const { c, period, estimate } of cols) {
    const sum = (from, to) => body.slice(from, to).reduce((s, b) => s + num(b.r[c]), 0);
    const nonRenewable = num(body[iNon].r[c]), renewable = num(body[iRen].r[c]), total = num(body[iTot].r[c]);
    if (![nonRenewable, renewable, total].every(Number.isFinite) || !(total > 0)) throw new Error(`${what} ${period}: a total is missing or not a number`);
    const tol = (x) => Math.max(1, Math.abs(x) * 5e-4);
    const nonSum = sum(0, iNon), renSum = sum(iNon + 1, iRen);
    if (!Number.isFinite(nonSum) || !near(nonSum, nonRenewable, tol(nonRenewable))) throw new Error(`${what} ${period}: non-renewable fuels add to ${nonSum.toFixed(1)} but Total non-renewable is ${nonRenewable}`);
    if (!Number.isFinite(renSum) || !near(renSum, renewable, tol(renewable))) throw new Error(`${what} ${period}: renewable fuels add to ${renSum.toFixed(1)} but Total renewable is ${renewable}`);
    if (!near(nonRenewable + renewable, total, tol(total))) throw new Error(`${what} ${period}: non-renewable + renewable = ${(nonRenewable + renewable).toFixed(1)} but Total is ${total}`);
    const share = (renewable / total) * 100;
    let pct = null;
    if (iPct >= 0) {
      pct = num(body[iPct].r[c]);
      if (!Number.isFinite(pct) || !near(pct, share, 0.01)) throw new Error(`${what} ${period}: printed renewable share ${pct} is not Total renewable ÷ Total (${share.toFixed(3)})`);
    }
    if (!(share >= 0 && share <= 100)) throw new Error(`${what} ${period}: renewable share ${share} outside 0 to 100`);
    years.push({ period, estimate, nonRenewable, renewable, total, pumpedHydro: iPump >= 0 ? num(body[iPump].r[c]) : null, pct, share });
  }
  const seen = new Set();
  for (const y of years) { if (seen.has(y.period)) throw new Error(`${what}: ${y.period} appears twice`); seen.add(y.period); }
  const start = (p) => Number(p.slice(0, 4));
  for (let i = 1; i < years.length; i++) if (start(years[i].period) !== start(years[i - 1].period) + 1) throw new Error(`${what}: ${years[i - 1].period} is followed by ${years[i].period}`);
  if (years.some((y, i) => y.estimate && i < years.length - 1)) throw new Error(`${what}: an estimate before the last year`);
  return { years };
}

/** A sheet by exact name, or an error naming the layout change. */
function sheetOf(wb, name, what) {
  const rows = wb.sheet(name);
  if (!rows) throw new Error(`${what}: no "${name}" sheet (has: ${wb.names.join(', ')})`);
  return rows;
}

/** Table O, Australia, financial and calendar years. */
export function parseTableO(wb) {
  return {
    fy: parseGeneration(sheetOf(wb, 'AUS FY', 'Table O'), 'Table O AUS FY').years,
    cy: parseGeneration(sheetOf(wb, 'AUS CY', 'Table O'), 'Table O AUS CY').years,
  };
}

/** The supplementary on-grid and off-grid statistics, financial and calendar years. */
export function parseOnGrid(wb) {
  const out = {};
  for (const [k, name] of [['fy', 'FY on-grid generation'], ['cy', 'CY on-grid generation'], ['offFy', 'FY off-grid generation'], ['offCy', 'CY off-grid generation']]) {
    out[k] = parseGeneration(sheetOf(wb, name, 'on-grid statistics'), `on-grid statistics ${name}`).years;
  }
  if (out.fy.some((y) => y.pct == null) || out.cy.some((y) => y.pct == null)) throw new Error('on-grid statistics: no "Per cent renewable generation" row');
  return out;
}

/**
 * The two releases agree: on-grid + pumped hydro + off-grid = Table O's total for every year all three have (within
 * 0.05% or 2 GWh). A failure means the on-grid measure has been redefined, so nothing is stored. Returns the lines.
 */
export function reconcileGrid(tableO, onGrid) {
  const lines = [];
  for (const [kind, on, off, all] of [['FY', onGrid.fy, onGrid.offFy, tableO.fy], ['CY', onGrid.cy, onGrid.offCy, tableO.cy]]) {
    for (const y of on) {
      const o = off.find((x) => x.period === y.period), t = all.find((x) => x.period === y.period);
      if (!o || !t) continue;
      const sum = y.total + (y.pumpedHydro ?? 0) + o.total;
      if (!near(sum, t.total, Math.max(2, t.total * 5e-4))) throw new Error(`renewables ${kind} ${y.period}: on-grid ${y.total} + pumped hydro ${y.pumpedHydro ?? 0} + off-grid ${o.total} = ${sum.toFixed(1)} GWh but Table O's total is ${t.total}`);
      lines.push(`${kind} ${y.period}: on-grid + pumped hydro + off-grid = ${sum.toFixed(1)} GWh = Table O ${t.total.toFixed(1)}`);
    }
  }
  if (!lines.length) throw new Error('renewables: no year in both the on-grid statistics and Table O to reconcile');
  return lines;
}

// ---------------------------------------------------------------------------------------------------- bulk billing

export const MEDICARE_COLLECTION = 'https://www.health.gov.au/resources/collections/medicare-statistics-collection';
const MEDICARE_SLUG = /\/resources\/publications\/medicare-quarterly-statistics-state-and-territory-(september|december|march|june)-quarter-(\d{4})-(\d{2})\b/i;

/** "2025-26 Q4 (Jun Qtr)" → "2026-Q2"; null if the label is not one. */
export function medicareQuarter(text) {
  const m = /^(\d{4})-(\d{2}) Q([1-4]) \((Sep|Dec|Mar|Jun) Qtr\)$/i.exec(label(text));
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) return null;
  const fq = Number(m[3]);
  if (['sep', 'dec', 'mar', 'jun'][fq - 1] !== m[4].toLowerCase()) return null;
  const y = Number(m[1]) + (fq >= 3 ? 1 : 0);
  return `${y}-Q${fq >= 3 ? fq - 2 : fq + 2}`;
}

/** The newest "Medicare quarterly statistics – state and territory" publication the collection page links to. */
export function latestMedicarePage(html, base = MEDICARE_COLLECTION) {
  let best = null;
  for (const h of hrefs(html)) {
    const m = MEDICARE_SLUG.exec(h);
    if (!m || (Number(m[2]) + 1) % 100 !== Number(m[3])) continue;
    const fq = { september: 1, december: 2, march: 3, june: 4 }[m[1].toLowerCase()];
    const quarter = medicareQuarter(`${m[2]}-${m[3]} Q${fq} (${m[1].slice(0, 3)} Qtr)`);
    if (quarter && (!best || quarter > best.quarter)) best = { quarter, url: abs(h.split('#')[0], base) };
  }
  return best;
}

/** The publication page's workbook. */
export function medicareFile(html, base) {
  const links = hrefs(html).filter((h) => /\.xlsx(\?|$)/i.test(h)).map((h) => abs(h, base));
  return { title: titleOf(html), xlsx: links.find((u) => /medicare-quarterly-statistics-state-and-territory/i.test(u)) ?? null };
}

export const GP_BTOS = 'Total GP Non-Referred Attendances';

/**
 * Table 1 ("All Services") of the state and territory workbook: the GP non-referred attendances bulk billing rate for
 * Australia, by quarter (the share of GP services bulk billed). Checks: the layout; for every quarter, bulk billed +
 * patient billed services = services, the printed rate = bulk billed ÷ services, the states (and "Unk") add to
 * Australia; rates between 0 and 1 as printed; quarters without a gap or a repeat.
 * Returns { quarters: [{ period, label, services, bulkBilled, rate }] }, oldest first, rate in per cent.
 */
export function parseMedicare(wb) {
  const rows = sheetOf(wb, 'All Services', 'Medicare workbook');
  const title = rows.flat().map(label).find((t) => /^Table 1:/i.test(t)) ?? '';
  if (!/Quarterly Medicare Statistics by Broad Type of Service and State/i.test(title)) throw new Error(`Medicare workbook: Table 1 is not "Quarterly Medicare Statistics by Broad Type of Service and State" ("${title}")`);
  const h = rows.findIndex((r) => label(r[0]) === 'Quarter' && label(r[1]) === 'State');
  if (h < 0) throw new Error('Medicare workbook: no Quarter / State header');
  const head = rows[h].map(label);
  const col = (name) => { const i = head.findIndex((t) => t === name); if (i < 0) throw new Error(`Medicare workbook: no "${name}" column`); return i; };
  const cB = col('Broad Type of Service'), cS = col('Services'), cBB = col('Bulk Billed Services'), cPB = col('Patient Billed Services'), cR = col('MBS Bulk Billing Rate (%)');
  const gp = rows.slice(h + 1).filter((r) => label(r[cB]) === GP_BTOS);
  if (!gp.length) throw new Error(`Medicare workbook: no "${GP_BTOS}" rows`);
  const byQ = new Map();
  for (const r of gp) {
    const q = medicareQuarter(r[0]);
    if (!q) throw new Error(`Medicare workbook: unrecognised quarter "${label(r[0])}"`);
    if (!byQ.has(q)) byQ.set(q, { label: label(r[0]), au: null, states: [] });
    const e = byQ.get(q);
    const v = { state: label(r[1]), services: r[cS], bulk: r[cBB], patient: r[cPB], rate: r[cR] };
    if (![v.services, v.bulk, v.patient].every((x) => Number.isInteger(x) && x >= 0)) throw new Error(`Medicare workbook ${q} ${v.state}: service counts are not whole numbers`);
    if (v.bulk + v.patient !== v.services) throw new Error(`Medicare workbook ${q} ${v.state}: bulk billed ${v.bulk} + patient billed ${v.patient} ≠ services ${v.services}`);
    if (v.state === 'Australia') { if (e.au) throw new Error(`Medicare workbook: ${q} Australia appears twice`); e.au = v; } else e.states.push(v);
  }
  const quarters = [];
  for (const [period, e] of [...byQ].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!e.au) throw new Error(`Medicare workbook: ${period} has no Australia row`);
    const { services, bulk, rate } = e.au;
    if (!(typeof rate === 'number' && rate > 0 && rate < 1)) throw new Error(`Medicare workbook ${period}: the rate ${rate} is not a share between 0 and 1 (the layout has changed)`);
    if (!near(rate, bulk / services, 1e-6)) throw new Error(`Medicare workbook ${period}: printed rate ${rate} ≠ bulk billed ÷ services ${(bulk / services).toFixed(6)}`);
    const sS = e.states.reduce((s, x) => s + x.services, 0), sB = e.states.reduce((s, x) => s + x.bulk, 0);
    if (e.states.length < 8 || sS !== services || sB !== bulk) throw new Error(`Medicare workbook ${period}: the states add to ${sS} services (${sB} bulk billed), Australia has ${services} (${bulk})`);
    quarters.push({ period, label: e.label, services, bulkBilled: bulk, rate: +(rate * 100).toFixed(3) });
  }
  for (let i = 1; i < quarters.length; i++) if (quarters[i].period !== nextQuarter(quarters[i - 1].period)) throw new Error(`Medicare workbook: ${quarters[i - 1].period} is followed by ${quarters[i].period}`);
  return { quarters };
}

// ---------------------------------------------------------------------------------------------------- shared

/** No duplicate periods, every value finite and (for a share) within 0 to 100. */
export function checkSeries(id, rows, { share = false } = {}) {
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.period)) throw new Error(`${id}: ${r.period} appears twice`);
    seen.add(r.period);
    if (!Number.isFinite(r.value)) throw new Error(`${id} ${r.period}: not a number`);
    if (share && !(r.value >= 0 && r.value <= 100)) throw new Error(`${id} ${r.period}: ${r.value} outside 0 to 100`);
  }
  return rows;
}

/**
 * The scorecard's series requests (source_suggestions, origin 'scorecard') each loader answers, by the exact wording
 * the scorecard files them under (web/lib/scorecard.ts CANONICAL_REQUESTS; scorecard.check.ts keeps the two equal).
 */
export const SCORECARD_REQUESTS = {
  emissions: { series: 'Australia net greenhouse gas emissions including LULUCF, National Greenhouse Gas Inventory', metric_id: 'emissions_change_from_2005_au' },
  renewables: { series: 'Renewable share of electricity generation, Australia, Australian Energy Statistics Table O', metric_id: 'renewable_share_ongrid_au' },
  'bulk-billing': { series: 'GP non-referred attendances bulk billing rate, Medicare quarterly statistics', metric_id: 'gp_bulk_billing_rate_au' },
};

