'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { postLinkedinNow, postSocial } from '@/lib/social-post';
import { youtubeConfigured } from '@/lib/social/youtube';
import { linkedinConfigured } from '@/lib/social/linkedin';
import { planLinkedin, recheck } from '@/lib/social/linkedin-plan';
import { CHANNELS, WEEKDAYS, cadenceChannels, channelMode, loadRules, scheduleContent, wallTime, type ChannelMode, type QueueItem, type ScheduleRules } from '@/lib/content-queue';
import type { LintIssue } from '@/lib/social/linkedin-copy';

/** After a change, bring social channels in step at once when this server has their credentials (else the next run). */
async function refresh() {
  const db = createClient();
  if (youtubeConfigured()) await postSocial(db, () => {}).catch(() => {});
  else if (linkedinConfigured()) await postLinkedinNow(db, () => {}).catch(() => {});
  revalidatePath('/foundry/queue');
}

/** Move a piece's per-piece posts with it. Cadence channels (LinkedIn) keep their own slot. */
async function setPostsTime(db: ReturnType<typeof createClient>, id: string, at: string | null) {
  const own = [...cadenceChannels(await loadRules(db))];
  let q = db.from('content_posts').update({ scheduled_at: at, updated_at: new Date().toISOString() }).eq('queue_id', id).neq('status', 'posted');
  if (own.length) q = q.not('channel', 'in', `(${own.join(',')})`);
  await q;
}

/** An editor's time (Sydney wall clock, "YYYY-MM-DDTHH:MM"). The assistant never moves it. */
export async function reschedule(id: string, local: string) {
  await requireAdmin();
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!m) throw new Error('Pick a date and time.');
  const db = createClient();
  const rules = await loadRules(db);
  const at = wallTime(m[1], m[2], rules.timezone);
  if (at.getTime() < Date.now() - 6e4) throw new Error('That time has passed. Use "Publish now" instead.');
  const { error } = await db.from('content_queue').update({ status: 'scheduled', scheduled_at: at.toISOString(), scheduled_by: 'editor', updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['ready', 'scheduled', 'held']);
  if (error) throw new Error(error.message);
  await setPostsTime(db, id, at.toISOString());
  await refresh();
}

/** Due now: Supabase publishes it within five minutes. */
export async function publishNow(id: string) {
  await requireAdmin();
  const db = createClient();
  const now = new Date().toISOString();
  const { error } = await db.from('content_queue').update({ status: 'scheduled', scheduled_at: now, scheduled_by: 'editor', updated_at: now })
    .eq('id', id).in('status', ['ready', 'scheduled', 'held']);
  if (error) throw new Error(error.message);
  await setPostsTime(db, id, now);
  await refresh();
}

export async function setStatus(id: string, status: 'held' | 'ready' | 'cancelled') {
  await requireAdmin();
  const db = createClient();
  const patch = { status, updated_at: new Date().toISOString(), ...(status === 'held' ? {} : { scheduled_at: null, scheduled_by: null }) };
  const { error } = await db.from('content_queue').update(patch).eq('id', id).in('status', ['ready', 'scheduled', 'held', 'failed']);
  if (error) throw new Error(error.message);
  if (status !== 'held') await setPostsTime(db, id, null);
  await refresh();
}

export async function planNow(): Promise<string[]> {
  await requireAdmin();
  const lines: string[] = [];
  const db = createClient();
  await scheduleContent(db, (m) => lines.push(m.trim()));
  await planLinkedin(db, (m) => lines.push(m.trim())).catch((e) => lines.push(`LinkedIn planning: ${e instanceof Error ? e.message : e}`));
  await refresh();
  return lines;
}

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Save the rules after checking every field, so the assistant never runs on a malformed set. */
export async function saveRules(rules: ScheduleRules) {
  await requireAdmin();
  const n = (v: unknown, lo: number, hi: number) => Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!n(rules.horizonDays, 1, 30) || !n(rules.minGapMinutes, 0, 1440) || !n(rules.eventBufferMinutes, 0, 1440)) throw new Error('Check the horizon, gap and buffer.');
  for (const [kind, slots] of Object.entries(rules.slots)) if (!(slots ?? []).every((s) => hhmm.test(s))) throw new Error(`${kind}: times must be HH:MM.`);
  for (const [kind, cap] of Object.entries(rules.caps)) {
    if (cap?.perDay != null && !n(cap.perDay, 0, 20)) throw new Error(`${kind}: a daily cap between 0 and 20.`);
    if (cap?.perWeek != null && !n(cap.perWeek, 0, 50)) throw new Error(`${kind}: a weekly cap between 0 and 50.`);
  }
  for (const days of Object.values(rules.days ?? {})) if (!(days ?? []).every((d) => (WEEKDAYS as readonly string[]).includes(d))) throw new Error('Unknown weekday.');
  for (const ch of Object.values(rules.channels)) if (!(ch ?? []).every((c) => (CHANNELS as readonly string[]).includes(c))) throw new Error('Unknown channel.');
  const db = createClient();
  const { installed: _installed, ...stored } = rules as ScheduleRules & { installed?: boolean };
  const current = await loadRules(db);
  // Which channels are connected is the poster's to record, not the form's; channel modes have their own toggle.
  const { error } = await db.from('schedule_rules').upsert({ id: 1, rules: { ...stored, connected: current.connected ?? [], channelModes: current.channelModes, cadence: current.cadence }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await refresh();
}

// ---------------------------------------------------------------------------------------------------- LinkedIn

type Db = ReturnType<typeof createClient>;

async function linkedinPost(db: Db, postId: string) {
  const { data: p, error } = await db.from('content_posts').select('*').eq('id', postId).eq('channel', 'linkedin').maybeSingle();
  if (error || !p) throw new Error(error?.message ?? 'No such LinkedIn post.');
  const { data: q } = await db.from('content_queue').select('*').eq('id', p.queue_id).maybeSingle();
  if (!q) throw new Error('The piece is no longer in the queue.');
  return { p, q: q as QueueItem };
}

/** Approve a LinkedIn post: only if its copy passes the checks now. It goes out at its slot (at once if that has passed). */
export async function approveLinkedin(postId: string) {
  const admin = await requireAdmin();
  const db = createClient();
  const { p, q } = await linkedinPost(db, postId);
  if (!['review', 'held', 'failed', 'scheduled'].includes(p.status)) throw new Error(`This post is ${p.status}; nothing to approve.`);
  const check = await recheck(db, q, p.caption ?? '', 'review');
  if (check.issues.length) {
    await db.from('content_posts').update({ status: 'held', lint: check.issues, updated_at: new Date().toISOString() }).eq('id', postId);
    revalidatePath('/foundry/queue');
    throw new Error(`Not approved: the copy fails ${check.issues.length} check(s). Edit it first.`);
  }
  const { error } = await db.from('content_posts').update({
    status: 'approved', caption: check.text, lint: [], error: null, approved_at: new Date().toISOString(), approved_by: admin.id, updated_at: new Date().toISOString(),
  }).eq('id', postId).eq('status', p.status);
  if (error) throw new Error(error.message);
  await refresh();
}

/** Save an edit to a LinkedIn post and check it again. Returns the findings (empty when it passes). */
export async function editLinkedin(postId: string, text: string): Promise<LintIssue[]> {
  await requireAdmin();
  const db = createClient();
  const { p, q } = await linkedinPost(db, postId);
  if (p.status === 'posted' || p.status === 'planned') throw new Error('This post has already gone out (or is going out); it cannot be edited here.');
  const rules = await loadRules(db);
  const check = await recheck(db, q, text, channelMode(rules, 'linkedin'));
  const { error } = await db.from('content_posts').update({
    caption: check.text, lint: check.issues, status: check.status, error: null, approved_at: null, approved_by: null, updated_at: new Date().toISOString(),
  }).eq('id', postId);
  if (error) throw new Error(error.message);
  revalidatePath('/foundry/queue');
  return check.issues;
}

/** Skip a LinkedIn post: the day goes without one (the piece is not offered to LinkedIn again). */
export async function skipLinkedin(postId: string) {
  await requireAdmin();
  const db = createClient();
  const { error } = await db.from('content_posts').update({ status: 'skipped', error: 'skipped by an editor', updated_at: new Date().toISOString() })
    .eq('id', postId).eq('channel', 'linkedin').in('status', ['review', 'held', 'approved', 'scheduled', 'failed']);
  if (error) throw new Error(error.message);
  revalidatePath('/foundry/queue');
}

/** Review (each post waits for approval) or auto (posts that pass the checks go out at their slot). */
export async function setChannelMode(channel: 'linkedin', mode: ChannelMode) {
  await requireAdmin();
  if (channel !== 'linkedin' || !['review', 'auto'].includes(mode)) throw new Error('Unknown channel or mode.');
  const db = createClient();
  const current = await loadRules(db);
  if (!current.installed) throw new Error('The queue tables are not installed.');
  const { installed: _installed, ...stored } = current;
  const { error } = await db.from('schedule_rules').update({ rules: { ...stored, channelModes: { ...stored.channelModes, [channel]: mode } }, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) throw new Error(error.message);
  // Posts that passed the checks follow the mode: waiting for review, or cleared for their slot. Approved ones stay approved.
  const [from, to] = mode === 'auto' ? ['review', 'scheduled'] : ['scheduled', 'review'];
  await db.from('content_posts').update({ status: to, updated_at: new Date().toISOString() }).eq('channel', channel).eq('status', from);
  await refresh();
}
