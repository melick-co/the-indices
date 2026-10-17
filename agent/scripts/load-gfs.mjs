/**
 * The government's profit and loss: the general government statement of operations (Government Finance Statistics),
 * quarterly, for the Commonwealth and for all levels of government combined. Official, keyless API.
 *
 * Source: IMF Quarterly Government Finance Statistics (dataflow IMF.STA,QGFS), Australia, statement of operations,
 * as reported by the Australian authorities. GFS basis (GFSM 2001/2014), accrual, original (not seasonally adjusted),
 * current prices, $ millions. The ABS Data API carries no GFS dataflow (checked against its full dataflow list,
 * October 2026), so this is the official API that does.
 *   gfs_cwth_*  sector S1321, central government including social security: the Commonwealth general government
 *   gfs_all_*   sector S13, general government: Commonwealth, state and local, consolidated
 * Lines: see ITEMS in lib/gfs.mjs (revenue and its tax split, expenses by type, net operating balance, net
 * acquisition of non-financial assets, net lending/borrowing).
 *
 * Before anything is stored, every quarter is checked: revenue − expenses = net operating balance, and net operating
 * balance − net acquisition of non-financial assets = net lending/borrowing (within rounding). A quarter that fails
 * is not stored, and the log says why. The breakdown lines of a quarter (taxes, revenue and expense components) are
 * stored only if they sum to their totals. A breakdown line that swings by more than three-quarters against the same
 * quarter a year earlier while its total holds is reported for checking (a reclassification or a one-off such as JobKeeper; not enforced, the totals are right).
 *
 * The Commonwealth series is published monthly and summed to quarters (the monthly series matches the Australian
 * Government's monthly financial statements); the all-governments series is quarterly. The two classify some expenses
 * differently (the Commonwealth's use of goods and services exceeds all governments' combined), so the page compares
 * totals and balances across them, not individual expense lines.
 *
 *   node scripts/load-gfs.mjs --dry-run   fetch, check and print the latest year, write nothing
 *   node scripts/load-gfs.mjs             upsert
 */
import { parseSdmxSeries } from './lib/sdmx-json.mjs';
import { CORE, EXPENSE_PARTS, ITEMS, SECTORS, TAX_PARTS, checkQuarter, fourTo, gfsId, qIndex, qLabel, shifts, val, yearSum } from './lib/gfs.mjs';

const UA = 'caveat-indices/0.1 (+https://caveat.news)';
const BASE = 'https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/QGFS/+';
const FROM = '2003-Q3';
// One request per sector, every indicator: the API's OR syntax (S13,S1321) is not applied reliably, so the lines
// are picked out here.
const keyFor = (sectorCode) => `AUS.SOO.${sectorCode}.*.Q`;
const CODE_TO_SUFFIX = new Map(ITEMS.map(([s, code]) => [code, s]));
const SECTOR_OF = new Map(Object.entries(SECTORS).map(([k, code]) => [code, k]));

async function getJson(url, attempts = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (!(res.status >= 500 || res.status === 429) || i >= attempts) throw new Error(`IMF ${res.status}: ${text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, Math.min(5000 * 2 ** (i - 1), 60000)));
  }
}

/** sector → Map(period → { suffix: $m }). The API returns dollars (SCALE 6 is display only). */
export async function fetchAll() {
  const out = { cwth: new Map(), all: new Map() };
  for (const [sector, code] of Object.entries(SECTORS)) {
    const rows = parseSdmxSeries(await getJson(`${BASE}/${keyFor(code)}`));
    if (!rows.length) throw new Error(`QGFS: no data for ${keyFor(code)}`);
    for (const r of rows) {
      const suffix = CODE_TO_SUFFIX.get(r.dims.INDICATOR);
      if (SECTOR_OF.get(r.dims.SECTOR) !== sector || !suffix || r.dims.FREQUENCY !== 'Q') continue;
      if (!/^\d{4}-Q[1-4]$/.test(r.period) || r.period < FROM || !Number.isFinite(r.value)) continue;
      const m = out[sector];
      if (!m.has(r.period)) m.set(r.period, {});
      m.get(r.period)[suffix] = Math.round(r.value / 1e6);
    }
  }
  return out;
}

/** Checked quarters: core lines for every quarter that adds up, breakdown lines only where they add up too. */
export function checked(byQuarter, label) {
  const keep = new Map();
  const refused = [], partial = [];
  for (const [p, q] of [...byQuarter].sort(([a], [b]) => a.localeCompare(b))) {
    const { core, breakdown } = checkQuarter(q);
    if (core.length) { refused.push(`${p}: ${core.join('; ')}`); continue; }
    if (breakdown.length) {
      partial.push(`${p}: ${breakdown.join('; ')}`);
      keep.set(p, Object.fromEntries(CORE.map((s) => [s, q[s]])));
    } else keep.set(p, q);
  }
  console.log(`${label}: ${keep.size} quarters pass (${[...keep.keys()][0]} to ${[...keep.keys()].at(-1)}), ${refused.length} refused, ${partial.length} stored without breakdown`);
  for (const r of refused) console.log(`  REFUSED ${r}`);
  for (const r of partial.slice(-8)) console.log(`  totals only ${r}`);
  if (partial.length > 8) console.log(`  (${partial.length - 8} earlier quarters stored as totals only)`);
  return keep;
}

export async function loadGfs({ dry = false } = {}) {
  const raw = await fetchAll();
  const data = { cwth: checked(raw.cwth, 'Commonwealth (S1321)'), all: checked(raw.all, 'All governments (S13)') };
  if (!data.cwth.size || !data.all.size) throw new Error('No quarter passed the checks; nothing stored.');

  // The latest four quarters both have, as the page will show them.
  const common = [...data.cwth.keys()].filter((p) => data.all.has(p)).sort();
  const end = [...common].reverse().find((p) => yearSum(data.cwth, 'employees', p) != null && yearSum(data.all, 'employees', p) != null);
  if (!end) throw new Error('No four quarters with a full breakdown for both sectors.');
  const latestAll = [...data.all.keys()].at(-1);
  console.log(`\nThe government's profit and loss, four quarters to ${end} (${fourTo(end).reverse().join(', ')}), $ billion${latestAll > end ? `; all governments also has ${latestAll}` : ''}`);
  console.log(`  ${''.padEnd(58)} ${'Cwth'.padStart(8)} ${'a yr ago'.padStart(8)} ${'All govts'.padStart(9)}`);
  const prior = qLabel(qIndex(end) - 4);
  for (const [s, , name] of ITEMS) {
    const f = (v) => (v == null ? '—' : (v / 1000).toFixed(1));
    console.log(`  ${name.slice(0, 58).padEnd(58)} ${f(yearSum(data.cwth, s, end)).padStart(8)} ${f(yearSum(data.cwth, s, prior)).padStart(8)} ${f(yearSum(data.all, s, end)).padStart(9)}`);
  }
  for (const [label, m] of [['Commonwealth', data.cwth], ['All governments', data.all]]) {
    const last = [...m.keys()].at(-1), q = m.get(last);
    console.log(`  latest quarter ${label} ${last}: revenue ${val(q, 'revenue')} − expenses ${val(q, 'expense')} = NOB ${val(q, 'nob')}; − net investment ${val(q, 'net_investment')} = net lending ${val(q, 'nlb')} ($m)`);
  }
  // Reported, not enforced: a line that swings while its total holds is a reclassification or a one-off (JobKeeper).
  for (const [label, m] of [['Commonwealth', data.cwth], ['All governments', data.all]]) {
    for (const n of shifts(m, TAX_PARTS, 'tax').concat(shifts(m, EXPENSE_PARTS, 'expense')).filter((x) => x.period >= '2015')) {
      console.log(`note ${label} ${n.period}: ${n.line} ${n.value.toLocaleString('en-AU')} against ${n.before.toLocaleString('en-AU')} a year earlier while the total held (a reclassification in the source or a one-off; check before reporting the line)`);
    }
  }
  if (dry) return;

  const { createDb, upsertSeries } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  let n = 0;
  for (const [sector, m] of Object.entries(data)) {
    const who = sector === 'cwth' ? 'Commonwealth general government' : 'All levels of government (general government, consolidated)';
    for (const [suffix, code, name] of ITEMS) {
      const id = gfsId(sector, suffix);
      const rows = [...m].filter(([, q]) => q[suffix] != null).map(([period, q]) => ({ metric_id: id, entity: 'AUS', period, value: q[suffix] }));
      if (!rows.length) continue;
      await upsertSeries(db, {
        metric_id: id, name: `${who}: ${name}`, unit: 'AUD millions',
        basis: `${name}, ${who.toLowerCase()}, GFS statement of operations, accrual, current prices, original, quarterly`,
        direction: 'neutral', category: 'government_finance', source_tier: 2, source_org: 'IMF',
        source_dataset: 'Quarterly Government Finance Statistics (QGFS), reported by the Australian authorities (IMF Data API)',
        source_url: `${BASE}/AUS.SOO.${SECTORS[sector]}.${code}.Q`,
      }, rows);
      n++;
    }
  }
  console.log(`Stored ${n} series.`);
}

if (process.argv[1]?.endsWith('load-gfs.mjs')) {
  await loadGfs({ dry: process.argv.includes('--dry-run') });
}
