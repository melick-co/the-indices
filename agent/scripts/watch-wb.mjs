/**
 * World Bank WDI connector. Pulls annual history for configured indicators
 * across all entities in the store.
 *
 *   node scripts/watch-wb.mjs load
 */
import { WB_SERIES } from './wb-config.mjs';
import { createDb, loadEntityCodes, upsertSeries } from './lib/obs-loader.mjs';

const BASE = 'https://api.worldbank.org/v2';

async function fetchIndicator(indicator, startYear) {
  const url = `${BASE}/country/all/indicator/${indicator}?format=json&date=${startYear}:${new Date().getFullYear()}&per_page=20000`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`World Bank ${res.status} for ${indicator}`);
  const json = await res.json();
  return json[1] ?? [];
}

async function load() {
  const db = createDb();
  const entities = new Set(await loadEntityCodes(db));
  let totalNew = 0;
  const changed = [];

  for (const s of WB_SERIES) {
    try {
      const raw = await fetchIndicator(s.indicator, s.startYear);
      const rows = [];
      for (const row of raw) {
        const entity = row.countryiso3code;
        const value = row.value;
        if (!entity || value == null || !entities.has(entity)) continue;
        rows.push({
          metric_id: s.metric_id,
          entity,
          period: String(row.date),
          value: Number(value),
          status: 'published',
        });
      }
      if (!rows.length) {
        console.log(`${s.metric_id}: no rows for known entities`);
        continue;
      }

      const { fresh } = await upsertSeries(db, {
        ...s,
        source_org: 'World Bank',
        source_url: `https://data.worldbank.org/indicator/${s.indicator}`,
      }, rows);

      totalNew += fresh;
      if (fresh) changed.push(`${s.metric_id}+${fresh}`);
      const periods = rows.map((r) => r.period).sort();
      console.log(`${s.metric_id}: ${rows.length} obs (${fresh} new), ${periods[0]}–${periods[periods.length - 1]}`);
    } catch (e) {
      console.error(`${s.metric_id}: ${e.message}`);
    }
  }

  console.log(`\nDone. ${totalNew} new observations${changed.length ? ': ' + changed.join(', ') : ''}.`);
}

const cmd = process.argv[2];
if (cmd !== 'load') {
  console.log('Usage: node scripts/watch-wb.mjs load');
  process.exit(0);
}
load().catch((e) => { console.error(e.message); process.exit(1); });
