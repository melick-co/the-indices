#!/usr/bin/env node
/**
 * Repair pitch metric links: map known aliases to real metric_ids and move
 * ids with no series in the store to trigger_rows.unlinked_metrics.
 *
 *   node scripts/fix-metric-links.mjs          # dry run: report only
 *   node scripts/fix-metric-links.mjs --apply  # write the changes
 */
import { createClient } from '@supabase/supabase-js';
import './lib/load-env.mjs';
import { METRIC_ALIASES, loadKnownMetrics, normaliseMetricIds, withUnlinked } from './lib/metric-ids.mjs';

const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

async function main() {
  const known = await loadKnownMetrics(db);
  const { data: pitches, error } = await db.from('pitches')
    .select('id, state, headline, metric_ids, resurface_metrics, trigger_rows');
  if (error) throw new Error(error.message);

  const unlinkedCount = new Map();
  const remapped = new Map();
  let changed = 0;

  for (const p of pitches ?? []) {
    const links = normaliseMetricIds(p.metric_ids, known);
    const resurface = normaliseMetricIds(p.resurface_metrics, known);
    const unlinked = [...new Set([...links.unlinked, ...resurface.unlinked])];
    const resurfaceNext = p.resurface_metrics == null ? null : resurface.linked;
    if (same(links.linked, p.metric_ids) && same(resurfaceNext, p.resurface_metrics) && !unlinked.length) continue;

    changed++;
    for (const id of unlinked) unlinkedCount.set(id, (unlinkedCount.get(id) ?? 0) + 1);
    for (const id of [...(p.metric_ids ?? []), ...(p.resurface_metrics ?? [])]) {
      if (known.has(METRIC_ALIASES[id])) remapped.set(`${id} -> ${METRIC_ALIASES[id]}`, (remapped.get(`${id} -> ${METRIC_ALIASES[id]}`) ?? 0) + 1);
    }
    console.log(`${p.state.padEnd(9)} ${String(p.headline ?? '').slice(0, 60)}`);
    console.log(`          metric_ids ${JSON.stringify(p.metric_ids ?? [])} -> ${JSON.stringify(links.linked)}`);
    if (unlinked.length) console.log(`          unlinked   ${JSON.stringify(unlinked)}`);

    if (apply) {
      const { error: upErr } = await db.from('pitches').update({
        metric_ids: links.linked,
        resurface_metrics: resurfaceNext,
        trigger_rows: withUnlinked(p.trigger_rows, unlinked),
      }).eq('id', p.id);
      if (upErr) throw new Error(`update ${p.id}: ${upErr.message}`);
    }
  }

  console.log(`\n${changed} of ${pitches?.length ?? 0} pitch(es) ${apply ? 'updated' : 'would change'}.`);
  console.log('Aliases applied:', Object.fromEntries(remapped));
  console.log('Unlinked (no series in store), by pitch count:');
  for (const [id, n] of [...unlinkedCount].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${id}`);
  if (!apply) console.log('\nDry run. Re-run with --apply to write.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
