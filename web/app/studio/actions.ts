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
