import { createClient } from '@/lib/supabase-server';
import { draftStory, type PriorArticle } from '@/lib/generate-story';
import type { FoundryEvent } from '@/lib/foundry-agent';
import type { FactCheck } from '@/lib/fact-check';
import type { StoryBlock } from '@/lib/story-types';
import { loadPendingRevision } from '@/lib/stories-loader';

/** The article fields a revision replaces. Placement, art and dates are left alone. */
const CONTENT_COLS = ['kicker', 'title', 'hook', 'caveat', 'one_number', 'evidence', 'body', 'frame_check'] as const;
type Content = Record<(typeof CONTENT_COLS)[number], unknown>;

export const DEFAULT_UPDATE_NOTE =
  'Rewritten in our news format, with every figure re-checked against the latest official data.';

const pick = (row: Record<string, unknown>): Content =>
  Object.fromEntries(CONTENT_COLS.map((k) => [k, row[k]])) as Content;

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
  };
  const { story, check } = await draftStory(db, pitch, onEvent, { audit: true, prior });

  const content: Content = {
    kicker: story.kicker,
    title: story.title,
    hook: story.hook,
    caveat: story.caveat,
    one_number: story.one_number,
    evidence: story.evidence,
    body: story.body,
    frame_check: Boolean(story.frame_check),
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
