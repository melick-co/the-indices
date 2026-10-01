/**
 * Revise active pitches when underlying metrics move.
 * Used after a hot-source refresh and on the overnight follow-up pass.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { callClaudeJson, splitOnTruncation } from './claude.mjs';

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

const HOME = 'AUS';
const COPY_FIELDS = ['headline', 'hook', 'mechanism', 'caveat', 'chart_hint'];
const HISTORY = 4;

/**
 * One reference block per run, shared by every batch so all pitches cite the same figures.
 * For each metric: Australia's latest reading, a short history, and for cross-country
 * series the full table at that period with Australia's rank already computed.
 * Metrics with no observations are marked missing rather than sent empty.
 */
export async function buildReference(db, metricIds) {
  const out = {};
  for (const mid of metricIds) {
    const { data: meta } = await db.from('metrics')
      .select('metric_id, name, unit, source_org, source_tier, direction')
      .eq('metric_id', mid).maybeSingle();
    const { data: home } = await db.from('observations')
      .select('period, value, status')
      .eq('metric_id', mid).eq('entity', HOME)
      .order('period', { ascending: false })
      .limit(HISTORY);
    if (!meta || !home?.length) {
      out[mid] = { missing: true, note: 'No Australian observations in the database. Do not cite a figure for this.' };
      continue;
    }
    const [latest, ...history] = home;
    const entry = {
      name: meta.name,
      unit: meta.unit,
      source: meta.source_org,
      tier: meta.source_tier,
      latest: { period: latest.period, value: latest.value, status: latest.status },
      earlier: history.map((h) => ({ period: h.period, value: h.value })),
    };
    const { data: peers } = await db.from('observations')
      .select('entity, value')
      .eq('metric_id', mid).eq('period', latest.period);
    if ((peers?.length ?? 0) > 1) {
      entry.ranking = rankEntities(peers, latest.period);
    }
    out[mid] = entry;
  }
  return out;
}

/** Highest value first; Australia's position is computed here, never by the model. */
export function rankEntities(rows, period) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const pos = sorted.findIndex((r) => r.entity === HOME) + 1;
  return {
    period,
    order: 'highest first',
    aus_rank: pos || null,
    of: sorted.length,
    top: sorted.slice(0, Math.max(5, pos)).map((r, i) => `${i + 1}. ${r.entity} ${r.value}`),
  };
}

// Numbers a revision may use without coming from the reference or the pitch itself.
const YEAR = (n) => Number.isInteger(n) && n >= 1900 && n <= 2100;

// Words that introduce an identifier rather than a figure: "ABS 6345.0", "cat. no. 5206.0", "Table D2".
const IDENT_BEFORE = /(?:\bABS|\bcat(?:alogue)?\.?(?:\s*no\.?)?|\btable|\bseries(?:\s*id)?)\s*$/i;

export function numbersIn(text) {
  const out = [];
  const src = String(text ?? '');
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|pp|per ?cent|bps?|basis points)?/gi;
  for (const m of src.matchAll(re)) {
    const n = Number((m[1] + (m[2] ?? '')).replace(/,/g, ''));
    const unit = m[3];
    const before = src.slice(Math.max(0, m.index - 16), m.index);
    // Digits inside a code are not figures: "A2325846C", "Q2", "D2".
    if (/[A-Za-z]$/.test(before)) continue;
    if (!unit && IDENT_BEFORE.test(before)) continue;
    // ABS catalogue numbers are written "6345.0".
    if (!unit && /^\d{4}$/.test(m[1]) && m[2] === '.0' && !/\$\s*$/.test(before)) continue;
    // Small bare integers are counts ("three hikes", "5 suburbs"); years are dates.
    if (!unit && Number.isInteger(n) && n <= 12) continue;
    if (YEAR(n) && !unit) continue;
    out.push(n);
  }
  return out;
}

/** Every number in the source material, plus thousand/million/billion rescalings. */
export function allowedNumbers(...sources) {
  const set = [];
  for (const src of sources) {
    for (const n of numbersIn(typeof src === 'string' ? src : JSON.stringify(src ?? ''))) {
      set.push(n, n / 1e3, n / 1e6, n / 1e9, n * 100);
    }
  }
  return set;
}

function supported(n, allowed) {
  return allowed.some((a) => Math.abs(a - n) < 0.051 || Math.round(a) === n);
}

/** Figures in the revised copy that appear in neither the reference nor the original pitch. */
export function unsupportedFigures(revision, allowed) {
  const text = COPY_FIELDS.map((f) => revision[f] ?? '').join(' ');
  return [...new Set(numbersIn(text).filter((n) => !supported(n, allowed)))];
}

function buildRevisePrompt(charter, pitches, reference) {
  return `You are revising data-journalism pitch briefs after fresh observations landed.
Apply the editorial charter. Update copy only where numbers, rankings, or the "why now"
hook would be wrong or stale. Preserve voice and detector logic.

<charter>
${charter}
</charter>

<reference>
${JSON.stringify(reference)}
</reference>

Rules for figures:
- <reference> is the only source of current numbers. "latest" is the current Australian reading;
  "earlier" is history for context and must not be presented as current.
- For rankings, use ranking.aus_rank and ranking.top exactly. Do not re-rank.
- Every pitch must cite the same value, period and source for the same metric.
- Do not introduce any number that is not in <reference> or already in that pitch's own fields.
  No estimates, no new derived figures (gaps, differences, totals) unless already in the pitch.
- If a metric is marked missing and the pitch leans on it, remove or soften that figure and
  say so in revision_note. Never fill it in.

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


/** Revise one batch; if the reply is cut off, split the batch and try each half. */
function reviseBatch(charter, batch, reference) {
  return splitOnTruncation(batch, async (part) =>
    (await callClaudeJson(buildRevisePrompt(charter, part, reference), { label: 'pitch revision' })).revisions ?? []);
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
    return { revised: 0, rejected: 0, failed: 0, skipped: allActive?.length ?? 0, details: [] };
  }

  onProgress(`Revising ${toRevise.length} pitch(es)…`);
  const reference = await buildReference(db, [...new Set(toRevise.flatMap(pitchMetrics))]);
  const missing = Object.keys(reference).filter((m) => reference[m].missing);
  if (missing.length) onProgress(`  Metrics with no Australian data: ${missing.join(', ')}`);
  const refNumbers = allowedNumbers(reference);

  const now = new Date().toISOString();
  const details = [];
  let revised = 0;
  let failed = 0;
  let rejected = 0;

  for (let i = 0; i < toRevise.length; i += BATCH_SIZE) {
    const batch = toRevise.slice(i, i + BATCH_SIZE);
    let revisions;
    try {
      revisions = await reviseBatch(charter, batch, reference);
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
      const allowed = refNumbers.concat(allowedNumbers(...COPY_FIELDS.map((f) => pitch[f]), pitch.trigger_rows));
      const unsupported = unsupportedFigures(r, allowed);
      if (unsupported.length) {
        // Keep the current copy rather than publish figures nobody can source.
        await db.from('pitches').update({ last_evaluated: now }).eq('id', r.id);
        rejected++;
        details.push({ id: r.id, headline: pitch.headline, revised: false, rejected: unsupported, note: r.revision_note });
        onProgress(`  Rejected: ${pitch.headline.slice(0, 60)}… (unsourced figures: ${unsupported.join(', ')})`);
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

  return { revised, rejected, failed, skipped: (allActive?.length ?? 0) - toRevise.length, details };
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
    return { revised: 0, rejected: 0, failed: 0, skipped: 0, details: [] };
  }
  return revisePitches(db, {
    changedMetrics: overlap.length ? overlap : changedMetrics,
    forceAll: false,
    onProgress,
  });
}
