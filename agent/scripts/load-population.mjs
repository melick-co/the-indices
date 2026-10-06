/**
 * Population in detail, from the ABS Data API (official, tier 1):
 *
 *  - Components of change, quarterly, Australia (ERP_COMP_Q) → observations:
 *      pop_erp_q, pop_births_q, pop_deaths_q, pop_natural_increase_q, pop_os_arrivals_q, pop_os_departures_q,
 *      pop_nom_q, pop_change_q, the same as rolling twelve-month sums (…_12m), and pop_growth_rate_12m (%).
 *  - Breakdowns (agent/supabase/38_breakdowns.sql): residents by country of birth (ERP_COB), migrant arrivals
 *    and departures by visa group (OMAD_VISA, quarterly), and short-term movements by reason (OAD_REASON) and
 *    country (OAD_COUNTRY): visitors arriving, and Australian residents returning from trips abroad.
 *
 *   node scripts/load-population.mjs --dry-run   fetch and print, write nothing
 *   node scripts/load-population.mjs             upsert
 */
const BASE = 'https://data.api.abs.gov.au/rest';
const UA = 'caveat-indices/0.1 (+https://caveat.news)';

async function abs(path, accept) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`ABS ${res.status} for ${path}`);
  return res.text();
}

/** SDMX-CSV rows as objects, values scaled by UNIT_MULT (ERP_COMP_Q publishes thousands). */
export async function absCsv(flow, key, params = '') {
  const text = await abs(`/data/ABS,${flow}/${key}${params}`, 'application/vnd.sdmx.data+csv');
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => {
    const c = l.split(',');
    const row = Object.fromEntries(cols.map((k, i) => [k, c[i]]));
    const mult = Number(row.UNIT_MULT || 0);
    return { ...row, value: row.OBS_VALUE === '' ? null : Number(row.OBS_VALUE) * 10 ** mult };
  }).filter((r) => r.value != null && Number.isFinite(r.value));
}

/** Code → name for one dimension of a dataflow. */
async function codeNames(flow, dimension) {
  const json = JSON.parse(await abs(`/dataflow/ABS/${flow}?references=all`, 'application/vnd.sdmx.structure+json')).data;
  const dim = json.dataStructures[0].dataStructureComponents.dimensionList.dimensions.find((d) => d.id === dimension);
  const clId = dim.localRepresentation.enumeration.match(/:([A-Z0-9_]+)\(/)[1];
  const cl = json.codelists.find((c) => c.id === clId);
  return new Map(cl.codes.map((c) => [c.id, c.name ?? c.names?.en]));
}

const src = (flow, key) => `${BASE}/data/ABS,${flow}/${key}`;

// ---------------------------------------------------------------------------------------------------- components

const COMPONENTS = [
  ['10', 'pop_erp_q', 'Estimated resident population', 'Estimated resident population at the end of the quarter', 'neutral'],
  ['1', 'pop_births_q', 'Births', 'Births in the quarter', 'neutral'],
  ['2', 'pop_deaths_q', 'Deaths', 'Deaths in the quarter', 'neutral'],
  ['3', 'pop_natural_increase_q', 'Natural increase', 'Births less deaths in the quarter', 'neutral'],
  ['7', 'pop_os_arrivals_q', 'Overseas migration arrivals', 'Overseas migration arrivals in the quarter (people arriving to stay 12 of the next 16 months)', 'neutral'],
  ['8', 'pop_os_departures_q', 'Overseas migration departures', 'Overseas migration departures in the quarter (people leaving for 12 of the next 16 months)', 'neutral'],
  ['9', 'pop_nom_q', 'Net overseas migration', 'Overseas migration arrivals less departures in the quarter', 'neutral'],
];
// The ABS's own "change over previous quarter" (measure 13) is published in thousands with no unit multiplier, so
// the change is derived from the population itself (they agree: 27,921.2 − 27,790.3 = 130.9 thousand, March 2026).
const CHANGE = ['pop_change_q', 'Population change', 'Change in estimated resident population over the quarter', 'neutral'];

async function components() {
  const key = `${COMPONENTS.map(([m]) => m).join('+')}.AUS.Q`;
  const rows = await absCsv('ERP_COMP_Q', key);
  const series = [];
  const byMeasure = (m) => rows.filter((r) => r.MEASURE === m).map((r) => ({ period: r.TIME_PERIOD, value: Math.round(r.value) }))
    .sort((a, b) => a.period.localeCompare(b.period));
  const erpPts = byMeasure('10');
  const next = (p) => { const [y, q] = p.split('-Q').map(Number); return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`; };
  const changePts = erpPts.slice(1).filter((p, i) => next(erpPts[i].period) === p.period).map((p) => ({ period: p.period, value: p.value - erpPts[erpPts.findIndex((x) => x.period === p.period) - 1].value }));
  for (const [measure, id, name, basis, direction] of [...COMPONENTS, ['change', ...CHANGE]]) {
    const pts = measure === 'change' ? changePts : byMeasure(measure);
    series.push({ id, name: `${name} (quarterly)`, basis, direction, unit: 'persons', pts });
    if (id === 'pop_erp_q') continue;
    // Rolling twelve months: the four quarters to each quarter, only where all four are published and consecutive.
    const twelve = [];
    for (let i = 3; i < pts.length; i++) {
      const four = pts.slice(i - 3, i + 1);
      const [y0, q0] = four[0].period.split('-Q').map(Number);
      const [y3, q3] = four[3].period.split('-Q').map(Number);
      if ((y3 * 4 + q3) - (y0 * 4 + q0) !== 3) continue;
      twelve.push({ period: pts[i].period, value: four.reduce((s, p) => s + p.value, 0) });
    }
    series.push({ id: id.replace(/_q$/, '_12m'), name: `${name}, twelve months`, basis: `${basis.replace(' in the quarter', '').replace(' over the quarter', '')}, summed over the four quarters to the period shown`, direction, unit: 'persons', pts: twelve });
  }
  // Annual growth rate: twelve-month change over the population a year earlier.
  const erp = new Map(series.find((s) => s.id === 'pop_erp_q').pts.map((p) => [p.period, p.value]));
  const change = series.find((s) => s.id === 'pop_change_12m').pts;
  const prior = (p) => { const [y, q] = p.split('-Q').map(Number); return `${y - 1}-Q${q}`; };
  series.push({
    id: 'pop_growth_rate_12m', name: 'Population growth rate, twelve months', unit: 'percent', direction: 'neutral',
    basis: 'Change in estimated resident population over twelve months, as a share of the population a year earlier',
    pts: change.filter((c) => erp.has(prior(c.period))).map((c) => ({ period: c.period, value: Math.round((c.value / erp.get(prior(c.period))) * 10000) / 100 })),
  });
  return series.map((s) => ({ ...s, source_url: src('ERP_COMP_Q', key) }));
}

// ---------------------------------------------------------------------------------------------------- breakdowns

async function breakdowns() {
  const out = [];
  // Residents by country of birth, all ages, persons. SACC: four-digit codes are countries; shorter are regions.
  const cob = await absCsv('ERP_COB', 'TOT.3..AUS.A');
  const cobNames = await codeNames('ERP_COB', 'COUNTRY_BIRTH');
  for (const r of cob) {
    const code = r.COUNTRY_BIRTH;
    out.push({ dataset: 'erp_cob', category: code, category_name: cobNames.get(code) ?? code,
      category_level: code === 'TOT' ? 'total' : /^\d{4}$/.test(code) && !/00$/.test(code) ? 'item' : 'group',
      period: r.TIME_PERIOD, value: Math.round(r.value), source_url: src('ERP_COB', 'TOT.3..AUS.A') });
  }
  // Migrant arrivals and departures by visa group, quarterly (the financial-year NOM-by-visa flow stops at 2022-23).
  const visa = await absCsv('OMAD_VISA', '..AUS.Q');
  const visaNames = await codeNames('OMAD_VISA', 'VISA');
  for (const r of visa) {
    const name = visaNames.get(r.VISA) ?? r.VISA;
    out.push({ dataset: r.MEASURE === 'M1' ? 'migrant_arrivals_visa' : 'migrant_departures_visa', category: r.VISA, category_name: name,
      // 1020/1040 are the temporary and permanent totals; 22 (students) sums 2203, 2208 and 1009.
      category_level: r.VISA === '1041' ? 'total' : ['1020', '1040', '22'].includes(r.VISA) ? 'group' : 'item',
      period: r.TIME_PERIOD, value: Math.round(r.value), source_url: src('OMAD_VISA', '..AUS.Q') });
  }
  // Short-term movements, monthly: visitors arriving (traveller category 06) and Australian residents returning from
  // trips abroad (05; for residents the country dimension is the main destination). Both from July 1975.
  const reasonNames = await codeNames('OAD_REASON', 'JOUR_REASON');
  const countryNames = await codeNames('OAD_COUNTRY', 'COUNTRY_RESID');
  for (const [cat, prefix] of [['06', 'visitors'], ['05', 'residents_trips']]) {
    const reason = await absCsv('OAD_REASON', `${cat}.TOT..10.M`);
    for (const r of reason) {
      out.push({ dataset: `${prefix}_reason`, category: r.JOUR_REASON, category_name: reasonNames.get(r.JOUR_REASON) ?? r.JOUR_REASON,
        category_level: r.JOUR_REASON === 'TOT' ? 'total' : 'item', period: r.TIME_PERIOD, value: Math.round(r.value),
        source_url: src('OAD_REASON', `${cat}.TOT..10.M`) });
    }
    // Every month the ABS publishes (from July 1975), so races can start as early as the data allows.
    const country = await absCsv('OAD_COUNTRY', `${cat}..10.M`);
    for (const r of country) {
      const code = r.COUNTRY_RESID;
      const name = countryNames.get(code) ?? code;
      out.push({ dataset: `${prefix}_country`, category: code, category_name: name,
        // OT1–OT9 ('Other South-East Asia' …) and NI ('Not stated') are residual groups, not countries.
        category_level: code === 'TOT' ? 'total' : /^total/i.test(name) || /^T/.test(code) || /^OT\d$/.test(code) || code === 'NI' ? 'group' : 'item',
        period: r.TIME_PERIOD, value: Math.round(r.value), source_url: src('OAD_COUNTRY', `${cat}..10.M`) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- main

export async function loadPopulation({ dry = false } = {}) {
  const comps = await components();
  for (const s of comps) {
    const last = s.pts.at(-1);
    console.log(`${s.id.padEnd(26)} ${String(s.pts.length).padStart(4)} readings, ${s.pts[0]?.period} to ${last?.period}: ${last?.value.toLocaleString('en-AU')}`);
  }
  const rows = await breakdowns();
  const by = new Map();
  for (const r of rows) by.set(r.dataset, [...(by.get(r.dataset) ?? []), r]);
  for (const [ds, rs] of by) {
    const periods = [...new Set(rs.map((r) => r.period))].sort();
    const latest = rs.filter((r) => r.period === periods.at(-1) && r.category_level === 'item').sort((a, b) => b.value - a.value).slice(0, 5);
    console.log(`${ds.padEnd(20)} ${String(rs.length).padStart(6)} rows, ${periods[0]} to ${periods.at(-1)}; top ${periods.at(-1)}: ${latest.map((r) => `${r.category_name} ${r.value.toLocaleString('en-AU')}`).join(', ')}`);
  }
  if (dry) return;

  const { createDb, upsertSeries } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  for (const s of comps) {
    await upsertSeries(db, {
      metric_id: s.id, name: s.name, unit: s.unit, basis: s.basis, direction: s.direction, category: 'population',
      source_tier: 1, source_org: 'ABS', source_dataset: 'National, state and territory population: components of change (ERP_COMP_Q)',
      source_url: s.source_url,
    }, s.pts.map((p) => ({ metric_id: s.id, entity: 'AUS', period: p.period, value: p.value })));
  }
  const stamp = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from('breakdowns').upsert(rows.slice(i, i + 1000).map((r) => ({ ...r, region: 'AUS', updated_at: stamp })), { onConflict: 'dataset,category,region,period' });
    if (error) throw new Error(`breakdowns upsert: ${error.message}`);
  }
  console.log(`Stored ${comps.length} component series and ${rows.length} breakdown rows.`);
}

if (process.argv[1]?.endsWith('load-population.mjs')) {
  await loadPopulation({ dry: process.argv.includes('--dry-run') });
}
