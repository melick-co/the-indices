/**
 * Rates for showing US-dollar figures in Australian dollars (OECD National Accounts Table 4, official, tier 1).
 *
 * Annual, Australia, Australian dollars per US dollar:
 *   fx_aud_usd_avg   exchange rate, annual average          for figures converted to US$ at market rates (IMF, World Bank)
 *   ppp_aud_aic      PPP for actual individual consumption  for How's Life? household income
 *   ppp_aud_hfce     PPP for household final consumption    for How's Life? wealth and earnings
 *   ppp_aud_gdp      PPP for GDP                            for GDP-based figures at PPP
 *
 * Each US$ figure is converted with the rate of its own year, so the A$ shown is the amount the source started from.
 *
 *   node scripts/load-fx.mjs --dry-run   fetch and print, write nothing
 *   node scripts/load-fx.mjs             upsert
 */
const URL = 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAMAIN10@DF_TABLE4,/A.AUS..........?startPeriod=2000&dimensionAtObservation=AllDimensions&format=csvfilewithlabels';
const SERIES = {
  EXC_A: ['fx_aud_usd_avg', 'Exchange rate, A$ per US$ (annual average)'],
  PPP_P41: ['ppp_aud_aic', 'Purchasing power parity for actual individual consumption, A$ per US$'],
  PPP_P31S14: ['ppp_aud_hfce', 'Purchasing power parity for household final consumption, A$ per US$'],
  PPP_B1GQ: ['ppp_aud_gdp', 'Purchasing power parity for GDP, A$ per US$'],
};

function parseCsv(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]);
  for (const l of lines.slice(1)) { const v = split(l); rows.push(Object.fromEntries(head.map((h, i) => [h, v[i]]))); }
  return rows;
}

export async function loadFx({ dry = false } = {}) {
  // The OECD API throttles and returns the odd 500 or 429: five tries, with longer pauses between.
  let text = null;
  for (let attempt = 1; attempt <= 5 && text == null; attempt++) {
    const res = await fetch(URL, {
      headers: { accept: 'text/csv', 'user-agent': 'caveat-indices-data-loader (+https://the-indices.vercel.app/methodology)' },
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (res?.ok) text = await res.text();
    else if (attempt < 5) { console.log(`OECD Table 4: ${res?.status ?? 'no response'}, retrying`); await new Promise((r) => setTimeout(r, 15000 * attempt)); }
    else throw new Error(`OECD Table 4: ${res?.status ?? 'no response'}`);
  }
  const rows = parseCsv(text);
  const series = new Map();
  for (const r of rows) {
    const s = SERIES[r.TRANSACTION];
    if (!s || r.UNIT_MEASURE !== 'XDC_USD' || r.OBS_VALUE === '' || r.OBS_VALUE == null) continue;
    const v = Number(r.OBS_VALUE);
    if (!Number.isFinite(v) || v <= 0.3 || v >= 5) throw new Error(`Implausible ${r.TRANSACTION} for ${r.TIME_PERIOD}: ${r.OBS_VALUE}`);
    if (!series.has(s[0])) series.set(s[0], { id: s[0], name: s[1], code: r.TRANSACTION, pts: [] });
    series.get(s[0]).pts.push({ period: r.TIME_PERIOD, value: v });
  }
  if (series.size < 4) throw new Error(`Only ${series.size} of 4 series found; nothing stored.`);
  for (const s of series.values()) {
    s.pts.sort((a, b) => a.period.localeCompare(b.period));
    const last = s.pts.at(-1);
    console.log(`${s.id.padEnd(16)} ${s.pts.length} years to ${last.period}: ${last.value}`);
  }
  if (dry) return;
  const { createDb, upsertSeries } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  for (const s of series.values()) {
    await upsertSeries(db, {
      metric_id: s.id, name: s.name, unit: 'AUD per USD', basis: `${s.name}; OECD National Accounts Table 4 (${s.code})`,
      direction: 'neutral', category: 'exchange_rates', source_tier: 1, source_org: 'OECD',
      source_dataset: 'Annual Purchasing Power Parities and exchange rates (Table 4)', source_url: URL.replace('&format=csvfilewithlabels', ''),
    }, s.pts.map((p) => ({ metric_id: s.id, entity: 'AUS', period: p.period, value: p.value })));
  }
  console.log(`Stored ${series.size} series.`);
}

if (process.argv[1]?.endsWith('load-fx.mjs')) {
  await loadFx({ dry: process.argv.includes('--dry-run') });
}
