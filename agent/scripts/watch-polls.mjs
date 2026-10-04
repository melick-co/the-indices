/**
 * Load published federal polls into `polls` (see agent/supabase/37_polls.sql).
 *
 *   node scripts/watch-polls.mjs --dry-run   parse and print, write nothing (no database needed)
 *   node scripts/watch-polls.mjs             upsert, and drop polls the compilation no longer lists
 */
import { loadPolls, POLL_PAGE } from './lib/wiki-polls.mjs';

const dry = process.argv.includes('--dry-run');
const { revid, polls, rejected } = await loadPolls();

const rows = [];
for (const p of polls) {
  const poll_key = `${p.field_end}|${p.pollster}|${p.table}`;
  for (const [measure, value] of Object.entries(p.values)) {
    rows.push({
      poll_key, measure, value, field_start: p.field_start, field_end: p.field_end, pollster: p.pollster,
      client: p.client, mode: p.mode, sample_size: p.sample_size, source_url: p.source_url, wiki_revision: revid,
    });
  }
}
// Two rows for the same poll and measure would make the upsert ambiguous: keep neither and report it.
const counts = new Map();
for (const r of rows) counts.set(`${r.poll_key}|${r.measure}`, (counts.get(`${r.poll_key}|${r.measure}`) ?? 0) + 1);
const clean = rows.filter((r) => counts.get(`${r.poll_key}|${r.measure}`) === 1);
for (const [k, n] of counts) if (n > 1) rejected.push({ poll: k, reason: `${n} rows for one poll and measure` });

const byTable = (t) => polls.filter((p) => p.table === t).length;
console.log(`Wikipedia ${POLL_PAGE} revision ${revid}: ${byTable('vi')} voting-intention polls, ${byTable('dir')} direction polls, ${clean.length} figures.`);
const pollsters = [...new Set(polls.map((p) => p.pollster))].sort();
console.log(`Pollsters: ${pollsters.join(', ')}`);
const latest = [...polls].filter((p) => p.values.tpp_alp_lnp != null).sort((a, b) => b.field_end.localeCompare(a.field_end)).slice(0, 8);
for (const p of latest) {
  console.log(`  ${p.field_end} ${p.pollster.padEnd(22)} 2PP ALP ${p.values.tpp_alp_lnp} · primaries ${['alp', 'lnp', 'grn', 'onp', 'oth'].map((k) => p.values[`primary_${k}`] ?? '–').join('/')} · ${p.source_url.slice(0, 80)}`);
}
if (rejected.length) {
  console.log(`Rejected ${rejected.length}:`);
  for (const r of rejected) console.log(`  ${r.poll}: ${r.reason}`);
}

if (!dry) {
  const { createDb } = await import('./lib/obs-loader.mjs');
  const db = createDb();
  const { count: before } = await db.from('polls').select('*', { count: 'exact', head: true });
  for (let i = 0; i < clean.length; i += 500) {
    const { error } = await db.from('polls').upsert(clean.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'poll_key,measure' });
    if (error) throw new Error(`polls upsert: ${error.message}`);
  }
  // Polls the compilation has removed (corrected or withdrawn) go too, unless the parse looks broken.
  const keys = new Set(clean.map((r) => `${r.poll_key}|${r.measure}`));
  const { data: existing } = await db.from('polls').select('poll_key, measure');
  const gone = (existing ?? []).filter((r) => !keys.has(`${r.poll_key}|${r.measure}`));
  if (gone.length && clean.length >= 0.8 * (before ?? 0)) {
    for (const g of gone) await db.from('polls').delete().eq('poll_key', g.poll_key).eq('measure', g.measure);
    console.log(`Removed ${gone.length} figures no longer listed.`);
  } else if (gone.length) {
    console.log(`${gone.length} stored figures are no longer listed, but this parse found far fewer than before; nothing removed.`);
  }
  console.log(`Stored ${clean.length} figures (${before ?? 0} before).`);
}
