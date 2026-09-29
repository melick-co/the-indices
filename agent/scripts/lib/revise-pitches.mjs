/**
 * Revise active pitches when underlying metrics move.
 * Used after a hot-source refresh and on the overnight follow-up pass.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ACTIVE_STATES = ['pitched', 'approved', 'candidate', 'watchlist'];
const BATCH_SIZE = 6;

const __dir = dirname(fileURLToPath(import.meta.url));

function pitchMetrics(p) {
  return [...new Set([...(p.metric_ids ?? []), ...(p.resurface_metrics ?? [])])];
}

function overlaps(changedSet, pitch) {
  const linked = pitchMetrics(pitch);
  if (!linked.length) return false;
  return linked.some((m) => changedSet.has(m));
}

async function snapshotMetrics(db, metricIds) {
  const out = {};
  for (const mid of metricIds) {
    const { data: meta } = await db.from('metrics')
      .select('metric_id, name, unit, period, source_org, source_tier')
      .eq('metric_id', mid).maybeSingle();
    const { data: obs } = await db.from('observations')
      .select('entity, period, value, status, created_at')
      .eq('metric_id', mid)
      .order('period', { ascending: false })
      .limit(5);
    out[mid] = { meta: meta ?? { metric_id: mid }, latest: obs ?? [] };
  }
  return out;
}

function buildRevisePrompt(charter, pitches, snapshots) {
  return `You are revising data-journalism pitch briefs after fresh observations landed.
Apply the editorial charter. Update copy only where numbers, rankings, or the "why now"
hook would be wrong or stale. Preserve voice and detector logic.

<charter>
${charter}
</charter>

<metric_snapshots>
${JSON.stringify(snapshots)}
</metric_snapshots>

<pitches_to_revise>
${JSON.stringify(pitches.map((p) => ({
  id: p.id,
  state: p.state,
  detector: p.detector,
  headline: p.headline,
  hook: p.hook,
  mechanism: p.mechanism,
  caveat: p.caveat,
  chart_hint: p.chart_hint,
  metric_ids: p.metric_ids,
  trigger_rows: p.trigger_rows,
})))}
</pitches_to_revise>

For each pitch return:
- revised: true if headline/hook/mechanism/caveat/chart_hint changed materially; false if already accurate
- when revised is true: headline, hook, mechanism, caveat, chart_hint (full set)
- when revised is false: omit those five fields
- revision_note: one line on what moved (or "unchanged")

Respond ONLY with valid JSON, no markdown:
{"revisions":[{"id":"...","revised":true,"headline":"...","hook":"...","mechanism":"...","caveat":"...","chart_hint":"...","revision_note":"..."},{"id":"...","revised":false,"revision_note":"unchanged"}]}`;
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.stop_reason === 'max_tokens') throw new TruncatedError();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

class TruncatedError extends Error {
  constructor() { super('response hit max_tokens'); }
}

/** Revise one batch; if the reply is cut off, split the batch and try each half. */
async function reviseBatch(db, charter, batch) {
  const metricIds = [...new Set(batch.flatMap(pitchMetrics))];
  const snapshots = await snapshotMetrics(db, metricIds);
  try {
    const verdict = await callClaude(buildRevisePrompt(charter, batch, snapshots));
    return verdict.revisions ?? [];
  } catch (e) {
    if (!(e instanceof TruncatedError) || batch.length < 2) throw e;
    const mid = Math.ceil(batch.length / 2);
    return [
      ...(await reviseBatch(db, charter, batch.slice(0, mid))),
      ...(await reviseBatch(db, charter, batch.slice(mid))),
    ];
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ changedMetrics?: string[], forceAll?: boolean, onProgress?: (msg: string) => void }} opts
 */
export async function revisePitches(db, opts = {}) {
  const { changedMetrics = [], forceAll = false, onProgress = (m) => console.log(m) } = opts;
  const changedSet = new Set(changedMetrics);
  const charter = readFileSync(join(__dir, '../../EDITORIAL.md'), 'utf8');

  const { data: allActive } = await db.from('pitches').select('*').in('state', ACTIVE_STATES);
  const toRevise = (allActive ?? []).filter((p) => {
    if (!pitchMetrics(p).length) return false;
    if (forceAll) return true;
    if (!changedSet.size) return false;
    return overlaps(changedSet, p);
  });

  if (!toRevise.length) {
    onProgress('No active pitches linked to changed metrics.');
    return { revised: 0, failed: 0, skipped: allActive?.length ?? 0, details: [] };
  }

  onProgress(`Revising ${toRevise.length} pitch(es)…`);
  const now = new Date().toISOString();
  const details = [];
  let revised = 0;
  let failed = 0;

  for (let i = 0; i < toRevise.length; i += BATCH_SIZE) {
    const batch = toRevise.slice(i, i + BATCH_SIZE);
    let revisions;
    try {
      revisions = await reviseBatch(db, charter, batch);
    } catch (e) {
      // One bad batch should not throw away the rest of the night's revisions.
      failed += batch.length;
      onProgress(`  Batch of ${batch.length} failed: ${e.message}`);
      continue;
    }

    for (const r of revisions) {
      const pitch = batch.find((p) => p.id === r.id);
      if (!pitch) continue;
      if (!r.revised || !r.headline) {
        await db.from('pitches').update({ last_evaluated: now }).eq('id', r.id);
        details.push({ id: r.id, headline: pitch.headline, revised: false, note: r.revision_note });
        continue;
      }
      await db.from('pitches').update({
        headline: r.headline,
        hook: r.hook,
        mechanism: r.mechanism,
        caveat: r.caveat,
        chart_hint: r.chart_hint,
        last_evaluated: now,
        updated_at: now,
      }).eq('id', r.id);
      revised++;
      details.push({ id: r.id, headline: r.headline, revised: true, note: r.revision_note });
      onProgress(`  Revised: ${r.headline.slice(0, 72)}… (${r.revision_note})`);
    }
  }

  return { revised, failed, skipped: (allActive?.length ?? 0) - toRevise.length, details };
}

/**
 * After overnight source load: revise every active pitch that tracks any metric,
 * using fresh snapshots even when no new period was inserted (ASX moves intraday).
 */
export async function followActivePitches(db, changedMetrics, onProgress) {
  const { data: active } = await db.from('pitches')
    .select('metric_ids, resurface_metrics')
    .in('state', ACTIVE_STATES);
  const tracked = new Set();
  for (const p of active ?? []) {
    for (const m of pitchMetrics(p)) tracked.add(m);
  }
  const overlap = changedMetrics.filter((m) => tracked.has(m));
  if (!overlap.length && !changedMetrics.length) {
    onProgress('No tracked metrics changed overnight.');
    return { revised: 0, failed: 0, skipped: 0, details: [] };
  }
  return revisePitches(db, {
    changedMetrics: overlap.length ? overlap : changedMetrics,
    forceAll: false,
    onProgress,
  });
}
