'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { postSocial } from '@/lib/social-post';
import { youtubeConfigured } from '@/lib/social/youtube';
import { CHANNELS, WEEKDAYS, loadRules, scheduleContent, wallTime, type ScheduleRules } from '@/lib/content-queue';

/** After a change, bring social channels in step at once when this server has their credentials (else the next run). */
async function refresh() {
  if (youtubeConfigured()) await postSocial(createClient(), () => {}).catch(() => {});
  revalidatePath('/foundry/queue');
}

async function setPostsTime(db: ReturnType<typeof createClient>, id: string, at: string | null) {
  await db.from('content_posts').update({ scheduled_at: at, updated_at: new Date().toISOString() }).eq('queue_id', id).neq('status', 'posted');
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
  await scheduleContent(createClient(), (m) => lines.push(m.trim()));
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
  // Which channels are connected is the poster's to record, not the form's.
  const { error } = await db.from('schedule_rules').upsert({ id: 1, rules: { ...stored, connected: current.connected ?? [] }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await refresh();
}
