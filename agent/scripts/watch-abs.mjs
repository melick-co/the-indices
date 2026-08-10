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
  const root = json?.data ?? json;
  const ds = root?.dataSets?.[0];
  const struct = root?.structures?.[0] ?? json?.structure;
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
  const root = json?.data ?? json;
  const ds = root?.dataSets?.[0];
  const struct = root?.structures?.[0] ?? json?.structure;
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

/** List actual dataKeys whose dimension labels contain all given terms. */
async function keys(id, ...terms) {
  const json = await absFetch(`/data/ABS,${id}/all?lastNObservations=1&format=jsondata`);
  const root = json?.data ?? json;
  const st = root?.structures?.[0]?.dimensions?.series ?? [];
  const series = root?.dataSets?.[0]?.series ?? {};
  const want = terms.map((t) => t.toLowerCase());
  let n = 0;
  for (const k of Object.keys(series)) {
    const p = k.split(':').map(Number);
    const labels = p.map((v, i) => st[i]?.values?.[v]?.name ?? '?');
    const hay = labels.join(' | ').toLowerCase();
    if (want.every((w) => hay.includes(w))) {
      const codes = p.map((v, i) => st[i]?.values?.[v]?.id ?? '?');
      console.log(`${codes.join('.').padEnd(26)} ${labels.join(' | ')}`);
      if (++n >= 30) break;
    }
  }
  if (!n) console.log('No series matched those terms. Try fewer or different words.');
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

      // derived series (e.g. annual change computed from an index)
      if (s.derive && obs.length > s.derive.lag) {
        const d = s.derive;
        await db.from('metrics').upsert({
          metric_id: d.metric_id, name: d.name, unit: d.unit, basis: d.basis,
          direction: d.direction, category: d.category, source_tier: 1,
          source_org: 'ABS', source_dataset: `${s.dataflow} (derived)`,
          source_url: `https://data.api.abs.gov.au/rest/data/ABS,${s.dataflow}/${s.dataKey}`,
          source_published: new Date().toISOString().slice(0, 10),
          period: `${obs[d.lag].period}\u2013${obs[obs.length - 1].period}`,
        });
        const derived = [];
        for (let i = d.lag; i < obs.length; i++) {
          const prior = obs[i - d.lag].value;
          if (!prior) continue;
          derived.push({ metric_id: d.metric_id, entity: 'AUS', period: obs[i].period,
            value: Number(((obs[i].value / prior - 1) * 100).toFixed(2)), status: 'derived' });
        }
        if (derived.length) {
          const { error: de } = await db.from('observations')
            .upsert(derived, { onConflict: 'metric_id,entity,period' });
          if (de) throw de;
          console.log(`${d.metric_id}: ${derived.length} derived from ${s.metric_id}` +
            ` (latest ${derived[derived.length - 1].period} = ${derived[derived.length - 1].value}%)`);
        }
      }

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
  keys: () => keys(a, ...process.argv.slice(4)),
  load,
}[cmd];

if (!run) {
  console.log(`Usage:
  node scripts/watch-abs.mjs discover <term>         find dataflow ids
  node scripts/watch-abs.mjs structure <dataflowId>  list dimensions + codes
  node scripts/watch-abs.mjs keys <dataflowId> <term...>  list real dataKeys matching labels
  node scripts/watch-abs.mjs peek <dataflowId> <key> preview, no writes
  node scripts/watch-abs.mjs load                    fetch all configured series`);
  process.exit(0);
}
run().catch((e) => { console.error(e.message); process.exit(1); });
