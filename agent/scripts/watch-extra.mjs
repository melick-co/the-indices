/**
 * Loader for scout-adopted BIS and IMF series (series_registry rows with
 * provider 'bis' or 'imf'). These providers have no hard-coded series.
 *
 *   node scripts/watch-extra.mjs load
 */
import { createDb, loadEntityCodes, upsertSeries } from './lib/obs-loader.mjs';
import { loadRegistry } from './lib/registry.mjs';
import { fetchRows } from './lib/sdmx-providers.mjs';

const ORG = { bis: 'Bank for International Settlements', imf: 'International Monetary Fund' };
const URL_OF = {
  bis: (flow, key) => `https://stats.bis.org/api/v1/data/${flow}/${key}`,
  imf: (flow, key) => { const [a, id] = flow.split(','); return `https://api.imf.org/external/sdmx/3.0/data/dataflow/${a}/${id}/+/${key}`; },
};

export async function loadExtra(db = createDb()) {
  const entities = new Set(await loadEntityCodes(db));
  let totalNew = 0;
  const changedMetrics = [];
  for (const provider of ['bis', 'imf']) {
    for (const s of await loadRegistry(db, provider)) {
      try {
        const raw = await fetchRows(provider, s.flow, s.key, '2000');
        const rows = raw
          .filter((r) => entities.has(r.entity))
          .map((r) => ({
            metric_id: s.metric_id, entity: r.entity, period: r.period,
            value: Number(r.value.toFixed(4)),
            status: r.obsStatus === 'E' ? 'estimated' : 'published',
          }));
        if (!rows.length) { console.log(`${s.metric_id}: no rows for known entities`); continue; }
        if (new Set(rows.map((r) => `${r.entity}|${r.period}`)).size !== rows.length) {
          console.error(`${s.metric_id}: key returns several series per country; not loaded`);
          continue;
        }
        const { fresh } = await upsertSeries(db, {
          metric_id: s.metric_id, name: s.name, unit: s.unit, basis: s.basis,
          direction: s.direction, category: s.category, source_tier: 1,
          source_org: ORG[provider], source_dataset: `${s.flow} (added by source scout)`,
          source_url: URL_OF[provider](s.flow, s.key), source_id: 'scout_registry',
        }, rows);
        totalNew += fresh;
        if (fresh) changedMetrics.push(s.metric_id);
        const aus = rows.filter((r) => r.entity === 'AUS').sort((a, b) => a.period.localeCompare(b.period)).at(-1);
        console.log(`${s.metric_id}: ${rows.length} obs (${fresh} new) across ${new Set(rows.map((r) => r.entity)).size} countries; AUS latest ${aus ? `${aus.period} = ${aus.value}` : 'none'}`);
      } catch (e) {
        console.error(`${s.metric_id}: ${e.message}`);
      }
    }
  }
  console.log(`\nDone. ${totalNew} new BIS/IMF observations.`);
  return { totalNew, changedMetrics };
}

const isMain = process.argv[1]?.endsWith('watch-extra.mjs');
if (isMain) {
  if (process.argv[2] !== 'load') { console.log('Usage: node scripts/watch-extra.mjs load'); process.exit(0); }
  loadExtra().catch((e) => { console.error(e.message); process.exit(1); });
}
