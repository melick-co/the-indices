'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import {
  ASK_INSTRUCTIONS,
  BRAINSTORM_INSTRUCTIONS,
  CHARTER,
  callClaude,
  loadMetricList,
} from '@/lib/research-agent';
import {
  buildInputPrompt,
  deriveTopicFromText,
  extractAngleText,
  parseMonitoring,
  parseVerdict,
  SessionInput,
  SessionMessage,
} from '@/lib/research-shared';

const UA = 'Caveat-Studio/0.1 (+https://the-indices.vercel.app)';

function revalidateBrainstorm(sessionId?: string) {
  revalidatePath('/studio/brainstorm');
  revalidatePath('/studio/ask');
  if (sessionId) revalidatePath(`/studio/brainstorm/${sessionId}`);
}

export async function createBrainstormSession(title?: string, prompt?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from('research_sessions').insert({
    mode: 'brainstorm',
    status: 'draft',
    title: title?.trim() || 'Untitled brainstorm',
    question: prompt?.trim() || '',
    answer: null,
    inputs: [],
    messages: [],
    monitoring: {},
  }).select('session_id').single();
  if (error) return { ok: false as const, error: error.message };
  revalidateBrainstorm(data.session_id);
  return { ok: true as const, sessionId: data.session_id };
}

export async function saveBrainstormSession(
  sessionId: string,
  patch: { title?: string; prompt?: string; inputs?: SessionInput[] },
) {
  const supabase = createClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title != null) row.title = patch.title.trim() || 'Untitled brainstorm';
  if (patch.prompt != null) row.question = patch.prompt;
  if (patch.inputs != null) row.inputs = patch.inputs;
  const { error } = await supabase.from('research_sessions').update(row).eq('session_id', sessionId);
  if (error) return { ok: false as const, error: error.message };
  revalidateBrainstorm(sessionId);
  return { ok: true as const };
}

export async function fetchLinkContent(url: string) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false as const, error: 'Only http(s) links are supported.' };
    }
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false as const, error: `Fetch failed (${res.status})` };
    const raw = await res.text();
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? parsed.hostname;
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
    return { ok: true as const, title, text, url };
  } catch (e: any) {
    return { ok: false as const, error: e.message ?? 'Could not fetch link' };
  }
}

export async function runBrainstorm(sessionId: string, followUp?: string) {
  const started = Date.now();
  const supabase = createClient();
  const { data: session, error: loadErr } = await supabase.from('research_sessions')
    .select('*').eq('session_id', sessionId).single();
  if (loadErr || !session) return { ok: false as const, error: loadErr?.message ?? 'Session not found' };

  const inputs = (session.inputs ?? []) as SessionInput[];
  const priorMessages = (session.messages ?? []) as SessionMessage[];
  const basePrompt = buildInputPrompt(session.question ?? '', inputs);
  if (!basePrompt.trim() && !followUp?.trim()) {
    return { ok: false as const, error: 'Add a prompt, link, or file before running.' };
  }

  await supabase.from('research_sessions').update({ status: 'running' }).eq('session_id', sessionId);

  const metricList = await loadMetricList();
  const system = CHARTER + BRAINSTORM_INSTRUCTIONS;
  const userPrompt = followUp?.trim()
    ? `${basePrompt}\n\nFollow-up from editor:\n${followUp.trim()}`
    : basePrompt;

  let text = '';
  let toolsUsed: string[] = [];
  try {
    const r = await callClaude(system, userPrompt, metricList);
    text = r.text;
    toolsUsed = r.toolsUsed;
  } catch (e: any) {
    text = `Brainstorm failed: ${e.message}`;
  }

  const monitoring = parseMonitoring(text);
  const messages: SessionMessage[] = [
    ...priorMessages,
    ...(followUp?.trim()
      ? [{ role: 'user' as const, content: followUp.trim(), at: new Date().toISOString() }]
      : [{ role: 'user' as const, content: basePrompt, at: new Date().toISOString() }]),
    { role: 'assistant', content: text, at: new Date().toISOString() },
  ];

  const { error: saveErr } = await supabase.from('research_sessions').update({
    answer: text,
    status: 'complete',
    tools_used: [...new Set([...(session.tools_used ?? []), ...toolsUsed])],
    sources: monitoring,
    monitoring: { suggested: monitoring, accepted: session.monitoring?.accepted ?? null },
    messages,
    duration_ms: (session.duration_ms ?? 0) + (Date.now() - started),
    updated_at: new Date().toISOString(),
  }).eq('session_id', sessionId);

  if (saveErr) return { ok: false as const, error: saveErr.message };
  revalidateBrainstorm(sessionId);
  return { ok: true as const, text, monitoring };
}

export async function archiveBrainstormSession(sessionId: string) {
  const supabase = createClient();
  const { error } = await supabase.from('research_sessions')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);
  if (error) return { ok: false as const, error: error.message };
  revalidateBrainstorm(sessionId);
  return { ok: true as const };
}

export async function bankBrainstorm(
  sessionId: string,
  headline: string,
  angleHeadline?: string,
) {
  const supabase = createClient();
  const { data: s, error: sessionErr } = await supabase.from('research_sessions')
    .select('question, answer, title').eq('session_id', sessionId).single();
  if (sessionErr) return { ok: false as const, error: sessionErr.message };

  const answer = s?.answer ?? '';
  const mechanism = angleHeadline
    ? extractAngleText(answer, angleHeadline)
    : answer.slice(0, 1200);

  const { data: pitch, error } = await supabase.from('pitches').insert({
    headline: headline || angleHeadline || s?.title || 'Untitled',
    hook: s?.question ?? null,
    mechanism,
    detector: 'research_session',
    trigger_rows: { session_id: sessionId, angle: angleHeadline ?? null },
    metric_ids: [],
    state: 'candidate',
  }).select('id').single();

  if (error) return { ok: false as const, error: error.message };
  if (!pitch) return { ok: false as const, error: 'Pitch was not created.' };

  await supabase.from('research_sessions')
    .update({ linked_pitch: pitch.id, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);

  revalidatePath('/studio');
  revalidateBrainstorm(sessionId);
  return { ok: true as const, pitchId: pitch.id };
}

export type MonitorSelection = {
  topics: { label: string; keywords: string[]; cadence: 'regular' | 'on_request' }[];
  feeds: { url: string; name: string; cadence: 'regular' | 'on_request' }[];
  dataSources: { sourceId: string; label: string; cadence: 'regular' | 'on_request' }[];
};

export async function setupMonitoring(sessionId: string, selection: MonitorSelection) {
  const supabase = createClient();
  const created: string[] = [];

  for (const topic of selection.topics) {
    const { data } = await supabase.from('tracked_topics').insert({
      label: topic.label,
      keywords: topic.keywords.length ? topic.keywords : topic.label.toLowerCase().split(/\s+/),
      why: `From brainstorm session ${sessionId.slice(0, 8)}`,
    }).select('topic_id').single();
    await supabase.from('session_monitors').insert({
      session_id: sessionId,
      kind: 'topic',
      label: topic.label,
      payload: { keywords: topic.keywords },
      cadence: topic.cadence,
      linked_id: data?.topic_id ?? null,
    });
    if (data?.topic_id) created.push(`topic:${topic.label}`);
  }

  for (const feed of selection.feeds) {
    const { data: existing } = await supabase.from('rss_feeds').select('feed_id')
      .eq('url', feed.url).maybeSingle();
    let feedId = existing?.feed_id;
    if (!feedId) {
      const { data: inserted } = await supabase.from('rss_feeds').insert({
        url: feed.url,
        name: feed.name || feed.url,
        publisher: feed.name || 'Unknown',
        tier: 2,
        active: feed.cadence === 'regular',
        added_via: 'manual',
      }).select('feed_id').single();
      feedId = inserted?.feed_id;
    } else if (feed.cadence === 'regular') {
      await supabase.from('rss_feeds').update({ active: true }).eq('feed_id', feedId);
    }
    await supabase.from('session_monitors').insert({
      session_id: sessionId,
      kind: 'rss',
      label: feed.name || feed.url,
      payload: { url: feed.url },
      cadence: feed.cadence,
      linked_id: feedId ?? null,
    });
    created.push(`feed:${feed.name || feed.url}`);
  }

  for (const src of selection.dataSources) {
    await supabase.from('session_monitors').insert({
      session_id: sessionId,
      kind: 'data_source',
      label: src.label,
      payload: { source_id: src.sourceId },
      cadence: src.cadence,
      linked_id: src.sourceId,
    });
    if (src.cadence === 'regular') {
      await supabase.from('data_sources').update({ active: true }).eq('source_id', src.sourceId);
    }
    created.push(`source:${src.label}`);
  }

  const { data: session } = await supabase.from('research_sessions')
    .select('monitoring').eq('session_id', sessionId).single();
  await supabase.from('research_sessions').update({
    monitoring: {
      ...(session?.monitoring ?? {}),
      accepted: selection,
      enabled_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq('session_id', sessionId);

  revalidateBrainstorm(sessionId);
  return { ok: true as const, created };
}

/** Legacy ask entry — kept for /studio/ask */
export async function research(mode: 'ask' | 'brainstorm', question: string) {
  const started = Date.now();
  const supabase = createClient();
  const metricList = await loadMetricList();
  const system = CHARTER + (mode === 'ask' ? ASK_INSTRUCTIONS : BRAINSTORM_INSTRUCTIONS);

  let text = '';
  let toolsUsed: string[] = [];
  try {
    const r = await callClaude(system, question, metricList);
    text = r.text;
    toolsUsed = r.toolsUsed;
  } catch (e: any) {
    text = `Research failed: ${e.message}`;
  }

  const { data: row } = await supabase.from('research_sessions').insert({
    mode,
    status: 'complete',
    title: question.slice(0, 80),
    question,
    answer: text,
    verdict: parseVerdict(text),
    tools_used: [...new Set(toolsUsed)],
    duration_ms: Date.now() - started,
    inputs: [],
    messages: [
      { role: 'user', content: question, at: new Date().toISOString() },
      { role: 'assistant', content: text, at: new Date().toISOString() },
    ],
  }).select('session_id').single();

  revalidateBrainstorm(row?.session_id);
  return { text, sessionId: row?.session_id ?? null, toolsUsed: [...new Set(toolsUsed)] };
}

export async function bankResearch(sessionId: string, headline: string) {
  return bankBrainstorm(sessionId, headline);
}

/** Route session into the right watch list: Ask → tracked topics, Brainstorm → session index. */
export async function trackSession(sessionId: string) {
  const supabase = createClient();
  const { data: session, error } = await supabase.from('research_sessions')
    .select('session_id, mode, question, title, monitoring')
    .eq('session_id', sessionId)
    .single();
  if (error || !session) return { ok: false as const, error: 'Session not found' };

  const href = session.mode === 'ask' ? '/studio/ask#tracked-topics' : '/studio/brainstorm#sessions';
  const area = session.mode === 'ask' ? 'Tracked topics' : 'Brainstorm sessions';

  const { data: existing } = await supabase.from('session_monitors')
    .select('monitor_id, linked_id')
    .eq('session_id', sessionId)
    .eq('kind', 'topic')
    .eq('active', true)
    .maybeSingle();

  if (existing || session.monitoring?.tracked) {
    return { ok: true as const, already: true as const, href, area };
  }

  const source = (session.title?.trim() || session.question?.trim() || 'Untitled');
  const { label, keywords } = deriveTopicFromText(source);
  const why = session.mode === 'ask'
    ? `Ask: ${source.slice(0, 160)}`
    : `Brainstorm: ${source.slice(0, 160)}`;

  const { data: topic, error: topicErr } = await supabase.from('tracked_topics').insert({
    label,
    keywords,
    why,
    active: true,
  }).select('topic_id').single();
  if (topicErr) return { ok: false as const, error: topicErr.message };

  await supabase.from('session_monitors').insert({
    session_id: sessionId,
    kind: 'topic',
    label,
    payload: { keywords, topic_id: topic.topic_id },
    cadence: 'regular',
    linked_id: topic.topic_id,
  });

  await supabase.from('research_sessions').update({
    monitoring: {
      ...(session.monitoring ?? {}),
      tracked: true,
      tracked_at: new Date().toISOString(),
      topic_id: topic.topic_id,
    },
    updated_at: new Date().toISOString(),
  }).eq('session_id', sessionId);

  revalidateBrainstorm(sessionId);
  return { ok: true as const, href, area, topicId: topic.topic_id };
}

export async function addTopic(label: string, keywords: string, why: string) {
  const supabase = createClient();
  await supabase.from('tracked_topics').insert({
    label,
    keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
    why: why || null,
  });
  revalidateBrainstorm();
}

export async function toggleTopic(topicId: string, active: boolean) {
  const supabase = createClient();
  await supabase.from('tracked_topics').update({ active }).eq('topic_id', topicId);
  revalidateBrainstorm();
}
