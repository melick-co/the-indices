/**
 * Daily trending-topics → Foundry pitch review.
 * Load latest RSS/X snapshots, match against the pitch bank, attach validated
 * findings or open a new candidate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

export const ACTIVE_MATCH_STATES = [
  'pitched', 'approved', 'candidate', 'watchlist', 'dormant', 'published',
];
export const MAX_NEW = 3;
export const MAX_ATTACH = 12;
export const TOPIC_CAPS = {
  'rss:au:1d': 10,
  'x:au:1d': 8,
  'x:global:1d': 5,
};

const WAKE_VERDICTS = new Set(['supports', 'updates', 'contradicts']);
const VERDICTS = new Set(['supports', 'updates', 'contradicts', 'pegs']);

export function slugTopic(topic) {
  return String(topic ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/-$/, '') || 'topic';
}

export function topicFingerprint(topic) {
  return `trending:${slugTopic(topic)}`;
}

export function findingKey(periodEnd, source, region, topic) {
  return `${periodEnd}|${source}|${region}|${slugTopic(topic)}`;
}

export function topicKeyOf(source, region, windowType, topic) {
  return `${source}:${region}:${windowType}:${slugTopic(topic)}`;
}

export function findingsOf(pitch) {
  const raw = pitch?.trigger_rows?.findings;
  return Array.isArray(raw) ? raw : [];
}

export function alreadyHasFinding(pitch, key) {
  return findingsOf(pitch).some((f) => f && f.key === key);
}

export function appendFinding(triggerRows, finding) {
  const base = (triggerRows && typeof triggerRows === 'object' && !Array.isArray(triggerRows))
    ? { ...triggerRows }
    : {};
  const current = Array.isArray(base.findings) ? base.findings : [];
  if (current.some((f) => f && f.key === finding.key)) return base;
  return { ...base, findings: [...current, finding] };
}

export function collectTopics(snapshots, caps = TOPIC_CAPS) {
  const seen = new Set();
  const out = [];
  for (const snap of snapshots ?? []) {
    if (!snap) continue;
    const capKey = `${snap.source}:${snap.region}:${snap.window_type}`;
    const cap = caps[capKey] ?? 0;
    if (!cap) continue;
    const topics = Array.isArray(snap.topics) ? snap.topics : [];
    let taken = 0;
    for (const t of topics) {
      if (taken >= cap) break;
      const label = typeof t?.topic === 'string' ? t.topic.trim() : '';
      if (!label) continue;
      const slug = slugTopic(label);
      if (seen.has(slug)) continue;
      seen.add(slug);
      taken += 1;
      out.push({
        topic_key: topicKeyOf(snap.source, snap.region, snap.window_type, label),
        topic: label,
        source: snap.source,
        region: snap.region,
        window_type: snap.window_type,
        period_end: snap.period_end,
        score: t.score ?? null,
        mention_count: t.mention_count ?? t.tweet_volume ?? null,
        summary: t.summary ?? null,
        sample_headlines: (t.sample_headlines ?? []).slice(0, 3),
      });
    }
  }
  return out;
}

function compactPitch(p) {
  return {
    id: p.id,
    state: p.state,
    detector: p.detector,
    headline: p.headline,
    hook: p.hook,
    mechanism: p.mechanism,
    caveat: p.caveat,
    chart_hint: p.chart_hint,
    metric_ids: p.metric_ids ?? [],
    finding_topics: findingsOf(p).map((f) => f.topic).filter(Boolean).slice(-6),
  };
}

function loadCharter() {
  return readFileSync(join(__dir, '../../EDITORIAL.md'), 'utf8');
}

function loadPrompt() {
  return readFileSync(join(__dir, '../../taste/trending-review-prompt.md'), 'utf8');
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
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function latestSnapshot(db, source, region, windowType) {
  const { data, error } = await db.from('trending_snapshots')
    .select('source, region, window_type, period_end, topics, item_count, computed_at')
    .eq('source', source)
    .eq('region', region)
    .eq('window_type', windowType)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadPitchBank(db) {
  const { data, error } = await db.from('pitches')
    .select('id, headline, hook, mechanism, caveat, chart_hint, detector, trigger_rows, metric_ids, state')
    .in('state', ACTIVE_MATCH_STATES)
    .order('last_evaluated', { ascending: false })
    .limit(80);
  if (error) throw error;
  return data ?? [];
}

export async function applyDecisions(db, { topics, pitches, decisions, onProgress = () => {} }) {
  const topicByKey = new Map(topics.map((t) => [t.topic_key, t]));
  const pitchById = new Map(pitches.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  const summary = {
    attached: 0,
    created: 0,
    ignored: 0,
    skipped: 0,
    details: [],
  };
  let newCount = 0;
  let attachCount = 0;

  for (const d of decisions ?? []) {
    const topic = topicByKey.get(d.topic_key);
    if (!topic) {
      summary.skipped += 1;
      continue;
    }

    if (d.action === 'ignore' || !d.action) {
      summary.ignored += 1;
      summary.details.push({ action: 'ignore', topic: topic.topic, reason: d.reason ?? '' });
      continue;
    }

    if (d.action === 'attach') {
      if (attachCount >= MAX_ATTACH || d.validated !== true || !VERDICTS.has(d.verdict)) {
        summary.skipped += 1;
        continue;
      }
      const pitch = pitchById.get(d.pitch_id);
      if (!pitch) {
        summary.skipped += 1;
        continue;
      }
      const key = findingKey(topic.period_end, topic.source, topic.region, topic.topic);
      if (alreadyHasFinding(pitch, key)) {
        summary.skipped += 1;
        continue;
      }
      const finding = {
        key,
        at: now,
        period_end: topic.period_end,
        source: topic.source,
        region: topic.region,
        topic: topic.topic,
        verdict: d.verdict,
        finding: String(d.finding ?? '').trim(),
        headlines: (topic.sample_headlines ?? []).slice(0, 3),
      };
      const trigger_rows = appendFinding(pitch.trigger_rows, finding);
      const patch = {
        trigger_rows,
        last_evaluated: now,
      };
      if (d.hook_update && pitch.state !== 'published') {
        patch.hook = String(d.hook_update).trim();
      }
      if (pitch.state === 'dormant' && WAKE_VERDICTS.has(d.verdict)) {
        patch.state = 'candidate';
        patch.state_changed = now;
        patch.resurface_on = `trending: ${topic.topic}`;
      }
      const { error } = await db.from('pitches').update(patch).eq('id', pitch.id);
      if (error) throw error;
      await db.from('pitch_events').insert({
        pitch_id: pitch.id,
        actor: 'agent',
        event: 'trending_finding',
        note: finding.finding || `${d.verdict}: ${topic.topic}`,
        changes: {
          topic: topic.topic,
          source: topic.source,
          verdict: d.verdict,
          period_end: topic.period_end,
          topic_key: topic.topic_key,
        },
      });
      pitch.trigger_rows = trigger_rows;
      if (patch.hook) pitch.hook = patch.hook;
      if (patch.state) pitch.state = patch.state;
      attachCount += 1;
      summary.attached += 1;
      summary.details.push({
        action: 'attach',
        pitch_id: pitch.id,
        headline: pitch.headline,
        topic: topic.topic,
        verdict: d.verdict,
      });
      onProgress(`  Attached ${d.verdict} → ${pitch.headline.slice(0, 64)}`);
      continue;
    }

    if (d.action === 'new_pitch') {
      if (newCount >= MAX_NEW || d.validated !== true) {
        summary.skipped += 1;
        continue;
      }
      const fingerprint = topicFingerprint(topic.topic);
      const { count } = await db.from('pitches')
        .select('*', { count: 'exact', head: true })
        .contains('trigger_rows', { fingerprint });
      if ((count ?? 0) > 0) {
        summary.skipped += 1;
        continue;
      }
      const headline = String(d.headline || topic.topic).trim();
      const finding = {
        key: findingKey(topic.period_end, topic.source, topic.region, topic.topic),
        at: now,
        period_end: topic.period_end,
        source: topic.source,
        region: topic.region,
        topic: topic.topic,
        verdict: 'pegs',
        finding: String(d.finding ?? d.hook ?? '').trim(),
        headlines: (topic.sample_headlines ?? []).slice(0, 3),
      };
      const { data: row, error } = await db.from('pitches').insert({
        headline,
        hook: d.hook ?? `${topic.topic} is on the daily trends list`,
        mechanism: d.mechanism ?? null,
        caveat: d.caveat ?? null,
        chart_hint: d.chart_hint ?? null,
        detector: 'trending_topic',
        trigger_rows: {
          fingerprint,
          topic: topic.topic,
          topic_key: topic.topic_key,
          source: topic.source,
          region: topic.region,
          period_end: topic.period_end,
          archetype: d.archetype ?? null,
          findings: [finding],
        },
        metric_ids: Array.isArray(d.metric_ids) ? d.metric_ids : [],
        state: 'candidate',
      }).select('id, headline').single();
      if (error) throw error;
      newCount += 1;
      summary.created += 1;
      summary.details.push({
        action: 'new_pitch',
        pitch_id: row.id,
        headline: row.headline,
        topic: topic.topic,
      });
      onProgress(`  New candidate: ${row.headline.slice(0, 72)}`);
    }
  }

  return summary;
}

export async function runTrendingReview(opts = {}) {
  const { createDb } = await import('./obs-loader.mjs');
  const db = opts.db ?? createDb();
  const log = [];
  const emit = (msg) => {
    log.push(msg);
    if (!opts.quiet) console.log(msg);
    opts.onProgress?.(msg);
  };

  emit('Loading trending snapshots and pitch bank…');
  const [rssDay, xAu, xGlobal, pitches] = await Promise.all([
    latestSnapshot(db, 'rss', 'au', '1d'),
    latestSnapshot(db, 'x', 'au', '1d'),
    latestSnapshot(db, 'x', 'global', '1d'),
    loadPitchBank(db),
  ]);

  const topics = collectTopics([rssDay, xAu, xGlobal]);
  const periodEnd = rssDay?.period_end ?? xAu?.period_end ?? xGlobal?.period_end ?? null;

  if (!topics.length) {
    emit('No trending topics to review.');
    const empty = { period_end: periodEnd, topics: 0, attached: 0, created: 0, ignored: 0, skipped: 0, details: [], log };
    await db.from('agent_runs').insert({
      quiet_day: true,
      notes: 'trending-review: ' + JSON.stringify({ period_end: periodEnd, topics: 0 }),
    });
    return empty;
  }

  emit(`Reviewing ${topics.length} topics against ${pitches.length} pitches (${periodEnd}).`);

  const prompt = loadPrompt()
    .replace('{EDITORIAL.md}', loadCharter())
    .replace('{period_end}', periodEnd ?? '')
    .replace('{JSON: pitches}', JSON.stringify(pitches.map(compactPitch)))
    .replace('{JSON: topics}', JSON.stringify(topics))
    .replace('{max_new}', String(MAX_NEW))
    .replace('{max_attach}', String(MAX_ATTACH));

  const verdict = await callClaude(prompt);
  const applied = await applyDecisions(db, {
    topics,
    pitches,
    decisions: verdict.decisions ?? [],
    onProgress: emit,
  });

  const run = {
    period_end: periodEnd,
    topics: topics.length,
    attached: applied.attached,
    created: applied.created,
    ignored: applied.ignored,
    skipped: applied.skipped,
    details: applied.details,
    log,
  };

  await db.from('agent_runs').insert({
    candidates: applied.created,
    pitched: applied.attached,
    quiet_day: applied.attached === 0 && applied.created === 0,
    notes: 'trending-review: ' + JSON.stringify({
      period_end: periodEnd,
      topics: topics.length,
      attached: applied.attached,
      created: applied.created,
      ignored: applied.ignored,
      skipped: applied.skipped,
    }),
  });

  if (process.env.NOTIFY_WEBHOOK && (applied.attached || applied.created)) {
    const lines = applied.details
      .filter((d) => d.action !== 'ignore')
      .map((d) => d.action === 'attach'
        ? `Attach (${d.verdict}): ${d.headline}`
        : `New: ${d.headline}`)
      .join('\n');
    await fetch(process.env.NOTIFY_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `Caveat — trending review\n${lines}` }),
    }).catch((e) => console.error('notify failed:', e.message));
  }

  emit(`Done. attached=${applied.attached} created=${applied.created} ignored=${applied.ignored}`);
  return run;
}
