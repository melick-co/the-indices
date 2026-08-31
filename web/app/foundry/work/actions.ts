'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import {
  buildInputPrompt,
  deriveTopicFromText,
  extractAngleText,
  newMessage,
  normalizeMessages,
  parseMonitoring,
  parseVerdict,
  SessionInput,
  type FoundryIntent,
  type FoundryMessage,
} from '@/lib/research-shared';

const UA = 'Caveat-Foundry/0.1 (+https://the-indices.vercel.app)';

function revalidateFoundry(sessionId?: string) {
  revalidatePath('/foundry/work');
  revalidatePath('/foundry');
  if (sessionId) revalidatePath(`/foundry/work/${sessionId}`);
}

export async function createFoundrySession(
  title?: string,
  prompt?: string,
  intent: FoundryIntent = 'investigate',
) {
  const supabase = createClient();
  const { data, error } = await supabase.from('research_sessions').insert({
    mode: 'foundry',
    intent,
    status: 'draft',
    title: title?.trim() || 'Untitled session',
    question: prompt?.trim() || '',
    answer: null,
    inputs: [],
    messages: [],
    monitoring: {},
  }).select('session_id').single();
  if (error) return { ok: false as const, error: error.message };
  revalidateFoundry(data.session_id);
  return { ok: true as const, sessionId: data.session_id };
}

export async function saveFoundrySession(
  sessionId: string,
  patch: { title?: string; prompt?: string; inputs?: SessionInput[]; intent?: FoundryIntent },
) {
  const supabase = createClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title != null) row.title = patch.title.trim() || 'Untitled session';
  if (patch.prompt != null) row.question = patch.prompt;
  if (patch.inputs != null) row.inputs = patch.inputs;
  if (patch.intent != null) row.intent = patch.intent;
  const { error } = await supabase.from('research_sessions').update(row).eq('session_id', sessionId);
  if (error) return { ok: false as const, error: error.message };
  revalidateFoundry(sessionId);
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not fetch link';
    return { ok: false as const, error: msg };
  }
}

export async function archiveFoundrySession(sessionId: string) {
  const supabase = createClient();
  const { error } = await supabase.from('research_sessions')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);
  if (error) return { ok: false as const, error: error.message };
  revalidateFoundry(sessionId);
  return { ok: true as const };
}

export async function bankFoundrySession(
  sessionId: string,
  headline: string,
  messageId?: string,
  angleHeadline?: string,
) {
  const supabase = createClient();
  const { data: s, error: sessionErr } = await supabase.from('research_sessions')
    .select('question, answer, title, messages').eq('session_id', sessionId).single();
  if (sessionErr) return { ok: false as const, error: sessionErr.message };

  const messages = normalizeMessages(s?.messages);
  const msg = messageId ? messages.find((m) => m.id === messageId) : messages.filter((m) => m.role === 'assistant').at(-1);
  const answer = msg?.content ?? s?.answer ?? '';
  const mechanism = angleHeadline
    ? extractAngleText(answer, angleHeadline)
    : answer.slice(0, 1200);

  const score = msg?.score
    ? {
        surprise: msg.score.surprise,
        checkability: msg.score.checkability,
        mechanism: msg.score.mechanism,
        visual: msg.score.visual,
        timing: msg.score.timing,
      }
    : null;
  const rank_value = msg?.score?.rank_value ?? null;

  const { data: pitch, error } = await supabase.from('pitches').insert({
    headline: headline || angleHeadline || s?.title || 'Untitled',
    hook: s?.question ?? null,
    mechanism,
    detector: 'foundry_session',
    trigger_rows: { session_id: sessionId, message_id: messageId ?? null, angle: angleHeadline ?? null },
    metric_ids: [],
    score,
    rank_value,
    state: 'candidate',
  }).select('id').single();

  if (error) return { ok: false as const, error: error.message };
  if (!pitch) return { ok: false as const, error: 'Pitch was not created.' };

  await supabase.from('research_sessions')
    .update({ linked_pitch: pitch.id, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);

  revalidatePath('/foundry');
  revalidateFoundry(sessionId);
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
      why: `From foundry session ${sessionId.slice(0, 8)}`,
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

  revalidateFoundry(sessionId);
  return { ok: true as const, created };
}

export async function trackSession(sessionId: string) {
  const supabase = createClient();
  const { data: session, error } = await supabase.from('research_sessions')
    .select('session_id, mode, question, title, monitoring')
    .eq('session_id', sessionId)
    .single();
  if (error || !session) return { ok: false as const, error: 'Session not found' };

  const href = '/foundry/work#sessions';
  const area = 'Foundry sessions';

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
  const why = `Foundry: ${source.slice(0, 160)}`;

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

  revalidateFoundry(sessionId);
  return { ok: true as const, href, area, topicId: topic.topic_id };
}

export async function persistFoundryMessages(
  sessionId: string,
  messages: FoundryMessage[],
  patch?: { answer?: string; tools_used?: string[]; verdict?: string | null },
) {
  const supabase = createClient();
  const { error } = await supabase.from('research_sessions').update({
    messages,
    answer: patch?.answer,
    verdict: patch?.verdict,
    tools_used: patch?.tools_used,
    status: 'complete',
    updated_at: new Date().toISOString(),
  }).eq('session_id', sessionId);
  if (error) return { ok: false as const, error: error.message };
  revalidateFoundry(sessionId);
  return { ok: true as const };
}

export { parseMonitoring, parseVerdict, buildInputPrompt, extractAngleText };
export type { SessionInput, FoundryMessage, FoundryIntent };
