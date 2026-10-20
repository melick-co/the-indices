/**
 * Social posting for the production queue: keeps each channel's post in step with its queue item. YouTube and LinkedIn.
 *
 * YouTube uploads ahead of the slot, private, with YouTube's own publish time set to the slot, so the video goes
 * public on time however late the runner starts. If the slot moves, the publish time moves; if the piece is held or
 * removed, the video is withdrawn (private, no publish time).
 *
 * LinkedIn cannot schedule, so its posts go out at or after the slot: the planner (web/lib/social/linkedin-plan.ts)
 * drafts one post per weekday, and this sends each one that is cleared (approved in review mode; approved or passed
 * the checks in auto mode) once its piece is live on the site. The linkedin-post task runs every 30 minutes through
 * the weekday morning (.github/workflows/agent.yml), and approving on the Queue page posts at once if the slot has
 * passed and this server has the credentials.
 */
import type { createClient } from '@/lib/supabase-server';
import { cadenceDecision, channelMode, itemUrl, loadRules, type Channel, type QueueItem, type QueuePost } from '@/lib/content-queue';
import { idFromUrl, setSchedule, shortUrl, uploadVideo, youtubeChannel, youtubeConfigured, youtubeToken } from '@/lib/social/youtube';
import {
  LinkedinError, buildArticlePost, buildImagePost, createPost, deletePost, linkedinConfigured, linkedinOrg, linkedinToken,
  postUrl, uploadImage, urnFromUrl,
} from '@/lib/social/linkedin';
import { planLinkedin } from '@/lib/social/linkedin-plan';

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

/** The LinkedIn post body for a piece: an article card for stories and graphics, the poster image for a race. */
async function linkedinBody(token: string, q: QueueItem, caption: string, log: (m: string) => void) {
  const author = linkedinOrg();
  const url = itemUrl(q);
  const image = (q.media?.image ?? q.media?.poster) as string | undefined;
  let urn: string | null = null;
  if (image) {
    try { urn = await uploadImage(token, author, image); } catch (e) {
      if (e instanceof LinkedinError && e.kind !== 'other') throw e;
      log(`LinkedIn: no thumbnail for ${q.title} (${e instanceof Error ? e.message : e}); posting without it.`);
    }
  }
  // Race clips are not uploaded (no Videos API yet): the poster image, with the link in the text.
  if (q.kind === 'race' && urn) return buildImagePost({ author, commentary: `${caption}\n\n${url}`, image: urn, altText: q.title });
  return buildArticlePost({ author, commentary: caption, url, title: q.title, description: q.summary, thumbnail: urn });
}

async function postLinkedin(db: Db, log: (m: string) => void) {
  const rules = await loadRules(db);
  if (!rules.installed) return;
  const mode = channelMode(rules, 'linkedin');
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: rows, error } = await db.from('content_posts').select('*').eq('channel', 'linkedin')
    .or(`status.in.(review,held,approved,scheduled,failed),and(status.eq.posted,posted_at.gte.${since})`);
  if (error) { log(`LinkedIn: ${error.message}`); return; }
  const posts = (rows ?? []) as QueuePost[];
  if (!posts.length) { log('LinkedIn: nothing to do.'); return; }
  const { data: qs } = await db.from('content_queue').select('*').in('id', posts.map((p) => p.queue_id));
  const queue = new Map(((qs ?? []) as QueueItem[]).map((q) => [q.id, q]));
  const now = new Date();
  const work = posts.map((p) => ({ p, q: queue.get(p.queue_id) })).filter((x): x is { p: QueuePost; q: QueueItem } => !!x.q)
    .map((x) => ({ ...x, d: cadenceDecision(mode, x.p, x.q.status, now) })).filter((x) => x.d !== 'wait');
  if (!work.length) { log(`LinkedIn (${mode} mode): nothing due.`); return; }
  const configured = linkedinConfigured();
  let token: string | null = null;
  const auth = async () => (token ??= await linkedinToken());
  for (const { p, q, d } of work) {
    try {
      if (d === 'unplan') {
        await db.from('content_posts').delete().eq('id', p.id).neq('status', 'posted');
        log(`LinkedIn: ${q.title} went back to ready; its slot is free again.`);
      } else if (d === 'stale') {
        await patch(db, p.id, { status: 'skipped', error: p.status === 'review' || p.status === 'held' ? 'not approved before the posting window closed' : 'missed the posting window (six hours after the slot)' });
        log(`LinkedIn: skipped ${q.title} (window closed).`);
      } else if (d === 'withdraw') {
        const urn = p.external_url ? urnFromUrl(p.external_url) : null;
        if (urn && p.status === 'posted') {
          if (!configured) { log(`LinkedIn: ${q.title} is ${q.status} but still on LinkedIn; no credentials to delete it.`); continue; }
          await deletePost(await auth(), urn);
          log(`LinkedIn: deleted ${q.title} (queue item ${q.status}).`);
        }
        await patch(db, p.id, { status: 'skipped', error: urn && p.status === 'posted' ? `deleted from LinkedIn: queue item ${q.status}` : `queue item ${q.status}` });
      } else if (d === 'post') {
        if (!configured) { log(`LinkedIn: ${q.title} is due but LinkedIn is not connected (no credentials).`); continue; }
        if (!p.caption?.trim()) { await patch(db, p.id, { status: 'held', error: 'no copy' }); continue; }
        const was = p.status;
        // Claim the row first, so two runners never post it twice. A crash leaves it 'planned' for an editor to see.
        const { data: claimed } = await db.from('content_posts').update({ status: 'planned', error: 'posting…', updated_at: new Date().toISOString() })
          .eq('id', p.id).eq('status', was).is('external_url', null).select('id');
        if (!claimed?.length) continue;
        try {
          const t = await auth();
          const urn = await createPost(t, await linkedinBody(t, q, p.caption, log));
          await patch(db, p.id, { status: 'posted', posted_at: new Date().toISOString(), external_url: postUrl(urn), error: null });
          log(`LinkedIn: posted ${q.title} ${postUrl(urn)}`);
        } catch (e) {
          // Rate limit: put it back as it was for the next run. Anything else: failed, for an editor to retry.
          const rate = e instanceof LinkedinError && e.kind === 'rate';
          await patch(db, p.id, { status: rate ? was : 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
          throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`LinkedIn: failed on ${q.title}: ${msg}`);
      // A token, permission or rate problem affects every post: stop and try again next run.
      if (e instanceof LinkedinError && e.kind !== 'other' && e.kind !== 'gone') break;
    }
  }
  if (token) await markConnected(db, 'linkedin');
}

/** Send LinkedIn's due posts only (the linkedin-post task, and the Queue page after an approval). */
export async function postLinkedinNow(db: Db, log: (m: string) => void = console.log) {
  try { await postLinkedin(db, log); } catch (e) { log(`LinkedIn: ${e instanceof Error ? e.message : e}`); }
}

/** Bring every connected channel in step with the queue. */
export async function postSocial(db: Db, log: (m: string) => void = console.log) {
  try { await postYoutube(db, log); } catch (e) { log(`YouTube: ${e instanceof Error ? e.message : e}`); }
  try { await planLinkedin(db, log); } catch (e) { log(`LinkedIn planning: ${e instanceof Error ? e.message : e}`); }
  await postLinkedinNow(db, log);
}
