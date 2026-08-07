// Daily agent runner - WORKING implementation.
// Flow: resurface sweep -> detectors -> dedup -> taste layer -> apply verdict
//       -> notify -> log run.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, NOTIFY_WEBHOOK (optional)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { runDetectors } from './detectors.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const MAX_TO_TASTE = 40;
const run = { sources_due: 0, sources_changed: 0, candidates: 0, pitched: 0,
  resurfaced: 0, quiet_day: false, notes: '' };

// ---------- 1. Resurface sweep (D6): wake parked ideas whose condition fired ----------
async function resurfaceSweep() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: parked } = await db.from('pitches').select('*')
    .in('state', ['dormant', 'rejected', 'watchlist']);
  const woken = [];
  for (const p of parked ?? []) {
    let fire = p.resurface_after && p.resurface_after <= today;
    if (!fire && p.resurface_metrics?.length) {
      const { count } = await db.from('observations')
        .select('*', { count: 'exact', head: true })
        .in('metric_id', p.resurface_metrics)
        .gt('created_at', p.last_evaluated);
      fire = (count ?? 0) > 0;
    }
    if (fire) {
      await db.from('pitches').update({ state: 'candidate',
        state_changed: new Date().toISOString() }).eq('id', p.id);
      woken.push(p.id);
    }
  }
  run.resurfaced = woken.length;
}

// ---------- 2. Detectors + dedup ----------
async function detect() {
  const { data: obs } = await db.from('observations')
    .select('metric_id, entity, period, value, status').limit(10000);
  const { data: mets } = await db.from('metrics').select('metric_id, name, direction');
  const metricsById = new Map((mets ?? []).map((m) => [m.metric_id, m]));
  const cands = runDetectors(obs ?? [], metricsById);
  let inserted = 0;
  for (const c of cands) {
    const { count } = await db.from('pitches')
      .select('*', { count: 'exact', head: true })
      .contains('trigger_rows', { fingerprint: c.fingerprint });
    if ((count ?? 0) > 0) continue;               // already known, any state
    const { error } = await db.from('pitches').insert({
      headline: c.headline, detector: c.detector,
      trigger_rows: { ...c.trigger_rows, fingerprint: c.fingerprint },
      metric_ids: c.metric_ids, state: 'candidate',
    });
    if (!error) inserted++;
  }
  run.notes += `detector_new:${inserted}; `;
}

// ---------- 3. Taste layer ----------
function buildPrompt(charter, decisions, published, candidates, inbox) {
  return `You are the editorial filter for a data-journalism publication. Your judgement is
defined ENTIRELY by the editorial charter below. Apply this charter, not generic
notions of interestingness.

<charter>
${charter}
</charter>

<recent_decisions>
${JSON.stringify(decisions)}
</recent_decisions>

<already_published>
${JSON.stringify(published)}
</already_published>

<candidates>
${JSON.stringify(candidates)}
</candidates>

<inbox>
${JSON.stringify(inbox)}
</inbox>

Tasks:
1. KILL candidates violating a hard filter (list id + one-line reason).
2. Score survivors on the rubric (surprise, checkability, mechanism, visual, timing; 0-5)
   and compute rank per charter weights (surprise x2, checkability x2, others x1).
   Checkability 0 kills regardless.
3. Pitch the top candidates (up to 5; fewer is fine - a quiet day is honest output).
   For each: refined headline (charter voice: finding not topic, AU English, no em
   dashes), hook (why now), mechanism (one lay-reader sentence), caveat (hostile
   reader's first objection), chart_hint.
4. Non-pitched candidates with future potential: dormant, with resurface_metrics
   (array of metric ids) and/or resurface_after (ISO date) and resurface_on (human
   readable condition).
5. If more than 5 clear the bar: pitch top 5, remainder to watchlist with
   resurface_after 2 days out.
6. Inbox items: convert viable ideas to candidates; archive the rest with reasons.

Respond with ONLY valid JSON, no markdown fences:
{"kills":[{"id":"...","reason":"..."}],
 "pitches":[{"id":"...","headline":"...","hook":"...","mechanism":"...","caveat":"...","chart_hint":"...","score":{"surprise":0,"checkability":0,"mechanism":0,"visual":0,"timing":0},"rank_value":0}],
 "dormant":[{"id":"...","resurface_metrics":[],"resurface_after":null,"resurface_on":"..."}],
 "watchlist_overflow":[{"id":"..."}],
 "inbox_actions":[{"inbox_id":"...","action":"convert|archive","headline":"...","reason":"..."}],
 "quiet_day":false}`;
}

async function taste() {
  const charter = readFileSync(new URL('../EDITORIAL.md', import.meta.url), 'utf8');
  const { data: cands } = await db.from('pitches').select('*')
    .eq('state', 'candidate').order('first_seen').limit(MAX_TO_TASTE);
  const { data: fb } = await db.from('pitch_feedback')
    .select('action, comment, pitches(headline)')
    .order('created_at', { ascending: false }).limit(30);
  const { data: pub } = await db.from('pitches').select('headline, metric_ids')
    .eq('state', 'published');
  const { data: inbox } = await db.from('inbox').select('id, kind, title, body, url')
    .eq('status', 'new').in('kind', ['idea', 'article', 'dataset', 'image']);
  run.candidates = cands?.length ?? 0;
  if (!run.candidates && !(inbox?.length)) { run.quiet_day = true; return null; }

  const prompt = buildPrompt(charter,
    (fb ?? []).map((f) => ({ headline: f.pitches?.headline, action: f.action, comment: f.comment })),
    pub ?? [],
    (cands ?? []).map(({ id, headline, hook, mechanism, caveat, detector, trigger_rows, metric_ids, times_pitched }) =>
      ({ id, headline, hook, mechanism, caveat, detector, trigger_rows, metric_ids, times_pitched })),
    inbox ?? []);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { throw new Error('taste verdict was not valid JSON'); }
}

// ---------- 4. Apply verdict ----------
async function apply(v) {
  if (!v) return [];
  const now = new Date().toISOString();
  const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

  for (const k of v.kills ?? [])
    await db.from('pitches').update({ state: 'dormant', resurface_after: plus(30),
      resurface_on: `taste kill: ${k.reason}`, last_evaluated: now, state_changed: now })
      .eq('id', k.id);

  const pitched = [];
  for (const p of v.pitches ?? []) {
    const { data: cur } = await db.from('pitches').select('times_pitched').eq('id', p.id).single();
    const { data: row } = await db.from('pitches').update({
      headline: p.headline, hook: p.hook, mechanism: p.mechanism, caveat: p.caveat,
      chart_hint: p.chart_hint, score: p.score, rank_value: p.rank_value,
      state: 'pitched', times_pitched: (cur?.times_pitched ?? 0) + 1,
      last_evaluated: now, state_changed: now,
    }).eq('id', p.id).select('id, headline, hook').single();
    if (row) pitched.push(row);
  }

  for (const d of v.dormant ?? [])
    await db.from('pitches').update({ state: 'dormant',
      resurface_metrics: d.resurface_metrics ?? null,
      resurface_after: d.resurface_after ?? null,
      resurface_on: d.resurface_on ?? null,
      last_evaluated: now, state_changed: now }).eq('id', d.id);

  for (const w of v.watchlist_overflow ?? [])
    await db.from('pitches').update({ state: 'watchlist', resurface_after: plus(2),
      resurface_on: 'overflow deferral', last_evaluated: now, state_changed: now })
      .eq('id', w.id);

  for (const a of v.inbox_actions ?? []) {
    if (a.action === 'convert') {
      const { data: pitch } = await db.from('pitches').insert({
        headline: a.headline ?? 'Untitled idea', detector: 'inbox_idea',
        trigger_rows: { inbox_id: a.inbox_id }, metric_ids: [], state: 'candidate',
      }).select('id').single();
      await db.from('inbox').update({ status: 'converted_to_pitch',
        linked_pitch: pitch?.id ?? null, processed_at: now }).eq('id', a.inbox_id);
    } else {
      await db.from('inbox').update({ status: 'archived', processed_at: now }).eq('id', a.inbox_id);
    }
  }

  run.pitched = pitched.length;
  run.quiet_day = v.quiet_day || pitched.length === 0;
  return pitched;
}

// ---------- 5. Notify ----------
async function notify(pitched) {
  if (!process.env.NOTIFY_WEBHOOK) return;
  const lines = pitched.length
    ? pitched.map((p, i) => `${i + 1}. ${p.headline}${p.hook ? `\n   ${p.hook}` : ''}`).join('\n')
    : 'Quiet day: no pitches cleared the bar.';
  await fetch(process.env.NOTIFY_WEBHOOK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `The Indices - daily pitches\n${lines}`, pitches: pitched }),
  }).catch((e) => console.error('notify failed:', e.message));
}

async function main() {
  await resurfaceSweep();
  await detect();
  const verdict = await taste();
  const pitched = await apply(verdict);
  await notify(pitched);
  await db.from('agent_runs').insert(run);
  console.log(JSON.stringify(run));
  for (const p of pitched) console.log('PITCH:', p.headline);
}
main().catch((e) => { console.error(e); process.exit(1); });
