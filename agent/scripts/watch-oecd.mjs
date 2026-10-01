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
import https from 'node:https';
import { OECD_SERIES } from './oecd-config.mjs';
import { parseSdmxSeries } from './lib/sdmx-json.mjs';
import { createDb, loadEntityCodes, upsertSeries } from './lib/obs-loader.mjs';
import { loadRegistry } from './lib/registry.mjs';

const BASE = 'https://sdmx.oecd.org/public/rest';
const UA = 'caveat-indices/0.1 (+https://the-indices.vercel.app)';
const STRUCTURE = 'application/vnd.sdmx.structure+json;version=1.0';
const DATA = 'application/vnd.sdmx.data+json;version=1.0';

// The OECD origin fails often (500) and rate-limits (429); its CDN serves cached
// copies fine. fetch() adds headers (accept-language, sec-fetch-mode,
// accept-encoding) that miss the cache and reach the failing origin, so send a
// plain request with only the headers below, as curl does. Retry with backoff.
function get(url, accept) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { accept, 'user-agent': UA }, timeout: 120000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('OECD request timed out')));
    req.on('error', reject);
  });
}

export async function oecdFetch(path, accept = STRUCTURE, attempts = 5) {
  for (let i = 1; ; i++) {
    const res = await get(`${BASE}${path}`, accept);
    if (res.status >= 200 && res.status < 300) {
      try { return JSON.parse(res.body); } catch { return res.body; }
    }
    const retryable = res.status >= 500 || res.status === 429;
    if (!retryable || i >= attempts) throw new Error(`OECD ${res.status}: ${res.body.slice(0, 200)}`);
    // Cap the wait: Retry-After can be an hour, and the nightly job has other sources to load.
    const after = Number(res.headers['retry-after']);
    const wait = Math.min(after > 0 ? after * 1000 : 5000 * 2 ** (i - 1), 60000);
    console.log(`  OECD ${res.status}; retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function fetchSeries(flow, key, startPeriod) {
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
  const scouted = (await loadRegistry(db, 'oecd')).map((r) => ({
    metric_id: r.metric_id, name: r.name, flow: r.flow, key: r.key, measure: r.measure, startPeriod: '2000',
    unit: r.unit, basis: r.basis, direction: r.direction, category: r.category,
    source_dataset: `${r.flow} (added by source scout)`,
  }));
  for (const s of [...OECD_SERIES, ...scouted]) {
    try {
      const cacheKey = `${s.flow}/${s.key}/${s.startPeriod}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, fetchSeries(s.flow, s.key, s.startPeriod));
      const raw = await cache.get(cacheKey);
      const rows = raw
        .filter((r) => (!s.measure || r.dims.MEASURE === s.measure) && entities.has(r.dims.REF_AREA))
        .map((r) => ({
          metric_id: s.metric_id,
          entity: r.dims.REF_AREA,
          period: r.period,
          value: Number(r.value.toFixed(2)),
          status: statusOf(r.obsStatus),
        }));
      if (!rows.length) { console.log(`${s.metric_id}: no rows for known entities`); continue; }
      // A key must give one value per country and period; anything else is ambiguous.
      if (new Set(rows.map((r) => `${r.entity}|${r.period}`)).size !== rows.length) {
        console.error(`${s.metric_id}: key returns several series per country; not loaded`);
        continue;
      }

      const { fresh } = await upsertSeries(db, {
        metric_id: s.metric_id, name: s.name, unit: s.unit, basis: s.basis,
        direction: s.direction, category: s.category, source_tier: 1,
        source_org: 'OECD', source_dataset: s.source_dataset,
        source_url: `${BASE}/data/${s.flow}/${s.key}`,
        source_id: s.source_dataset?.includes('source scout') ? 'scout_registry' : 'oecd_gov',
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
