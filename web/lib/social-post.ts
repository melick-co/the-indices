/**
 * Social posting for the production queue: keeps each channel's post in step with its queue item. YouTube first.
 *
 * YouTube uploads ahead of the slot, private, with YouTube's own publish time set to the slot, so the video goes
 * public on time however late the runner starts. If the slot moves, the publish time moves; if the piece is held or
 * removed, the video is withdrawn (private, no publish time).
 */
import type { createClient } from '@/lib/supabase-server';
import { itemUrl, loadRules, type Channel, type QueueItem, type QueuePost } from '@/lib/content-queue';
import { idFromUrl, setSchedule, shortUrl, uploadVideo, youtubeChannel, youtubeConfigured, youtubeToken } from '@/lib/social/youtube';

type Db = ReturnType<typeof createClient>;

/** Record that a channel's credentials work, so the assistant plans its posts as scheduled, not "not connected". */
async function markConnected(db: Db, channel: Channel) {
  const rules = await loadRules(db);
  const connected = new Set(rules.connected ?? []);
  if (connected.has(channel)) return;
  connected.add(channel);
  const { installed: _installed, ...stored } = rules;
  await db.from('schedule_rules').update({ rules: { ...stored, connected: [...connected] }, updated_at: new Date().toISOString() }).eq('id', 1);
}

const patch = (db: Db, id: string, p: Partial<QueuePost>) => db.from('content_posts').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);

function description(q: QueueItem, caption: string | null, sources: string) {
  return [caption || q.title, '', `The full graphic and the data: ${itemUrl(q)}`, sources ? `Source: ${sources}` : '', '', 'Caveat Indices: Australia on one page, from official data.']
    .filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}

async function postYoutube(db: Db, log: (m: string) => void) {
  if (!youtubeConfigured()) { log('YouTube: not connected (no credentials).'); return; }
  const token = await youtubeToken();
  const channel = await youtubeChannel(token).catch(() => null);
  log(`YouTube: posting to the channel ${channel ? `${channel.title} (${channel.id})` : '(unknown)'}.`);
  await markConnected(db, 'youtube');
  const { data: rows } = await db.from('content_posts').select('*').eq('channel', 'youtube').in('status', ['planned', 'scheduled', 'not_connected', 'failed']);
  const posts = (rows ?? []) as QueuePost[];
  if (!posts.length) { log('YouTube: nothing to do.'); return; }
  const { data: qs } = await db.from('content_queue').select('*').in('id', posts.map((p) => p.queue_id));
  const queue = new Map(((qs ?? []) as QueueItem[]).map((q) => [q.id, q]));
  const now = Date.now();
  for (const p of posts) {
    const q = queue.get(p.queue_id);
    if (!q) continue;
    const id = p.external_url ? idFromUrl(p.external_url) : null;
    try {
      // Held, removed or failed in the queue: withdraw anything already on YouTube.
      if (['held', 'cancelled', 'failed'].includes(q.status)) {
        if (id && p.status === 'scheduled') { await setSchedule(token, id, 'withdraw'); log(`YouTube: withdrew ${q.title}`); }
        await patch(db, p.id, { status: 'skipped', error: `queue item ${q.status}` });
        continue;
      }
      if (q.status === 'ready') continue;                       // no slot yet
      const slot = q.status === 'published' ? null : q.scheduled_at ? new Date(q.scheduled_at) : null;
      const future = slot && slot.getTime() > now + 2 * 6e4 ? slot : null;
      if (!id) {
        const video = (q.media?.['9:16'] ?? q.media?.['1:1']) as string | undefined;
        if (!video) { await patch(db, p.id, { status: 'skipped', error: 'no vertical or square video to upload' }); continue; }
        const { data: v } = await db.from('visuals').select('sources').eq('slug', q.ref_slug).maybeSingle();
        const sources = ((v?.sources ?? []) as { org: string; dataset: string }[]).map((s) => `${s.org}, ${s.dataset}`).join('; ');
        const vid = await uploadVideo(token, { title: q.title, description: description(q, p.caption, sources), tags: ['Australia', 'data', 'Caveat Indices'], videoUrl: video, publishAt: future });
        await patch(db, p.id, { external_url: shortUrl(vid), status: future ? 'scheduled' : 'posted', scheduled_at: future?.toISOString() ?? null, posted_at: future ? null : new Date().toISOString(), error: null });
        log(`YouTube: uploaded ${q.title} (${future ? `public at ${future.toISOString()}` : 'public now'}) ${shortUrl(vid)}`);
        continue;
      }
      // Already on YouTube: follow a moved slot, or note that YouTube has published it.
      if (p.status === 'scheduled') {
        const planned = p.scheduled_at ? new Date(p.scheduled_at).getTime() : null;
        if (slot && planned !== slot.getTime()) {
          await setSchedule(token, id, future);
          await patch(db, p.id, { scheduled_at: future?.toISOString() ?? null, status: future ? 'scheduled' : 'posted', posted_at: future ? null : new Date().toISOString(), error: null });
          log(`YouTube: moved ${q.title} to ${future ? future.toISOString() : 'now'}`);
        } else if (planned && planned <= now) {
          await patch(db, p.id, { status: 'posted', posted_at: new Date(planned).toISOString() });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patch(db, p.id, { status: 'failed', error: msg.slice(0, 500) });
      log(`YouTube: failed on ${q.title}: ${msg}`);
    }
  }
}

/** Bring every connected channel in step with the queue. */
export async function postSocial(db: Db, log: (m: string) => void = console.log) {
  try { await postYoutube(db, log); } catch (e) { log(`YouTube: ${e instanceof Error ? e.message : e}`); }
}
