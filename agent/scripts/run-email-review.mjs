// Editorial email reviewer: inbox (kind=email) → Claude suggestions → topic_suggestions.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import './lib/load-env.mjs';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const MAX_SUGGESTIONS = 8;
const MAX_EMAILS = 10;

function extractLinks(text) {
  const urls = text?.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return urls[0] ?? null;
}

async function reviewEmail(email, topics, pitches, news) {
  const charter = readFileSync(new URL('../EDITORIAL.md', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../taste/email-review-prompt.md', import.meta.url), 'utf8');
  const body = [email.body, email.url ? `\nLink: ${email.url}` : ''].filter(Boolean).join('\n').slice(0, 8000);
  const prompt = template
    .replace('{EDITORIAL.md}', charter)
    .replace('{JSON: topic_id, label, keywords, why, last_hit}', JSON.stringify(topics))
    .replace('{JSON: id, headline, state, detector}', JSON.stringify(pitches))
    .replace('{JSON: title, matched_keywords, published_at}', JSON.stringify(news))
    .replace('{from_address}', email.from_address ?? 'unknown')
    .replace('{subject}', email.title ?? '(no subject)')
    .replace('{body}', body)
    .replace('{max_suggestions}', String(MAX_SUGGESTIONS));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const raw = await res.json();
  const text = (raw.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    console.error('unparseable email review for', email.id);
    return { suggestions: [] };
  }
}

async function main() {
  const { data: emails } = await db.from('inbox')
    .select('id, title, body, url, from_address, created_at')
    .eq('kind', 'email')
    .eq('status', 'new')
    .order('created_at')
    .limit(MAX_EMAILS);

  if (!emails?.length) {
    const summary = { emails: 0, suggestions: 0 };
    await db.from('agent_runs').insert({ notes: 'email-review: ' + JSON.stringify(summary) });
    console.log(summary);
    return;
  }

  const [{ data: topics }, { data: pitches }, { data: news }] = await Promise.all([
    db.from('tracked_topics').select('topic_id, label, keywords, why, last_hit').eq('active', true),
    db.from('pitches').select('id, headline, state, detector').order('first_seen', { ascending: false }).limit(40),
    db.from('rss_items').select('title, matched_keywords, published_at')
      .neq('status', 'discarded').order('published_at', { ascending: false }).limit(30),
  ]);

  let totalSuggestions = 0;
  for (const email of emails) {
    await db.from('inbox').update({ status: 'processing' }).eq('id', email.id);
    const verdict = await reviewEmail(email, topics ?? [], pitches ?? [], news ?? []);
    const validActions = new Set(['update_topic', 'new_topic', 'story_idea']);
    let inserted = 0;

    for (const s of (verdict.suggestions ?? []).slice(0, MAX_SUGGESTIONS)) {
      if (!validActions.has(s.action) || !s.summary?.trim()) continue;
      const payload = { ...(s.payload ?? {}) };
      if (s.action === 'update_topic' && payload.topic_id) {
        const t = (topics ?? []).find((x) => x.topic_id === payload.topic_id);
        if (t) payload.topic_label = t.label;
      }
      const { error } = await db.from('topic_suggestions').insert({
        source_kind: 'email',
        source_id: email.id,
        action: s.action,
        summary: s.summary.trim(),
        payload,
        status: 'pending',
      });
      if (!error) inserted++;
    }

    totalSuggestions += inserted;
    await db.from('inbox').update({
      status: inserted ? 'ingested' : 'archived',
      processed_at: new Date().toISOString(),
    }).eq('id', email.id);
  }

  const summary = { emails: emails.length, suggestions: totalSuggestions };
  await db.from('agent_runs').insert({ notes: 'email-review: ' + JSON.stringify(summary) });
  console.log(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
