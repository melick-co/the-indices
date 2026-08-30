'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';

type Action = 'approve' | 'reject' | 'watchlist' | 'rank_up' | 'rank_down' | 'comment' | 'redirect';

const STATE_FOR: Partial<Record<Action, string>> = {
  approve: 'approved', reject: 'rejected', watchlist: 'watchlist',
};

/** Records the decision AND moves the pitch. Feedback is what teaches the taste
 *  layer: every action here lands in the next run's prompt. Nothing is deleted. */
export async function act(pitchId: string, action: Action, comment?: string) {
  const supabase = createClient();
  const now = new Date().toISOString();

  // Attribute the audit event to the editor rather than the agent.
  await supabase.rpc('set_actor', { who: 'editor' }).then(() => {}, () => {});

  await supabase.from('pitch_feedback').insert({
    pitch_id: pitchId, action, comment: comment || null,
  });

  const nextState = STATE_FOR[action];
  if (nextState) {
    const patch: Record<string, unknown> = {
      state: nextState, state_changed: now, last_evaluated: now,
    };
    // Rejected ideas are never lost: park a 90-day re-look unless one is already set.
    if (action === 'reject') {
      const { data } = await supabase.from('pitches')
        .select('resurface_after, resurface_metrics').eq('id', pitchId).single();
      if (!data?.resurface_after && !data?.resurface_metrics?.length) {
        patch.resurface_after = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
        patch.resurface_on = 'editor reject: automatic 90-day re-look';
      }
    }
    await supabase.from('pitches').update(patch).eq('id', pitchId);
  }

  if (action === 'rank_up' || action === 'rank_down') {
    const { data } = await supabase.from('pitches').select('rank_value').eq('id', pitchId).single();
    const delta = action === 'rank_up' ? 1 : -1;
    await supabase.from('pitches')
      .update({ rank_value: (data?.rank_value ?? 0) + delta }).eq('id', pitchId);
  }

  revalidatePath('/studio');
}

export async function addToInbox(kind: string, title: string, body: string, url: string) {
  const supabase = createClient();
  await supabase.from('inbox').insert({
    kind, title: title || null, body: body || null, url: url || null,
  });
  revalidatePath('/studio');
}

/** Mark a news item for the public ticker, with an optional label. */
export async function curate(itemId: string, curated: boolean, note?: string) {
  const supabase = createClient();
  await supabase.from('rss_items').update({
    curated,
    curated_note: curated ? (note || null) : null,
    curated_at: curated ? new Date().toISOString() : null,
  }).eq('item_id', itemId);
  revalidatePath('/studio');
  revalidatePath('/');
}

/** Apply an approved topic/story suggestion from the email review queue. */
export async function approveSuggestion(suggestionId: string, note?: string) {
  const supabase = createClient();
  const { data: s } = await supabase.from('topic_suggestions')
    .select('*').eq('suggestion_id', suggestionId).maybeSingle();
  if (!s?.suggestion_id || s.status !== 'pending') return { ok: false as const };

  const p = (s.payload ?? {}) as Record<string, unknown>;
  let linkedPitch: string | null = null;

  if (s.action === 'update_topic' && p.topic_id) {
    const { data: topic } = await supabase.from('tracked_topics')
      .select('keywords, why').eq('topic_id', String(p.topic_id)).maybeSingle();
    if (topic) {
      const add = Array.isArray(p.add_keywords) ? p.add_keywords.map(String) : [];
      const keywords = [...new Set([...(topic.keywords ?? []), ...add])];
      const noteLine = p.note ? String(p.note).trim() : '';
      const why = noteLine ? [topic.why, noteLine].filter(Boolean).join('\n') : topic.why;
      await supabase.from('tracked_topics').update({ keywords, why }).eq('topic_id', String(p.topic_id));
    }
  } else if (s.action === 'new_topic') {
    const label = String(p.label ?? s.summary).trim();
    const keywords = Array.isArray(p.keywords) ? p.keywords.map(String) : [];
    if (label && keywords.length) {
      await supabase.from('tracked_topics').insert({
        label,
        keywords,
        why: p.why ? String(p.why) : null,
        active: true,
      });
    }
  } else if (s.action === 'story_idea') {
    const { data: pitch } = await supabase.from('pitches').insert({
      headline: String(p.headline_draft ?? s.summary).slice(0, 240),
      hook: p.hook ? String(p.hook) : null,
      caveat: p.kill_condition ? String(p.kill_condition) : null,
      detector: 'email_lead',
      trigger_rows: {
        suggestion_id: suggestionId,
        inbox_id: s.source_id,
        data_needed: p.data_needed ?? null,
      },
      metric_ids: Array.isArray(p.metric_ids) ? p.metric_ids.map(String) : [],
      state: 'candidate',
    }).select('id').single();
    linkedPitch = pitch?.id ?? null;
  }

  await supabase.from('topic_suggestions').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    review_note: note?.trim() || null,
    linked_pitch: linkedPitch,
  }).eq('suggestion_id', suggestionId);

  revalidatePath('/studio');
  revalidatePath('/studio/ask');
  return { ok: true as const };
}

export async function rejectSuggestion(suggestionId: string, note?: string) {
  const supabase = createClient();
  await supabase.from('topic_suggestions').update({
    status: 'rejected',
    reviewed_at: new Date().toISOString(),
    review_note: note?.trim() || null,
  }).eq('suggestion_id', suggestionId).eq('status', 'pending');
  revalidatePath('/studio');
  return { ok: true as const };
}
