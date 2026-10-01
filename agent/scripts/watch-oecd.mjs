/**
 * OECD SDMX connector.
 *
 *   node scripts/watch-oecd.mjs discover <term>          list dataflows matching <term>
 *   node scripts/watch-oecd.mjs structure <AGENCY/DSD@DF/VER>  dimensions and available codes
 *   node scripts/watch-oecd.mjs peek <AGENCY,DSD@DF,VER> <key>  print AUS rows, no writes
 *   node scripts/watch-oecd.mjs load                      load OECD_SERIES into the store
 *
 * The API rejects format=jsondata; ask for SDMX-JSON through the Accept header.
 */
import { OECD_SERIES } from './oecd-config.mjs';
import { parseSdmxSeries } from './lib/sdmx-json.mjs';
import { createDb, loadEntityCodes, upsertSeries } from './lib/obs-loader.mjs';

const BASE = 'https://sdmx.oecd.org/public/rest';
const UA = 'caveat-indices/0.1 (+https://the-indices.vercel.app)';
const STRUCTURE = 'application/vnd.sdmx.structure+json;version=1.0';
const DATA = 'application/vnd.sdmx.data+json;version=1.0';

// The OECD API rate-limits per hour (429) and fails intermittently (500) on
// requests that succeed later, so retry with backoff, honouring Retry-After.
async function oecdFetch(path, accept = STRUCTURE, attempts = 6) {
  for (let i = 1; ; i++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'user-agent': UA, accept },
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (res.ok) {
      try { return JSON.parse(text); } catch { return text; }
    }
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || i >= attempts) throw new Error(`OECD ${res.status}: ${text.slice(0, 200)}`);
    const after = Number(res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, after > 0 ? after * 1000 : 5000 * 2 ** (i - 1)));
  }
}

async function fetchSeries(flow, key, startPeriod) {
  const json = await oecdFetch(`/data/${flow}/${key}?startPeriod=${startPeriod}`, DATA);
  return parseSdmxSeries(json);
}

// E = estimated. Provisional (P) and break-in-series (B) values are still published figures.
const statusOf = (obsStatus) => (obsStatus === 'E' ? 'estimated' : 'published');

async function discover(term) {
  const json = await oecdFetch('/dataflow/all?detail=allstubs');
  const flows = json?.data?.dataflows ?? [];
  const t = (term ?? '').toLowerCase();
  const hits = flows.filter((f) =>
    `${f.id} ${f.name ?? ''}`.toLowerCase().includes(t));
  console.log(`${hits.length} dataflow(s) matching "${term ?? '(all)'}":\n`);
  hits.slice(0, 60).forEach((f) =>
    console.log(`  ${`${f.agencyID},${f.id},${f.version}`.padEnd(58)} ${f.name}`));
}

async function structure(ref) {
  const json = await oecdFetch(`/dataflow/${ref}?references=all`);
  const ds = json?.data?.dataStructures?.[0];
  const dims = ds?.dataStructureComponents?.dimensionList?.dimensions ?? [];
  const cls = json?.data?.codelists ?? [];
  // Only list codes that actually have data in this dataflow.
  const actual = (json?.data?.contentConstraints ?? []).find((c) => c.type === 'Actual');
  const allowed = {};
  for (const kv of actual?.cubeRegions?.[0]?.keyValues ?? []) allowed[kv.id] = new Set(kv.values);

  console.log(`Dimensions for ${ref} (key order):\n`);
  dims.forEach((d, i) => {
    const clId = (d.localRepresentation?.enumeration ?? '').split(':').pop().split('(')[0];
    let codes = cls.find((c) => c.id === clId)?.codes ?? [];
    if (allowed[d.id]) codes = codes.filter((c) => allowed[d.id].has(c.id));
    console.log(`  ${i + 1}. ${d.id}`);
    codes.slice(0, 15).forEach((c) => console.log(`       ${String(c.id).padEnd(14)} ${c.name}`));
    if (codes.length > 15) console.log(`       ... ${codes.length - 15} more`);
  });
}

async function peek(flow, key) {
  const rows = await fetchSeries(flow, key, '2015');
  const areas = new Set(rows.map((r) => r.dims.REF_AREA));
  console.log(`${rows.length} observations across ${areas.size} areas. AUS:\n`);
  rows.filter((r) => r.dims.REF_AREA === 'AUS')
    .sort((a, b) => a.period.localeCompare(b.period))
    .forEach((r) => console.log(`  ${r.period}  ${r.value}${r.obsStatus && r.obsStatus !== 'A' ? ` (${r.obsStatus})` : ''}`));
}

export async function loadOecd(db = createDb()) {
  const entities = new Set(await loadEntityCodes(db));
  let totalNew = 0;
  const changedMetrics = [];

  const cache = new Map();
  for (const s of OECD_SERIES) {
    try {
      const cacheKey = `${s.flow}/${s.key}/${s.startPeriod}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, fetchSeries(s.flow, s.key, s.startPeriod));
      const raw = await cache.get(cacheKey);
      const rows = raw
        .filter((r) => r.dims.MEASURE === s.measure && entities.has(r.dims.REF_AREA))
        .map((r) => ({
          metric_id: s.metric_id,
          entity: r.dims.REF_AREA,
          period: r.period,
          value: Number(r.value.toFixed(2)),
          status: statusOf(r.obsStatus),
        }));
      if (!rows.length) { console.log(`${s.metric_id}: no rows for known entities`); continue; }

      const { fresh } = await upsertSeries(db, {
        metric_id: s.metric_id, name: s.name, unit: s.unit, basis: s.basis,
        direction: s.direction, category: s.category, source_tier: 1,
        source_org: 'OECD', source_dataset: s.source_dataset,
        source_url: `${BASE}/data/${s.flow}/${s.key}`,
        source_id: 'oecd_gov',
      }, rows);
      totalNew += fresh;
      if (fresh) changedMetrics.push(s.metric_id);
      const aus = rows.filter((r) => r.entity === 'AUS').sort((a, b) => a.period.localeCompare(b.period)).at(-1);
      console.log(`${s.metric_id}: ${rows.length} obs (${fresh} new) across ` +
        `${new Set(rows.map((r) => r.entity)).size} countries; AUS latest ${aus ? `${aus.period} = ${aus.value}` : 'none'}`);
    } catch (e) {
      console.error(`${s.metric_id}: ${e.message}`);
    }
  }
  console.log(`\nDone. ${totalNew} new OECD observations.`);
  return { totalNew, changedMetrics };
}

const isMain = process.argv[1]?.endsWith('watch-oecd.mjs');
if (isMain) {
  const [, , cmd, a, b] = process.argv;
  const run = {
    discover: () => discover(a),
    structure: () => structure(a),
    peek: () => peek(a, b),
    load: () => loadOecd(),
  }[cmd];
  if (!run) {
    console.log(`Usage:
  node scripts/watch-oecd.mjs discover <term>
  node scripts/watch-oecd.mjs structure <AGENCY/DSD@DF/VERSION>
  node scripts/watch-oecd.mjs peek <AGENCY,DSD@DF,VERSION> <key>
  node scripts/watch-oecd.mjs load`);
    process.exit(0);
  }
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
