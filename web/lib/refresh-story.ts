import { createClient } from '@/lib/supabase-server';
import { checkStory, draftStory, type PriorArticle } from '@/lib/generate-story';
import type { StructuredStory } from '@/lib/article-from-pitch';
import type { FoundryEvent } from '@/lib/foundry-agent';
import type { FactCheck } from '@/lib/fact-check';
import type { StoryBlock } from '@/lib/story-types';
import { loadPendingRevision } from '@/lib/stories-loader';

/** The article fields a revision replaces. Placement, art and dates are left alone. */
const CONTENT_COLS = ['kicker', 'title', 'hook', 'caveat', 'one_number', 'evidence', 'body', 'frame_check'] as const;
// A revision also keeps the metric ids its copy quotes, so a re-check audits against the same series.
type Content = Record<(typeof CONTENT_COLS)[number], unknown> & { metric_ids_used?: string[] };

export const DEFAULT_UPDATE_NOTE =
  'Rewritten in our news format, with every figure re-checked against the latest official data.';

const pick = (row: Record<string, unknown>): Content =>
  Object.fromEntries(CONTENT_COLS.map((k) => [k, row[k]])) as Content;

/** Revision content: the article fields plus the metric ids its copy quotes. */
const pickRevision = (row: Record<string, unknown>): Content => ({
  ...pick(row),
  ...(Array.isArray(row.metric_ids_used) && row.metric_ids_used.length ? { metric_ids_used: row.metric_ids_used as string[] } : {}),
});

/** Plain text of an article body, for the writer's brief. */
function bodyText(blocks: StoryBlock[]): string {
  return blocks.flatMap((b) => {
    if (b.type === 'paragraph' || b.type === 'pull') return [b.text];
    if (b.type === 'layers') return b.items;
    return [];
  }).join('\n\n');
}

async function loadPublished(slug: string) {
  const db = createClient();
  const { data, error } = await db.from('stories').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No database story at /stories/${slug}`);
  if (data.status !== 'published') throw new Error(`/stories/${slug} is ${data.status}, not published`);
  return data as Record<string, unknown> & { story_id: string; pitch_id: string | null; slug: string };
}

/**
 * Rewrite a published article through the same writer and checks as a new one, and save the result as a
 * pending revision. The live article does not change until applyRevision.
 */
export async function refreshStory(
  slug: string,
  onEvent: (event: FoundryEvent) => void,
  brief?: string,
): Promise<{ revisionId: string; title: string; check: FactCheck }> {
  const db = createClient();
  // Fail before the (slow) rewrite if the revisions table is missing (agent/supabase/32_story_revisions.sql).
  const { error: tableErr } = await db.from('story_revisions').select('revision_id').limit(1);
  if (tableErr) throw new Error(`story_revisions is not available (run agent/supabase/32_story_revisions.sql): ${tableErr.message}`);
  const row = await loadPublished(slug);
  if (!row.pitch_id) throw new Error(`/stories/${slug} has no pitch to write from`);
  const { data: pitch } = await db.from('pitches').select('*').eq('id', row.pitch_id).single();
  if (!pitch) throw new Error(`Pitch ${row.pitch_id} not found`);

  const prior: PriorArticle = {
    title: String(row.title),
    hook: String(row.hook),
    published: String(row.published),
    text: bodyText(((row.body as { blocks?: StoryBlock[] })?.blocks) ?? []),
    brief: brief?.trim() || undefined,
  };
  const { story, check, ids } = await draftStory(db, pitch, onEvent, { audit: true, prior });

  const content: Content = {
    kicker: story.kicker,
    title: story.title,
    hook: story.hook,
    caveat: story.caveat,
    one_number: story.one_number,
    evidence: { ...story.evidence, metric_ids: [...ids] },
    body: story.body,
    frame_check: Boolean(story.frame_check),
    metric_ids_used: story.metric_ids_used ?? [],
  };
  const now = new Date().toISOString();
  await db.from('story_revisions').update({ status: 'discarded', resolved_at: now })
    .eq('story_id', row.story_id).eq('status', 'pending');
  const { data: rev, error } = await db.from('story_revisions').insert({
    story_id: row.story_id,
    status: 'pending',
    content,
    check: { ok: check.ok, issues: check.issues, warnings: check.warnings ?? [] },
    note: story.generation_note,
  }).select('revision_id').single();
  if (error || !rev) throw new Error(error?.message ?? 'could not save the revision');
  return { revisionId: rev.revision_id, title: story.title, check };
}

/**
 * Put the pending revision live: archive the current version, replace the content, and add the update note.
 * Refuses a revision that failed its checks unless forced.
 */
export async function applyRevision(slug: string, opts: { note?: string; force?: boolean } = {}) {
  const db = createClient();
  const row = await loadPublished(slug);
  const pending = await loadPendingRevision(row.story_id);
  if (!pending) throw new Error(`/stories/${slug} has no pending revision`);
  if (!pending.check?.ok && !opts.force) {
    throw new Error(`the revision for /stories/${slug} failed its checks: ${(pending.check?.issues ?? []).slice(0, 4).join('; ')}`);
  }
  const now = new Date().toISOString();
  const { error: archiveErr } = await db.from('story_revisions').insert({
    story_id: row.story_id,
    status: 'archived',
    content: { ...pick(row), published: row.published, updated_on: row.updated_on, update_note: row.update_note },
    note: 'Version replaced by a refresh',
    resolved_at: now,
  });
  if (archiveErr) throw new Error(archiveErr.message);
  const { error } = await db.from('stories').update({
    ...pick(pending.content as Record<string, unknown>),
    update_note: opts.note ?? DEFAULT_UPDATE_NOTE,
    updated_on: now.slice(0, 10),
    updated_at: now,
  }).eq('story_id', row.story_id);
  if (error) throw new Error(error.message);
  await db.from('story_revisions').update({ status: 'applied', resolved_at: now }).eq('revision_id', pending.revision_id);
  return { slug, title: String(pending.content.title) };
}

/** Stored check result: what the desk shows next to a draft or revision. */
export type StoredCheck = { ok: boolean; issues: string[]; warnings: string[]; checked_at: string };

/** Metric ids the copy may quote: the pitch's links plus everything the story's charts use. */
async function pitchMetricIds(pitchId: string | null): Promise<string[]> {
  if (!pitchId) return [];
  const { data } = await createClient().from('pitches').select('metric_ids, resurface_metrics').eq('id', pitchId).maybeSingle();
  return [...new Set([...(data?.metric_ids ?? []), ...(data?.resurface_metrics ?? [])])] as string[];
}

/**
 * Run every publishing check on edited copy, without rewriting it (the desk's "Re-check").
 * Returns the checked content: unverifiable quotes removed, charts and the hero number refilled from the store.
 */
async function recheck(content: Content, pitchId: string | null): Promise<{ content: Content; check: StoredCheck }> {
  const db = createClient();
  // Series the copy quotes: kept on the revision and in evidence.metric_ids (saved with every article since Oct 2026).
  const saved = ((content.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  const used = [...new Set([...(content.metric_ids_used ?? []), ...saved])];
  const draft = { ...(content as unknown as StructuredStory), slug_hint: '', generation_note: '', metric_ids_used: used };
  const { check, ids } = await checkStory(db, draft, { metricIds: await pitchMetricIds(pitchId), audit: true });
  draft.evidence = { ...draft.evidence, metric_ids: [...ids] };
  return {
    content: pickRevision(draft as unknown as Record<string, unknown>),
    check: { ok: check.ok, issues: check.issues, warnings: check.warnings ?? [], checked_at: new Date().toISOString() },
  };
}

/** Save editor changes to a story's pending revision. */
export async function saveRevisionContent(slug: string, content: Content) {
  const row = await loadPublished(slug);
  const pending = await loadPendingRevision(row.story_id);
  if (!pending) throw new Error(`/stories/${slug} has no pending revision`);
  const { error } = await createClient().from('story_revisions')
    // Keep the metric ids the revision already quotes when the editor's copy does not carry them (desk saves).
    .update({
      content: pickRevision({
        metric_ids_used: (pending.content as Record<string, unknown>).metric_ids_used,
        ...(content as Record<string, unknown>),
      }),
      check: { ...(pending.check ?? {}), ok: false, stale: true },
    })
    .eq('revision_id', pending.revision_id);
  if (error) throw new Error(error.message);
}

/** Re-check a pending revision after editing, and store the result. */
export async function recheckRevision(slug: string): Promise<StoredCheck> {
  const row = await loadPublished(slug);
  const pending = await loadPendingRevision(row.story_id);
  if (!pending) throw new Error(`/stories/${slug} has no pending revision`);
  const { content, check } = await recheck(pending.content as unknown as Content, row.pitch_id);
  const { error } = await createClient().from('story_revisions')
    .update({ content, check }).eq('revision_id', pending.revision_id);
  if (error) throw new Error(error.message);
  return check;
}

/** Drop a pending revision; the live article is untouched. */
export async function discardRevision(slug: string) {
  const row = await loadPublished(slug);
  const { error } = await createClient().from('story_revisions')
    .update({ status: 'discarded', resolved_at: new Date().toISOString() })
    .eq('story_id', row.story_id).eq('status', 'pending');
  if (error) throw new Error(error.message);
}

/** Re-check a draft story in place after editing (charts refilled, unverifiable quotes removed). */
export async function recheckDraft(slug: string, extraMetrics: string[] = []): Promise<StoredCheck> {
  const db = createClient();
  const row = await loadDraft(slug);
  const { content, check } = await recheck({ ...pick(row), metric_ids_used: extraMetrics }, row.pitch_id as string | null);
  // Only the article columns go back on the story row (metric ids live on revisions, not stories).
  const { error } = await db.from('stories').update({ ...pick(content as Record<string, unknown>), updated_at: new Date().toISOString() }).eq('slug', slug);
  if (error) throw new Error(error.message);
  return check;
}

async function loadDraft(slug: string) {
  const { data: row } = await createClient().from('stories').select('*').eq('slug', slug).maybeSingle();
  if (!row) throw new Error(`No database story at /stories/${slug}`);
  if (row.status !== 'draft') throw new Error(`/stories/${slug} is ${row.status}, not a draft`);
  return row as Record<string, unknown>;
}

/** Draft stories awaiting the editor, newest first. */
export async function listDrafts() {
  const { data, error } = await createClient().from('stories')
    .select('slug, title, updated_at, pitch_id').eq('status', 'draft').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** A draft's copy, in the same shape as a revision's. */
export async function loadDraftContent(slug: string): Promise<Content> {
  return pick(await loadDraft(slug));
}

/** Apply exact-text edits to a draft, then re-check it. */
export async function editDraft(slug: string, edits: CopyEdit[], extraMetrics: string[] = [], dropBlocks: number[] = []): Promise<StoredCheck> {
  const content = await loadDraftContent(slug);
  if (dropBlocks.length) {
    const body = content.body as { blocks: unknown[] };
    body.blocks = body.blocks.filter((_, i) => !dropBlocks.includes(i));
  }
  const edited = edits.length ? editContent(content, edits) : content;
  const { error } = await createClient().from('stories')
    .update({ ...pick(edited as Record<string, unknown>), updated_at: new Date().toISOString() }).eq('slug', slug);
  if (error) throw new Error(error.message);
  return recheckDraft(slug, extraMetrics);
}

/** A find-and-replace on a revision's copy (headline, deck, paragraphs, chart and timeline text). */
export type CopyEdit = { find: string; replace: string };

/** Apply exact-text edits to every copy field of a revision's content. Each edit must match somewhere. */
export function editContent(content: Content, edits: CopyEdit[]): Content {
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  const hits = new Map<CopyEdit, number>(edits.map((e) => [e, 0]));
  const edit = (t: unknown) => {
    if (typeof t !== 'string') return t;
    let out = t;
    for (const e of edits) {
      if (out.includes(e.find)) { hits.set(e, (hits.get(e) ?? 0) + 1); out = out.split(e.find).join(e.replace); }
    }
    return out;
  };
  for (const k of ['kicker', 'title', 'hook', 'caveat'] as const) next[k] = edit(next[k]);
  const one = next.one_number as Record<string, unknown> | null;
  if (one) one.label = edit(one.label);
  const blocks = ((next.body as { blocks?: Record<string, unknown>[] })?.blocks) ?? [];
  for (const b of blocks) {
    for (const k of ['text', 'title', 'subtitle', 'alt', 'caption']) if (k in b) b[k] = edit(b[k]);
    if (Array.isArray(b.items)) b.items = b.items.map(edit);
    if (Array.isArray(b.events)) {
      for (const ev of b.events as Record<string, unknown>[]) { ev.label = edit(ev.label); ev.date = edit(ev.date); }
      // An event whose label is edited down to nothing is removed.
      b.events = (b.events as Record<string, unknown>[]).filter((ev) => String(ev.label ?? '').trim());
    }
  }
  // A text block (paragraph, heading, pull quote) edited down to nothing is removed, as are emptied layers.
  for (const b of blocks) if (Array.isArray(b.items)) b.items = (b.items as unknown[]).filter((t) => String(t ?? '').trim());
  (next.body as { blocks: Record<string, unknown>[] }).blocks = blocks.filter((b) =>
    !['paragraph', 'heading', 'pull'].includes(String(b.type)) ? !(b.type === 'layers' && !(b.items as unknown[]).length)
      : String(b.text ?? '').trim());
  const table = (next.evidence as { table?: { rows: unknown[][] } })?.table;
  // Table rows are edited whole ("label | value | period") first, so equal cells in different rows can be
  // told apart, then cell by cell.
  if (table) {
    table.rows = table.rows.map((r) => {
      const joined = r.map((c) => String(c ?? '')).join(' | ');
      const edited = edit(joined) as string;
      return (edited !== joined ? edited.split(' | ') : r).map(edit);
    });
  }
  // Footnotes too: a wrong source link or citation is corrected the same way.
  // A footnote's link can be targeted on its own as "[^n] <url>", for when two footnotes share a link.
  for (const f of ((next.evidence as { footnotes?: Record<string, unknown>[] })?.footnotes ?? [])) {
    f.text = edit(f.text);
    const tag = `[^${f.n}] `;
    const keyed = edit(`${tag}${f.url ?? ''}`) as string;
    f.url = keyed.startsWith(tag) && keyed !== `${tag}${f.url ?? ''}` ? keyed.slice(tag.length) : edit(f.url);
  }
  const missed = edits.filter((e) => !hits.get(e));
  if (missed.length) throw new Error(`edit text not found: ${missed.map((e) => JSON.stringify(e.find)).join(', ')}`);
  return next as Content;
}

/** A pending revision's content (for review from the command line). */
export async function loadRevisionContent(slug: string) {
  const row = await loadPublished(slug);
  const pending = await loadPendingRevision(row.story_id);
  if (!pending) throw new Error(`/stories/${slug} has no pending revision`);
  return { content: pending.content as unknown as Content, check: pending.check };
}

/** Open a pending revision holding the live copy, for corrections to a published story. */
export async function startRevisionFromLive(slug: string) {
  const row = await loadPublished(slug);
  if (await loadPendingRevision(row.story_id)) throw new Error(`/stories/${slug} already has a pending revision`);
  const { error } = await createClient().from('story_revisions').insert({
    story_id: row.story_id, status: 'pending', content: pick(row), check: null, note: 'Correction to the live copy',
  });
  if (error) throw new Error(error.message);
}
