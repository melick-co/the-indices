/**
 * ABS SDMX watcher.
 *
 * Fetches configured series from the ABS Data API and upserts them into
 * `observations`, so the detectors gain real Australian history.
 *
 * Commands:
 *   discover <term>          list dataflows whose id/name matches <term>
 *   structure <dataflowId>   list the dimensions and codes (to build a dataKey)
 *   peek <dataflowId> <key>  fetch and print a few observations, no writes
 *   load                     fetch every configured series and upsert
 *
 * Env for `load`: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Notes learned the hard way:
 *  - Base URL changed Nov 2024 to https://data.api.abs.gov.au/rest/
 *  - A User-Agent header is REQUIRED or the API returns 403
 *  - Omit the version from the dataflow id to always get the latest
 */
import { ABS_SERIES } from './abs-config.mjs';

const BASE = 'https://data.api.abs.gov.au/rest';
const UA = 'caveat-indices/0.1 (+https://caveat.news)';

async function absFetch(path, accept = 'application/vnd.sdmx.data+json') {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, accept },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`ABS ${res.status} ${res.statusText} for ${path}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** SDMX-JSON -> [{ period, value }]. Handles the series form (time at observation). */
function parseSdmxJson(json) {
  const ds = json?.dataSets?.[0];
  const struct = json?.structure ?? json?.data?.structures?.[0];
  if (!ds || !struct) return [];
  const timeValues = (struct.dimensions?.observation ?? [])
    .find((d) => d.id === 'TIME_PERIOD' || d.role === 'time')?.values ?? [];

  const out = [];
  if (ds.series) {
    // take the first series key present; callers should narrow with dataKey
    const firstKey = Object.keys(ds.series)[0];
    const obs = ds.series[firstKey]?.observations ?? {};
    for (const [idx, arr] of Object.entries(obs)) {
      const period = timeValues[Number(idx)]?.id ?? timeValues[Number(idx)]?.name;
      const value = Array.isArray(arr) ? arr[0] : arr;
      if (period != null && value != null) out.push({ period: String(period), value: Number(value) });
    }
  } else if (ds.observations) {
    for (const [key, arr] of Object.entries(ds.observations)) {
      const idx = Number(String(key).split(':').pop());
      const period = timeValues[idx]?.id;
      const value = Array.isArray(arr) ? arr[0] : arr;
      if (period != null && value != null) out.push({ period: String(period), value: Number(value) });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/** Series keys available in a response, so you can see what a broad query returned. */
function seriesKeys(json) {
  const ds = json?.dataSets?.[0];
  const struct = json?.structure ?? json?.data?.structures?.[0];
  if (!ds?.series || !struct) return [];
  const dims = struct.dimensions?.series ?? [];
  return Object.keys(ds.series).slice(0, 25).map((k) => {
    const parts = k.split(':').map(Number);
    const label = parts.map((p, i) => dims[i]?.values?.[p]?.name ?? '?').join(' | ');
    return { key: k, label };
  });
}

async function discover(term) {
  const json = await absFetch('/dataflow/ABS?detail=allstubs&format=jsondata',
    'application/vnd.sdmx.structure+json');
  const flows = json?.data?.dataflows ?? json?.dataflows ?? [];
  const t = (term ?? '').toLowerCase();
  const hits = flows.filter((f) =>
    !t || f.id?.toLowerCase().includes(t) || f.name?.toLowerCase?.().includes(t));
  console.log(`${hits.length} dataflow(s) matching "${term ?? '(all)'}":\n`);
  for (const f of hits.slice(0, 60)) console.log(`  ${f.id.padEnd(22)} ${f.name ?? ''}`);
}

async function structure(id) {
  const json = await absFetch(`/datastructure/ABS/${id}?references=children&format=jsondata`,
    'application/vnd.sdmx.structure+json');
  const dsd = json?.data?.dataStructures?.[0];
  const dims = dsd?.dataStructureComponents?.dimensionList?.dimensions ?? [];
  const cls = json?.data?.codelists ?? [];
  console.log(`Dimensions for ${id} (dataKey order):\n`);
  dims.forEach((d, i) => {
    const clRef = d.localRepresentation?.enumeration?.split('=').pop();
    const cl = cls.find((c) => `${c.agencyID}:${c.id}(${c.version})` === clRef || c.id === clRef?.split(':')?.pop()?.split('(')[0]);
    console.log(`  ${i + 1}. ${d.id}`);
    (cl?.codes ?? []).slice(0, 12).forEach((c) => console.log(`       ${String(c.id).padEnd(10)} ${c.name}`));
    if ((cl?.codes ?? []).length > 12) console.log(`       ... ${cl.codes.length - 12} more`);
  });
  console.log('\nBuild a dataKey by joining codes with dots, in the order above.');
  console.log('Leave a position empty to wildcard it, e.g. 3..10.50.Q');
}

async function peek(id, key = 'all', lastN = 8) {
  const json = await absFetch(`/data/ABS,${id}/${key}?lastNObservations=${lastN}&format=jsondata`);
  const keys = seriesKeys(json);
  if (keys.length > 1) {
    console.log(`Response contains ${keys.length}+ series. First few:\n`);
    keys.forEach((k) => console.log(`  ${k.key.padEnd(16)} ${k.label}`));
    console.log('\nNarrow your dataKey to one series before loading.\n');
  }
  const obs = parseSdmxJson(json);
  console.log(`First series, last ${obs.length} observations:`);
  obs.forEach((o) => console.log(`  ${o.period}  ${o.value}`));
}

async function load() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  let totalNew = 0, changed = [];
  for (const s of ABS_SERIES) {
    try {
      const json = await absFetch(
        `/data/ABS,${s.dataflow}/${s.dataKey}?lastNObservations=${s.lastN}&format=jsondata`);
      const obs = parseSdmxJson(json);
      if (!obs.length) { console.log(`${s.metric_id}: no observations parsed — check dataKey`); continue; }

      await db.from('metrics').upsert({
        metric_id: s.metric_id, name: s.name, unit: s.unit, basis: s.basis,
        direction: s.direction, category: s.category, source_tier: 1, source_org: 'ABS',
        source_dataset: `${s.dataflow} (ABS Data API)`,
        source_url: `https://data.api.abs.gov.au/rest/data/ABS,${s.dataflow}/${s.dataKey}`,
        source_published: new Date().toISOString().slice(0, 10),
        period: `${obs[0].period}–${obs[obs.length - 1].period}`,
      });

      const rows = obs.map((o) => ({
        metric_id: s.metric_id, entity: 'AUS', period: o.period,
        value: o.value, status: 'published',
      }));
      // count genuinely new periods before upserting, for the change signal
      const { data: existing } = await db.from('observations')
        .select('period').eq('metric_id', s.metric_id).eq('entity', 'AUS');
      const known = new Set((existing ?? []).map((r) => r.period));
      const fresh = rows.filter((r) => !known.has(r.period));

      const { error } = await db.from('observations')
        .upsert(rows, { onConflict: 'metric_id,entity,period' });
      if (error) throw error;

      totalNew += fresh.length;
      if (fresh.length) changed.push(`${s.metric_id}+${fresh.length}`);
      console.log(`${s.metric_id}: ${rows.length} obs (${fresh.length} new), ` +
        `${obs[0].period} to ${obs[obs.length - 1].period}`);

      if (s.source_id) {
        await db.from('data_sources').update({
          last_checked: new Date().toISOString(),
          ...(fresh.length ? { last_changed: new Date().toISOString() } : {}),
        }).eq('source_id', s.source_id);
      }
    } catch (e) {
      console.error(`${s.metric_id}: ${e.message}`);
    }
  }
  console.log(`\nDone. ${totalNew} new observations${changed.length ? ': ' + changed.join(', ') : ''}.`);
  console.log(totalNew ? 'New periods will wake resurfacing pitches on the next daily run.' : '');
}

const [, , cmd, a, b] = process.argv;
const run = {
  discover: () => discover(a),
  structure: () => structure(a),
  peek: () => peek(a, b),
  load,
}[cmd];

if (!run) {
  console.log(`Usage:
  node scripts/watch-abs.mjs discover <term>         find dataflow ids
  node scripts/watch-abs.mjs structure <dataflowId>  list dimensions + codes
  node scripts/watch-abs.mjs peek <dataflowId> <key> preview, no writes
  node scripts/watch-abs.mjs load                    fetch all configured series`);
  process.exit(0);
}
run().catch((e) => { console.error(e.message); process.exit(1); });
