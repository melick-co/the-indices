/**
 * RBA CSV connector. Pulls configured series from rba.gov.au/statistics/tables/csv/
 *
 *   node scripts/watch-rba.mjs load
 */
import { RBA_SERIES } from './rba-config.mjs';
import { parseRbaCsv } from './lib/rba-csv.mjs';
import { createDb, upsertSeries } from './lib/obs-loader.mjs';

const BASE = 'https://www.rba.gov.au/statistics/tables/csv';
const UA = 'caveat-indices/0.1 (+https://the-indices.vercel.app)';
const ENTITY = 'AUS';

async function fetchCsv(file) {
  const res = await fetch(`${BASE}/${file}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`RBA ${res.status} for ${file}`);
  return res.text();
}

async function load() {
  const db = createDb();
  let totalNew = 0;
  const changed = [];

  for (const s of RBA_SERIES) {
    try {
      const text = await fetchCsv(s.file);
      const parsed = parseRbaCsv(text, s.column, s.cadence);
      const rows = parsed.map((r) => ({
        metric_id: s.metric_id,
        entity: ENTITY,
        period: r.period,
        value: r.value,
        status: 'published',
      }));
      if (!rows.length) {
        console.log(`${s.metric_id}: no rows`);
        continue;
      }

      const { fresh } = await upsertSeries(db, {
        ...s,
        source_org: 'RBA',
        source_url: `${BASE}/${s.file}`,
        source_tier: 1,
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
  console.log('Usage: node scripts/watch-rba.mjs load');
  process.exit(0);
}
load().catch((e) => { console.error(e.message); process.exit(1); });
