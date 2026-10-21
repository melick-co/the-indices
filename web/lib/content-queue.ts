/**
 * The production queue (agent/supabase/42_production_queue.sql).
 *
 * Generators hand finished pieces to the queue as 'ready' instead of publishing them. The scheduling assistant
 * (scheduleContent) puts each ready piece in a slot within the rules: caps per day or week, the preferred times, a
 * minimum gap between any two pieces, and clear of scheduled data releases. It orders the pieces and writes a caption
 * per channel with the model; the slots, caps and gaps are always the rules', never the model's. At the slot,
 * publish_due_content() (pg_cron) publishes on the site. Social channels are planned but stay 'not_connected' until
 * each account is connected.
 *
 * Some channels run on their own cadence instead of one post per piece (rules.cadence): LinkedIn gets one post per
 * weekday at about 8am Sydney, the day's lead story, else a graphic or race from that day or the day before
 * (planCadence, web/lib/social/linkedin-plan.ts). Each channel also has a mode (rules.channelModes): 'review' holds
 * every post for an editor's one-click approval on the Queue page; 'auto' posts at the slot. Same checks either way.
 */
import type { createClient } from '@/lib/supabase-server';

type Db = ReturnType<typeof createClient>;

export const CHANNELS = ['site', 'youtube', 'tiktok', 'instagram', 'facebook', 'x', 'linkedin'] as const;
export type Channel = (typeof CHANNELS)[number];
export type QueueKind = 'article' | 'visual' | 'race' | 'breaking' | 'hero_video' | 'reel';
export type QueueStatus = 'ready' | 'scheduled' | 'published' | 'held' | 'cancelled' | 'failed';
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type ScheduleRules = {
  enabled: boolean;
  timezone: string;
  horizonDays: number;
  minGapMinutes: number;
  eventBufferMinutes: number;
  caps: Partial<Record<QueueKind, { perDay?: number; perWeek?: number }>>;
  slots: Partial<Record<QueueKind, string[]>>;
  days?: Partial<Record<QueueKind, (typeof WEEKDAYS)[number][]>>;
  channels: Partial<Record<QueueKind, Channel[]>>;
  /** Channels whose credentials have worked (the poster records this), so their posts are planned as scheduled. */
  connected?: Channel[];
  /** 'review': each post waits for an editor's approval; 'auto': it goes out at its slot. Unset means auto. */
  channelModes?: Partial<Record<Channel, ChannelMode>>;
  /** Channels planned on their own cadence (one post a day) rather than one post per piece. */
  cadence?: Partial<Record<Channel, Cadence>>;
};

export type ChannelMode = 'review' | 'auto';
export type Weekday = (typeof WEEKDAYS)[number];
export type Cadence = {
  /** Sydney wall-clock time of the day's post. */
  slot: string;
  days: Weekday[];
  /** How many days ahead to plan (0 = today only). Short, so a better lead story can still take the slot. */
  aheadDays: number;
};

export const DEFAULT_RULES: ScheduleRules = {
  enabled: true, timezone: 'Australia/Sydney', horizonDays: 7, minGapMinutes: 90, eventBufferMinutes: 120,
  caps: { article: { perDay: 2 }, visual: { perDay: 1 }, race: { perWeek: 1 } },
  slots: { article: ['07:00', '12:30'], visual: ['09:30', '15:00'], race: ['18:00'] },
  days: { race: ['tue', 'wed', 'thu'] },
  channels: {
    article: ['site', 'x', 'facebook'],
    visual: ['site', 'instagram', 'facebook', 'x'],
    race: ['site', 'youtube', 'tiktok', 'instagram', 'facebook', 'x'],
  },
  // LinkedIn: one post a weekday at 8am, no weekends to start with. Review first: nothing posts without approval.
  channelModes: { linkedin: 'review' },
  cadence: { linkedin: { slot: '08:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'], aheadDays: 1 } },
};

/** A channel's mode; LinkedIn defaults to review even if a stored rule set predates the setting. */
export const channelMode = (rules: ScheduleRules, ch: Channel): ChannelMode =>
  rules.channelModes?.[ch] ?? DEFAULT_RULES.channelModes?.[ch] ?? 'auto';

/** Channels on their own cadence: never planned per piece, even if a stored rule set still lists them. */
export const cadenceChannels = (rules: ScheduleRules): Set<Channel> =>
  new Set(Object.keys({ ...DEFAULT_RULES.cadence, ...rules.cadence }) as Channel[]);

/** The per-piece channels for a kind (the site plus every channel not on its own cadence). */
export const pieceChannels = (rules: ScheduleRules, kind: QueueKind): Channel[] => {
  const own = cadenceChannels(rules);
  return (rules.channels[kind] ?? ['site']).filter((c) => !own.has(c));
};

export type QueueItem = {
  id: string; kind: QueueKind; ref_slug: string; title: string; summary: string | null; media: Record<string, unknown>;
  status: QueueStatus; priority: number; scheduled_at: string | null; published_at: string | null;
  scheduled_by: 'assistant' | 'editor' | null; reason: string | null; error: string | null; created_at: string;
};
export type QueuePost = {
  id: string; queue_id: string; channel: Channel; status: string; scheduled_at: string | null; posted_at: string | null;
  caption: string | null; external_url: string | null; error: string | null;
  /** The copy check's findings (LinkedIn; 50_linkedin_channel.sql). Empty when the copy passed. */
  lint?: { code: string; message: string }[] | null;
  approved_at?: string | null;
};

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://caveat.news').replace(/\/$/, '');
export const itemUrl = (i: { kind: QueueKind; ref_slug: string }) =>
  `${SITE}${i.kind === 'visual' || i.kind === 'race' ? `/indices/visuals/${i.ref_slug}` : `/stories/${i.ref_slug}`}`;

/** The rules, or the defaults if the table isn't there yet (SQL not run): then the queue is off. */
export async function loadRules(db: Db): Promise<ScheduleRules & { installed: boolean }> {
  const { data, error } = await db.from('schedule_rules').select('rules').eq('id', 1).maybeSingle();
  if (error || !data) return { ...DEFAULT_RULES, enabled: false, installed: false };
  return { ...DEFAULT_RULES, ...(data.rules as Partial<ScheduleRules>), installed: true };
}

/** True when generators should queue their output rather than publish it. */
export async function queueEnabled(db: Db): Promise<boolean> {
  const r = await loadRules(db);
  return r.installed && r.enabled;
}

/** Hand a finished piece to the queue. A piece already queued (or published through it) is left as it is. */
export async function enqueue(db: Db, item: { kind: QueueKind; ref_slug: string; title: string; summary?: string | null; media?: Record<string, unknown>; priority?: number }) {
  const { error } = await db.from('content_queue').upsert({
    kind: item.kind, ref_slug: item.ref_slug, title: item.title, summary: item.summary ?? null, media: item.media ?? {},
    priority: item.priority ?? 0, status: 'ready',
  }, { onConflict: 'kind,ref_slug', ignoreDuplicates: true });
  if (error) throw new Error(`enqueue ${item.kind} ${item.ref_slug}: ${error.message}`);
}

// ---------------------------------------------------------------------------------------------------- time

/** Parts of an instant in a time zone. */
export function zoned(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: String(p.weekday).toLowerCase().slice(0, 3), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** The instant of a wall-clock time (YYYY-MM-DD, HH:MM) in a time zone. */
export function wallTime(day: string, hhmm: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, h, mi);
  // Two passes settle the offset, including across a daylight-saving change.
  for (let i = 0; i < 2; i++) {
    const z = zoned(new Date(t), tz);
    const [zy, zm, zd] = z.day.split('-').map(Number);
    const shown = Date.UTC(zy, zm - 1, zd, Math.floor(z.minutes / 60), z.minutes % 60);
    t += Date.UTC(y, m - 1, d, h, mi) - shown;
  }
  return new Date(t);
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Monday of the day's week, as YYYY-MM-DD: the week a weekly cap counts in. */
function weekOf(day: string) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

// ---------------------------------------------------------------------------------------------------- planner

export type Taken = { kind: QueueKind; at: Date };

/**
 * Slot the items (already in priority order) into the earliest times the rules allow. Pure: no database, so the
 * rules can be tested. Returns a time per item that got one; the rest stay ready.
 */
export function planSlots(rules: ScheduleRules, items: { id: string; kind: QueueKind }[], taken: Taken[], events: Date[], now: Date): Map<string, Date> {
  const tz = rules.timezone, out = new Map<string, Date>();
  const busy = [...taken];
  const earliest = now.getTime() + 15 * 6e4;
  const today = zoned(now, tz).day;
  const candidates = (kind: QueueKind) => {
    const list: Date[] = [];
    for (let i = 0; i <= rules.horizonDays; i++) {
      const day = addDays(today, i);
      const allowed = rules.days?.[kind];
      if (allowed?.length && !allowed.includes(zoned(wallTime(day, '12:00', tz), tz).weekday as never)) continue;
      for (const s of rules.slots[kind] ?? []) list.push(wallTime(day, s, tz));
    }
    return list.filter((d) => d.getTime() >= earliest).sort((a, b) => a.getTime() - b.getTime());
  };
  const fits = (kind: QueueKind, at: Date) => {
    const cap = rules.caps[kind] ?? {};
    const day = zoned(at, tz).day, week = weekOf(day);
    const same = busy.filter((b) => b.kind === kind);
    if (cap.perDay != null && same.filter((b) => zoned(b.at, tz).day === day).length >= cap.perDay) return false;
    if (cap.perWeek != null && same.filter((b) => weekOf(zoned(b.at, tz).day) === week).length >= cap.perWeek) return false;
    if (busy.some((b) => Math.abs(b.at.getTime() - at.getTime()) < rules.minGapMinutes * 6e4)) return false;
    if (events.some((e) => Math.abs(e.getTime() - at.getTime()) < rules.eventBufferMinutes * 6e4)) return false;
    return true;
  };
  for (const item of items) {
    const at = candidates(item.kind).find((c) => fits(item.kind, c));
    if (!at) continue;
    out.set(item.id, at);
    busy.push({ kind: item.kind, at });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- cadence

/** A piece a cadence channel could post: its site time is when it went (or goes) live. */
export type CadenceCandidate = { id: string; kind: QueueKind; status: QueueStatus; siteAt: Date };
/** A cadence post already planned for a day. */
export type CadenceExisting = { postId: string; day: string; queueId: string; kind: QueueKind; status: string };
export type CadencePlan = { day: string; at: Date; pick: CadenceCandidate; replaces?: string };

const LEAD_KINDS: QueueKind[] = ['article', 'breaking'];
const FALLBACK_KINDS: QueueKind[] = ['visual', 'race'];
/** Post statuses an editor has not yet acted on, so a better pick may still replace them. */
const REPLACEABLE = new Set(['review', 'held', 'scheduled']);

/**
 * The piece for a day's slot: the day's lead story (the newest article live on the site by the slot that day), else
 * the newest graphic or race live by the slot and published that day or the day before. Pieces already used on the
 * channel are skipped. Pure, so the rule can be tested.
 */
export function pickForSlot(candidates: CadenceCandidate[], day: string, slotAt: Date, tz: string, used: Set<string>): CadenceCandidate | null {
  const live = candidates.filter((c) => !used.has(c.id) && (c.status === 'scheduled' || c.status === 'published') && c.siteAt.getTime() <= slotAt.getTime());
  const newest = (xs: CadenceCandidate[]) => xs.sort((a, b) => b.siteAt.getTime() - a.siteAt.getTime())[0] ?? null;
  const lead = newest(live.filter((c) => LEAD_KINDS.includes(c.kind) && zoned(c.siteAt, tz).day === day));
  if (lead) return lead;
  const yesterday = addDays(day, -1);
  return newest(live.filter((c) => FALLBACK_KINDS.includes(c.kind) && [day, yesterday].includes(zoned(c.siteAt, tz).day)));
}

/**
 * Plan a cadence channel: for today and the next aheadDays, on the allowed weekdays, one post at the slot. A day that
 * already has a post keeps it, unless an editor has not acted on it yet, it is a graphic or race, and a lead story
 * has since been scheduled for that day: then the story replaces it. Today's slot is planned up to two hours after
 * it passes (a late runner still posts the morning's story); after that the day is left alone.
 */
export function planCadence(cadence: Cadence, tz: string, candidates: CadenceCandidate[], existing: CadenceExisting[], used: Set<string>, now: Date): CadencePlan[] {
  const out: CadencePlan[] = [];
  const taken = new Set(used);
  const today = zoned(now, tz).day;
  for (let i = 0; i <= cadence.aheadDays; i++) {
    const day = addDays(today, i);
    if (!cadence.days.includes(zoned(wallTime(day, '12:00', tz), tz).weekday as Weekday)) continue;
    const at = wallTime(day, cadence.slot, tz);
    if (at.getTime() < now.getTime() - 2 * 36e5) continue;
    const have = existing.find((e) => e.day === day);
    if (have) {
      if (!REPLACEABLE.has(have.status) || LEAD_KINDS.includes(have.kind) || at.getTime() <= now.getTime()) continue;
      const better = pickForSlot(candidates.filter((c) => LEAD_KINDS.includes(c.kind)), day, at, tz, taken);
      if (better) { out.push({ day, at, pick: better, replaces: have.postId }); taken.add(better.id); }
      continue;
    }
    const pick = pickForSlot(candidates, day, at, tz, taken);
    if (pick) { out.push({ day, at, pick }); taken.add(pick.id); }
  }
  return out;
}

/** Posts older than this past their slot are not sent: a morning post that missed the morning is skipped. */
export const CADENCE_STALE_MS = 6 * 36e5;
export type CadenceDecision = 'post' | 'wait' | 'stale' | 'withdraw' | 'unplan';

/**
 * What the poster does with a cadence post now. Review mode posts only what an editor approved; auto mode posts what
 * passed the checks ('scheduled') or was approved. Nothing posts before its slot or before the piece is live on the
 * site (the link must work). A piece held, removed or failed in the queue is withdrawn (deleted if already posted);
 * one sent back to 'ready' loses its slot, so the day can be planned again.
 */
export function cadenceDecision(mode: ChannelMode, post: { status: string; scheduled_at: string | null }, queueStatus: QueueStatus, now: Date): CadenceDecision {
  if (['held', 'cancelled', 'failed'].includes(queueStatus)) return post.status === 'skipped' ? 'wait' : 'withdraw';
  if (post.status === 'posted' || post.status === 'skipped' || post.status === 'planned') return 'wait';
  if (queueStatus === 'ready') return 'unplan';
  const slot = post.scheduled_at ? Date.parse(post.scheduled_at) : NaN;
  if (!Number.isFinite(slot)) return 'wait';
  if (now.getTime() - slot > CADENCE_STALE_MS) return 'stale';
  const cleared = mode === 'review' ? post.status === 'approved' : post.status === 'approved' || post.status === 'scheduled';
  if (!cleared || slot > now.getTime() || queueStatus !== 'published') return 'wait';
  return 'post';
}

// ---------------------------------------------------------------------------------------------------- assistant

type Advice = { order: string[]; notes: Record<string, string>; captions: Record<string, Partial<Record<Channel, string>>> };

/** Every number in a caption must appear in the piece's own words, or the caption isn't used. */
export function captionNumbersOk(caption: string, source: string): boolean {
  const nums = (s: string) => (s.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []);
  const have = new Set(nums(source));
  return nums(caption).every((n) => have.has(n));
}

/** The model orders the ready pieces and writes captions; if it is unavailable, oldest first and no captions. */
async function advise(items: QueueItem[], upcoming: { title: string; at: string }[], recent: string[], rules: ScheduleRules): Promise<Advice> {
  const fallback: Advice = { order: [...items].sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at)).map((i) => i.id), notes: {}, captions: {} };
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || !items.length) return fallback;
  const pieces = items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, summary: i.summary, channels: pieceChannels(rules, i.kind).filter((c) => c !== 'site'), waiting_since: i.created_at.slice(0, 10) }));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 3000,
        system: [
          'You are the scheduling editor for Caveat, an Australian data journalism site, and Caveat Indices, its data dashboards and graphics.',
          'Order the ready pieces for publication: timely pieces first (tied to a coming data release or a topic in the news), then variety, so the same topic does not run back to back, then the oldest.',
          'For each piece, write one short note on why it sits where it does, and a caption for each listed social channel.',
          'Captions: Australian English, no em dashes, plain and factual, no hype. Use only numbers that appear in the title or summary, and name what each number measures exactly as the piece does (trips abroad by Australians are not visitors; residents born overseas are not arrivals). No more than two hashtags. Do not include a link (it is added).',
          // LinkedIn copy is written separately, on its own cadence (web/lib/social/linkedin-copy.ts).
          'x: under 240 characters. instagram, facebook, tiktok, youtube: one or two sentences.',
          'Reply with JSON only: {"order":[ids],"notes":{id:text},"captions":{id:{channel:text}}}.',
        ].join(' '),
        messages: [{ role: 'user', content: JSON.stringify({ pieces, coming_releases: upcoming, recently_published: recent }) }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return fallback;
    const body = await res.json() as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Advice;
    const ids = new Set(items.map((i) => i.id));
    const order = [...new Set((json.order ?? []).filter((id) => ids.has(id)))];
    for (const id of fallback.order) if (!order.includes(id)) order.push(id);
    return { order, notes: json.notes ?? {}, captions: json.captions ?? {} };
  } catch {
    return fallback;
  }
}

/** The site, plus every channel the poster has connected with working credentials. */
export function connectedChannels(rules: ScheduleRules): Set<Channel> {
  return new Set<Channel>(['site', ...(rules.connected ?? [])]);
}

/**
 * The scheduling assistant: slot every ready piece the rules have room for, and plan its posts. Pieces an editor
 * scheduled by hand are never moved. Returns a line per piece for the log.
 */
export async function scheduleContent(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  const rules = await loadRules(db);
  if (!rules.installed) { log('Queue tables not installed (run agent/supabase/42_production_queue.sql).'); return []; }
  if (!rules.enabled) { log('Queue is off; nothing to schedule.'); return []; }
  const now = new Date();
  const since = new Date(now.getTime() - 8 * 864e5).toISOString();
  const [{ data: ready }, { data: booked }, { data: ev }, { data: recent }] = await Promise.all([
    db.from('content_queue').select('*').eq('status', 'ready').order('created_at'),
    db.from('content_queue').select('kind, scheduled_at, published_at, status').or(`status.eq.scheduled,and(status.eq.published,published_at.gte.${since})`),
    db.from('events').select('title, scheduled_at, status').in('status', ['scheduled', 'due']).gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', new Date(now.getTime() + (rules.horizonDays + 1) * 864e5).toISOString()),
    db.from('content_queue').select('title').eq('status', 'published').order('published_at', { ascending: false }).limit(10),
  ]);
  const items = ((ready ?? []) as QueueItem[]).filter((i) => rules.slots[i.kind]?.length);
  if (!items.length) { log('Nothing ready to schedule.'); return []; }
  const taken: Taken[] = (booked ?? []).map((b) => ({ kind: b.kind as QueueKind, at: new Date((b.status === 'published' ? b.published_at : b.scheduled_at) as string) }));
  const events = (ev ?? []).map((e) => new Date(e.scheduled_at as string));
  const advice = await advise(items, (ev ?? []).map((e) => ({ title: String(e.title), at: String(e.scheduled_at) })), (recent ?? []).map((r) => String(r.title)), rules);
  const ordered = advice.order.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
  const slots = planSlots(rules, ordered, taken, events, now);
  const connected = connectedChannels(rules);
  const lines: string[] = [];
  for (const item of ordered) {
    const at = slots.get(item.id);
    if (!at) { lines.push(`  waiting  ${item.kind.padEnd(7)} ${item.title} (no room within ${rules.horizonDays} days)`); continue; }
    const when = at.toISOString();
    const { error } = await db.from('content_queue').update({ status: 'scheduled', scheduled_at: when, scheduled_by: 'assistant', reason: advice.notes[item.id] ?? null, updated_at: now.toISOString() })
      .eq('id', item.id).eq('status', 'ready');
    if (error) { lines.push(`  failed   ${item.title}: ${error.message}`); continue; }
    const source = `${item.title} ${item.summary ?? ''}`;
    const posts = pieceChannels(rules, item.kind).map((channel) => {
      const draft = advice.captions[item.id]?.[channel];
      const caption = channel === 'site' ? null : (draft && captionNumbersOk(draft, source) ? draft : item.title);
      return { queue_id: item.id, channel, status: connected.has(channel) ? 'scheduled' : 'not_connected', scheduled_at: when, caption, updated_at: now.toISOString() };
    });
    await db.from('content_posts').upsert(posts, { onConflict: 'queue_id,channel' });
    lines.push(`  ${at.toLocaleString('en-AU', { timeZone: rules.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}  ${item.kind.padEnd(7)} ${item.title}`);
  }
  for (const l of lines) log(l);
  return lines;
}
