/**
 * Load every CPI item into cpi_items / cpi_observations / cpi_weights (agent/supabase/36_cpi_components.sql).
 *
 *   node scripts/load-cpi-components.mjs          # only when the ABS has a newer CPI than the store (last 13 periods)
 *   node scripts/load-cpi-components.mjs --full   # the whole history
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { fileURLToPath } from 'node:url';
import { absFetch } from './watch-abs.mjs';
import { createDb } from './lib/obs-loader.mjs';

const REGIONS = { 50: 'AUS', 1: 'SYD', 2: 'MEL', 3: 'BNE', 4: 'ADL', 5: 'PER', 6: 'HOB', 7: 'DRW', 8: 'CBR' };
const MEASURES = { 1: 'index_value', 2: 'change_period', 3: 'change_annual', 6: 'contribution_period_pts', 7: 'contribution_annual_pts' };
const ADJUSTMENT = { 10: 'original', 20: 'seasonally_adjusted' };
const CHUNK = 1000;

/** SDMX-JSON series → { dims: { MEASURE: '1', … }, obs: [{ period, value }] }. */
function seriesOf(json) {
  const root = json?.data ?? json;
  const st = root?.structures?.[0];
  const dims = st?.dimensions?.series ?? [];
  const times = st?.dimensions?.observation?.[0]?.values ?? [];
  const out = [];
  for (const [key, s] of Object.entries(root?.dataSets?.[0]?.series ?? {})) {
    const idx = key.split(':').map(Number);
    const d = Object.fromEntries(dims.map((dim, i) => [dim.id, dim.values[idx[i]]?.id]));
    const obs = Object.entries(s.observations ?? {})
      .map(([t, v]) => ({ period: times[Number(t)]?.id, value: v?.[0] }))
      .filter((o) => o.period && o.value != null && Number.isFinite(Number(o.value)));
    out.push({ dims: d, obs });
  }
  return out;
}

async function upsertChunks(db, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function loadItems(db) {
  const json = await absFetch('/codelist/ABS/CL_CPI_INDEX?format=jsondata', 'application/vnd.sdmx.structure+json');
  const codes = json?.data?.codelists?.[0]?.codes ?? [];
  const byId = new Map(codes.map((c) => [String(c.id), c]));
  const chain = (c) => {
    const path = [];
    for (let cur = c; cur && path.length < 10; cur = cur.parent ? byId.get(String(cur.parent)) : null) path.push(String(cur.id));
    return path;
  };
  const rows = codes.map((c) => {
    const path = chain(c);
    const order = c.annotations?.find((a) => a.type === 'ORDER')?.text;
    return {
      index_code: String(c.id),
      name: c.name,
      description: c.description ?? null,
      parent_code: c.parent && byId.has(String(c.parent)) ? String(c.parent) : null,
      level: path.length - 1,
      series_type: path[path.length - 1] === '10001' ? 'main' : 'analytical',
      sort_order: order != null ? Number(order) : null,
      updated_at: new Date().toISOString(),
    };
  });
  await upsertChunks(db, 'cpi_items', rows, 'index_code');
  return new Set(rows.map((r) => r.index_code));
}

async function loadObservations(db, items, lastN) {
  let total = 0;
  for (const freq of ['M', 'Q']) {
    for (const regions of ['50', '1+2+3+4+5+6+7+8']) {
      const path = `/data/ABS,CPI/${Object.keys(MEASURES).join('+')}..10+20.${regions}.${freq}?format=jsondata${lastN ? `&lastNObservations=${lastN}` : ''}`;
      let json;
      try { json = await absFetch(path); } catch (e) {
        if (/404/.test(String(e))) continue; // no series for this combination
        throw e;
      }
      const rows = new Map();
      for (const s of seriesOf(json)) {
        const code = s.dims.INDEX;
        const column = MEASURES[s.dims.MEASURE];
        const entity = REGIONS[s.dims.REGION];
        const adjustment = ADJUSTMENT[s.dims.TSEST];
        if (!items.has(code) || !column || !entity || !adjustment) continue;
        for (const o of s.obs) {
          const key = `${code}|${entity}|${adjustment}|${freq}|${o.period}`;
          let row = rows.get(key);
          if (!row) {
            row = {
              index_code: code, entity, adjustment, frequency: freq, period: o.period,
              index_value: null, change_period: null, change_annual: null,
              contribution_period_pts: null, contribution_annual_pts: null,
              updated_at: new Date().toISOString(),
            };
            rows.set(key, row);
          }
          row[column] = Number(o.value);
        }
      }
      await upsertChunks(db, 'cpi_observations', [...rows.values()], 'index_code,entity,adjustment,frequency,period');
      total += rows.size;
      console.log(`  ${freq} ${regions === '50' ? 'Australia' : 'capitals'}: ${rows.size} rows`);
    }
  }
  return total;
}

async function loadWeights(db, items) {
  const json = await absFetch('/data/ABS,CPI_WEIGHTS/1...?format=jsondata');
  const rows = [];
  for (const s of seriesOf(json)) {
    const entity = REGIONS[s.dims.REGION];
    if (!items.has(s.dims.INDEX) || !entity) continue;
    for (const o of s.obs) rows.push({ index_code: s.dims.INDEX, entity, period: o.period, weight_pct: Number(o.value), updated_at: new Date().toISOString() });
  }
  await upsertChunks(db, 'cpi_weights', rows, 'index_code,entity,period');
  return rows.length;
}

/** The newest All groups period the ABS has and the store has, for each frequency. */
async function behind(db) {
  for (const freq of ['M', 'Q']) {
    const json = await absFetch(`/data/ABS,CPI/1.10001.10.50.${freq}?lastNObservations=1&format=jsondata`);
    const latest = seriesOf(json)[0]?.obs?.at(-1)?.period;
    const { data } = await db.from('cpi_observations').select('period')
      .eq('index_code', '10001').eq('entity', 'AUS').eq('adjustment', 'original').eq('frequency', freq)
      .order('period', { ascending: false }).limit(1);
    if (latest && latest !== data?.[0]?.period) return `${freq} ${data?.[0]?.period ?? 'none'} → ${latest}`;
  }
  return null;
}

export async function loadCpiComponents(db = createDb(), { full = false } = {}) {
  const { count } = await db.from('cpi_observations').select('index_code', { count: 'exact', head: true });
  const empty = !count;
  if (!full && !empty) {
    const gap = await behind(db);
    if (!gap) {
      console.log('CPI components: up to date.');
      return { rows: 0 };
    }
    console.log(`CPI components: new release (${gap}).`);
  }
  const items = await loadItems(db);
  console.log(`CPI components: ${items.size} items.`);
  const rows = await loadObservations(db, items, full || empty ? 0 : 13);
  const weights = await loadWeights(db, items);
  console.log(`CPI components: ${rows} readings and ${weights} weights upserted.`);
  return { rows, weights };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadCpiComponents(createDb(), { full: process.argv.includes('--full') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
