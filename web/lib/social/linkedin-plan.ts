/**
 * LinkedIn's cadence in the production queue: one post per weekday at about 8am Sydney (rules.cadence.linkedin). For
 * each day, pick the piece (planCadence in web/lib/content-queue.ts), draft the copy and check it
 * (web/lib/social/linkedin-copy.ts), and save the post as a content_posts row:
 *   'review'    passed the checks, waiting for an editor's approval (review mode)
 *   'scheduled' passed the checks, goes out at its slot (auto mode)
 *   'held'      failed the checks after one rewrite, with the findings in `lint`; an editor edits it
 * The poster (postLinkedin in web/lib/social-post.ts) sends what is cleared at or after the slot.
 */
import type { createClient } from '@/lib/supabase-server';
import {
  DEFAULT_RULES, channelMode, loadRules, planCadence, zoned,
  type CadenceCandidate, type CadenceExisting, type ChannelMode, type QueueItem, type QueueKind,
} from '@/lib/content-queue';
import { draftLinkedinCopy, lintLinkedin, type CopyPiece, type LintIssue } from '@/lib/social/linkedin-copy';

type Db = ReturnType<typeof createClient>;

/** Every string in a JSON value, so the figure check can see a story's whole text. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The piece's own words and who published its data: what every figure and quote in the post must come from. */
export async function pieceSource(db: Db, q: Pick<QueueItem, 'kind' | 'ref_slug' | 'title' | 'summary'>): Promise<CopyPiece> {
  const parts: string[] = [q.title, q.summary ?? ''];
  const orgs = new Set<string>();
  if (q.kind === 'visual' || q.kind === 'race') {
    const { data: v } = await db.from('visuals').select('title, subtitle, takeaways, alt, sources, spec').eq('slug', q.ref_slug).maybeSingle();
    if (v) {
      parts.push(...strings([v.title, v.subtitle, v.takeaways, v.alt]));
      for (const s of (v.sources ?? []) as { org?: string; dataset?: string }[]) { if (s.org) orgs.add(s.org); parts.push(`${s.org ?? ''} ${s.dataset ?? ''}`); }
      const spec = v.spec as { unit?: string; period?: string } | null;
      if (spec) parts.push(`${spec.unit ?? ''} ${spec.period ?? ''}`);
    }
  } else {
    const { data: s } = await db.from('stories').select('kicker, title, hook, caveat, one_number, evidence, body').eq('slug', q.ref_slug).maybeSingle();
    if (s) {
      parts.push(...strings([s.kicker, s.title, s.hook, s.caveat, s.one_number, s.body]));
      for (const e of strings(s.evidence)) parts.push(e);
      // Publishers named in the evidence (ABS, RBA, Treasury...) for attribution.
      for (const m of strings(s.evidence).join(' ').matchAll(/\b(ABS|RBA|Reserve Bank of Australia|Australian Bureau of Statistics|Treasury|APRA|ASIC|OECD|IMF|Productivity Commission|Parliamentary Budget Office)\b/g)) orgs.add(m[1]);
    }
  }
  return { kind: q.kind, title: q.title, summary: q.summary, source: parts.filter(Boolean).join('\n'), sources: [...orgs] };
}

/** The status a checked post gets: held with issues, else waiting for review or cleared for its slot. */
export const statusAfterCheck = (mode: ChannelMode, issues: LintIssue[]) => (issues.length ? 'held' : mode === 'review' ? 'review' : 'scheduled');

/**
 * Plan LinkedIn for today and the next day: pick each weekday's piece and draft its post. Returns a line per change.
 * Runs whether or not LinkedIn is connected, so drafts are there to review before the account is.
 */
export async function planLinkedin(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  const rules = await loadRules(db);
  if (!rules.installed || !rules.enabled) return [];
  const cadence = rules.cadence?.linkedin ?? DEFAULT_RULES.cadence!.linkedin!;
  const mode = channelMode(rules, 'linkedin');
  const tz = rules.timezone;
  const now = new Date();
  const since = new Date(now.getTime() - 3 * 864e5).toISOString();
  const until = new Date(now.getTime() + (cadence.aheadDays + 2) * 864e5).toISOString();
  const [{ data: qs }, { data: posts, error: postsError }] = await Promise.all([
    db.from('content_queue').select('*').in('status', ['scheduled', 'published'])
      .or(`and(status.eq.scheduled,scheduled_at.lte.${until}),and(status.eq.published,published_at.gte.${since})`),
    db.from('content_posts').select('id, queue_id, status, scheduled_at').eq('channel', 'linkedin'),
  ]);
  if (postsError) { log(`LinkedIn: ${postsError.message}`); return []; }
  const queue = new Map(((qs ?? []) as QueueItem[]).map((q) => [q.id, q]));
  const candidates: CadenceCandidate[] = [...queue.values()].map((q) => ({
    id: q.id, kind: q.kind, status: q.status, siteAt: new Date((q.status === 'published' ? q.published_at : q.scheduled_at) as string),
  })).filter((c) => Number.isFinite(c.siteAt.getTime()));
  // Every piece that already has a LinkedIn row (any status, skipped included) is never picked again.
  const used = new Set((posts ?? []).map((p) => p.queue_id as string));
  const existing: CadenceExisting[] = (posts ?? []).filter((p) => p.scheduled_at && p.status !== 'skipped').map((p) => ({
    postId: p.id as string, day: zoned(new Date(p.scheduled_at as string), tz).day, queueId: p.queue_id as string,
    kind: (queue.get(p.queue_id as string)?.kind ?? 'article') as QueueKind, status: p.status as string,
  }));
  const plan = planCadence(cadence, tz, candidates, existing, used, now);
  const lines: string[] = [];
  for (const step of plan) {
    const q = queue.get(step.pick.id)!;
    const piece = await pieceSource(db, q);
    const copy = await draftLinkedinCopy(piece);
    const status = statusAfterCheck(mode, copy.issues);
    if (step.replaces) await db.from('content_posts').delete().eq('id', step.replaces).in('status', ['review', 'held', 'scheduled']);
    const { error } = await db.from('content_posts').insert({
      queue_id: q.id, channel: 'linkedin', status, scheduled_at: step.at.toISOString(), caption: copy.text,
      lint: copy.issues, error: null, updated_at: now.toISOString(),
    });
    if (error) {
      const hint = /check constraint|column .*lint/i.test(error.message) ? ' (run agent/supabase/50_linkedin_channel.sql)' : '';
      lines.push(`  LinkedIn ${step.day}: could not save the post for ${q.title}: ${error.message}${hint}`);
      continue;
    }
    lines.push(`  LinkedIn ${step.day} ${cadence.slot}  ${q.kind.padEnd(7)} ${q.title}  [${status}${copy.issues.length ? `: ${copy.issues.length} issue(s)` : ''}]${step.replaces ? ' (replaces a graphic: the day now has a lead story)' : ''}`);
  }
  for (const l of lines) log(l);
  return lines;
}

/** Re-check a post after an edit; returns the issues and the status it should take. */
export async function recheck(db: Db, q: QueueItem, text: string, mode: ChannelMode) {
  const piece = await pieceSource(db, q);
  const lint = lintLinkedin(text, piece.source);
  return { text: lint.text, issues: lint.issues, status: statusAfterCheck(mode, lint.issues) };
}
