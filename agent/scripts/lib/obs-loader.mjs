import { createClient } from '@supabase/supabase-js';
import './load-env.mjs';

export function createDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to agent/.env (see .env.example).',
    );
  }
  return createClient(url, key,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Upsert metric metadata + observation rows (single or multi-entity).
 * @returns {{ fresh: number, total: number }}
 */
export async function upsertSeries(db, meta, rows) {
  if (!rows.length) return { fresh: 0, total: 0 };

  const periods = [...new Set(rows.map((r) => r.period))].sort();
  await db.from('metrics').upsert({
    metric_id: meta.metric_id,
    name: meta.name,
    unit: meta.unit,
    basis: meta.basis,
    direction: meta.direction,
    category: meta.category,
    source_tier: meta.source_tier ?? 1,
    source_org: meta.source_org,
    source_dataset: meta.source_dataset ?? null,
    source_url: meta.source_url ?? null,
    source_published: new Date().toISOString().slice(0, 10),
    period: `${periods[0]}–${periods[periods.length - 1]}`,
  });

  const metricId = meta.metric_id;
  const { data: existing } = await db.from('observations')
    .select('entity, period')
    .eq('metric_id', metricId);
  const known = new Set((existing ?? []).map((r) => `${r.entity}:${r.period}`));
  const fresh = rows.filter((r) => !known.has(`${r.entity}:${r.period}`)).length;

  const { error } = await db.from('observations')
    .upsert(rows, { onConflict: 'metric_id,entity,period' });
  if (error) throw error;

  if (meta.source_id && fresh) {
    await db.from('data_sources').update({
      last_checked: new Date().toISOString(),
      last_changed: new Date().toISOString(),
    }).eq('source_id', meta.source_id);
  } else if (meta.source_id) {
    await db.from('data_sources').update({
      last_checked: new Date().toISOString(),
    }).eq('source_id', meta.source_id);
  }

  return { fresh, total: rows.length };
}

export async function loadEntityCodes(db) {
  const { data } = await db.from('entities').select('code');
  return (data ?? []).map((r) => r.code);
}
