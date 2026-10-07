import { sydneyDay } from '@/lib/dates';
import { attachHighlights } from '@/lib/story-highlights';
import { createClient } from '@/lib/supabase-server';
import { checkStory, draftStory, goLiveFromPitch, type PriorArticle } from '@/lib/generate-story';
import type { StructuredStory } from '@/lib/article-from-pitch';
import type { FoundryEvent } from '@/lib/foundry-agent';
import type { FactCheck } from '@/lib/fact-check';
import type { StoryBlock } from '@/lib/story-types';
import { loadPendingRevision } from '@/lib/stories-loader';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';

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
    update_note: withCorrections(opts.note ?? DEFAULT_UPDATE_NOTE, row.update_note as string | null),
    updated_on: sydneyDay(),
    updated_at: now,
  }).eq('story_id', row.story_id);
  if (error) throw new Error(error.message);
  await db.from('story_revisions').update({ status: 'applied', resolved_at: now }).eq('revision_id', pending.revision_id);
  // The revision's body replaces the old one, highlights included: make them again from the revised figures.
  await attachHighlights(db, slug).catch(() => null);
  return { slug, title: String(pending.content.title) };
}

/**
 * The note shown on the article after an apply. Corrections stay on the record: an earlier note that reports a
 * correction is kept after the new note (unless the new note already restates it), so a later routine update
 * does not erase it.
 */
export function withCorrections(note: string, previous: string | null | undefined): string {
  const kept = correctionsIn(previous).filter((c) => !note.includes(c.slice(0, 60)));
  return [note, ...kept].join(' ');
}

/** The correction notices in a note ("Correction, 4 October 2026: …", "Correction: …", "Corrections: …"). */
export function correctionsIn(note: string | null | undefined): string[] {
  return (note ?? '').split(/(?=\bCorrections?(?:, [^:]{3,30})?:)/).map((p) => p.trim()).filter((p) => /^Corrections?\b/.test(p));
}

/**
 * Put every correction the article has ever carried back on its note (oldest first, after the current note):
 * notes applied before corrections were kept could have dropped them. Returns the corrections restored.
 */
export async function restoreCorrections(slug: string): Promise<string[]> {
  const db = createClient();
  const row = await loadPublished(slug);
  const live = String(row.update_note ?? '').trim();
  // Compare notices without their "Correction(s)[, date]:" lead-in; a later notice that restates an earlier one
  // (a cumulative "Corrections: …") replaces it.
  const body = (c: string) => c.replace(/^Corrections?(?:, [^:]{3,30})?:\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const all: string[] = [];
  for (const n of await noteHistory(slug)) all.push(...correctionsIn(n.note));
  all.push(...correctionsIn(live));
  const kept: string[] = [];
  for (const c of all) {
    const b = body(c);
    const i = kept.findIndex((k) => { const kb = body(k); return kb === b || b.startsWith(kb.slice(0, 60)) || kb.startsWith(b.slice(0, 60)); });
    if (i >= 0) { if (c.length >= kept[i].length) kept[i] = c; } else kept.push(c);
  }
  const head = live.split(/(?=\bCorrections?(?:, [^:]{3,30})?:)/)[0].trim();
  const rebuilt = [/^Corrections?\b/.test(head) ? '' : head, ...kept].filter(Boolean).join(' ');
  if (rebuilt === live) return [];
  const { error } = await db.from('stories').update({ update_note: rebuilt, updated_at: new Date().toISOString() }).eq('story_id', row.story_id);
  if (error) throw new Error(error.message);
  return kept.filter((k) => !live.includes(k));
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

/** Every check on the live copy, read-only: nothing is saved (charts are rebuilt only in memory). */
export async function checkLive(slug: string): Promise<StoredCheck> {
  const row = await loadPublished(slug);
  const live = pickRevision(row);
  const saved = ((live.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  return (await recheck({ ...live, metric_ids_used: saved }, row.pitch_id)).check;
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
export type CopyEdit = {
  find: string;
  replace: string;
  /** A source for the replacement text: a "[^+]" marker in `replace` becomes this footnote's number (an existing
   *  footnote when the URL is already cited, otherwise a new one). */
  source?: { text: string; url: string };
  /** Add a timeline entry (instead of find/replace): placed before the entry dated `before`, or last. Its source
   *  becomes a footnote (an existing one when the URL is already cited). */
  add_event?: { date: string; label: string; before?: string; source: { text: string; url: string } };
};

/** Apply exact-text edits to every copy field of a revision's content. Each edit must match somewhere. */
export function editContent(content: Content, edits: CopyEdit[]): Content {
  const next = JSON.parse(JSON.stringify(content)) as Record<string, unknown>;
  // Timeline additions first; they are not find/replace edits.
  for (const e of edits.filter((x) => x.add_event)) {
    const a = e.add_event!;
    const ev = (next.evidence ?? (next.evidence = {})) as { footnotes?: { n: number; text: string; url?: string }[] };
    const notes = (ev.footnotes ??= []);
    const n = notes.find((f) => f.url === a.source.url)?.n
      ?? (notes.push({ n: Math.max(0, ...notes.map((f) => f.n)) + 1, text: a.source.text, url: a.source.url }), notes[notes.length - 1].n);
    const block = ((next.body as { blocks?: Record<string, unknown>[] })?.blocks ?? []).find((b) => b.type === 'timeline');
    if (!block) throw new Error('add_event: the story has no timeline');
    const events = block.events as { date: string; label: string; footnote?: number }[];
    const at = a.before ? events.findIndex((x) => x.date === a.before) : -1;
    events.splice(at >= 0 ? at : events.length, 0, { date: a.date, label: a.label, footnote: n });
  }
  edits = edits.filter((x) => !x.add_event);
  // Replacements that bring their own source: resolve "[^+]" to that source's footnote number.
  edits = edits.map((e) => {
    if (!e.source || !e.replace.includes('[^+]')) return e;
    const ev = (next.evidence ?? (next.evidence = {})) as { footnotes?: { n: number; text: string; url?: string }[] };
    const notes = (ev.footnotes ??= []);
    const n = notes.find((f) => f.url === e.source!.url)?.n
      ?? (notes.push({ n: Math.max(0, ...notes.map((f) => f.n)) + 1, text: e.source.text, url: e.source.url }), notes[notes.length - 1].n);
    return { ...e, replace: e.replace.split('[^+]').join(`[^${n}]`) };
  });
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
    // A chart's data spec can be edited as JSON text (e.g. adding a country to its entities).
    if (b.type === 'chart' && b.data) b.data = JSON.parse(edit(JSON.stringify(b.data)) as string);
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
    }).filter((r) => r.some((c) => String(c ?? '').trim()));  // a row edited to nothing is removed
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

/**
 * Publish a held draft the editor has approved: re-check it first, and publish only if it still passes
 * every check (data and sources can change between approval and publishing).
 */
export async function publishDraft(slug: string, extraMetrics: string[] = []): Promise<{ check: StoredCheck; published: boolean }> {
  const row = await loadDraft(slug);
  const check = await recheckDraft(slug, extraMetrics);
  if (!check.ok) return { check, published: false };
  if (row.pitch_id) await goLiveFromPitch(String(row.pitch_id));
  else {
    const now = new Date().toISOString();
    const { error } = await createClient().from('stories').update({ status: 'published', published: sydneyDay(), updated_at: now }).eq('slug', slug);
    if (error) throw new Error(error.message);
  }
  return { check, published: true };
}

/**
 * What an event-triggered update may change in a live article: numbers, reference periods (months, quarters,
 * years) and direction words ("rose" → "fell"). Anything more means the story itself has changed, and that is
 * a new article, not an update (house rule, Oct 2026).
 */
const FIGURE_WORDS = new RegExp('\\b(?:' + [
  'rose', 'rise', 'rises', 'rising', 'risen', 'fell', 'fall', 'falls', 'falling', 'fallen', 'up', 'down', 'higher', 'lower',
  'increased?', 'increases', 'increasing', 'decreased?', 'decreases', 'decreasing', 'above', 'below', 'faster', 'slower',
  'accelerat\\w*', 'decelerat\\w*', 'slowed', 'slowing', 'eased?', 'eases', 'easing', 'climb\\w*', 'grew', 'grow', 'grows',
  'growing', 'declin\\w*', 'gain\\w*', 'dropp?\\w*', 'more', 'less', 'highest', 'lowest', 'widen\\w*', 'narrow\\w*',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
].join('|') + ')\\b', 'gi');

export function isFiguresOnly(find: string, replace: string): boolean {
  const mask = (t: string) => t.replace(/\d[\d,]*(?:\.\d+)?/g, '#').replace(FIGURE_WORDS, '~').replace(/\s+/g, ' ').trim();
  return mask(find) === mask(replace);
}

/** The article's copy as the updater sees it: every field an edit can reach, labelled. */
function copyForUpdate(c: Content): string {
  const out: string[] = [`HEADLINE: ${c.title}`, `DECK: ${c.hook}`];
  const one = c.one_number as { value?: string; label?: string } | null;
  if (one?.label) out.push(`HERO NUMBER: ${one.value ?? ''} ${one.label}`);
  for (const b of ((c.body as { blocks?: Record<string, unknown>[] })?.blocks ?? [])) {
    if (typeof b.text === 'string') out.push(`${String(b.role ?? b.type).toUpperCase()}: ${b.text}`);
    if (Array.isArray(b.items)) for (const i of b.items) out.push(`LAYER: ${i}`);
    if (b.type === 'chart') out.push(`CHART: ${b.title ?? ''} | ${b.subtitle ?? ''} | ${b.alt ?? ''}`);
    if (Array.isArray(b.events)) for (const e of b.events as Record<string, unknown>[]) out.push(`TIMELINE: ${e.date}: ${e.label}`);
  }
  const ev = c.evidence as { table?: { rows: unknown[][] }; footnotes?: { n: number; text: string }[] } | null;
  for (const r of ev?.table?.rows ?? []) out.push(`TABLE ROW: ${r.map((x) => String(x ?? '')).join(' | ')}`);
  for (const f of ev?.footnotes ?? []) out.push(`FOOTNOTE [^${f.n}]: ${f.text}`);
  return out.join('\n');
}

export type FiguresUpdate = {
  outcome: 'unchanged' | 'applied' | 'held' | 'rewrite';
  reason?: string;
  edits?: CopyEdit[];
  issues?: string[];
};

/**
 * Event-triggered update of a live article, limited to its figures: the model proposes exact find/replace
 * edits, each must change only numbers, periods and direction words, charts and the hero number are rebuilt
 * from the store, and the article is re-checked. Applied with `note` when it passes; held on the desk when it
 * fails a check. When the new data changes the finding (or needs more than figure edits) the article is left
 * as it is and the outcome is 'rewrite': the caller publishes a new article instead.
 */
export async function updateFigures(
  slug: string,
  event: { title: string; occurred_on: string | null; summary?: string | null; outcome?: unknown },
  note: string,
  opts: { dryRun?: boolean } = {},
): Promise<FiguresUpdate> {
  const db = createClient();
  const row = await loadPublished(slug);
  if (await loadPendingRevision(row.story_id)) return { outcome: 'held', reason: 'a revision is already pending on the desk' };
  const live = pickRevision(row);
  const saved = ((live.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  const ids = [...new Set([...saved, ...(await pitchMetricIds(row.pitch_id))])];
  const reference = await buildReference(db, ids, { history: 8 });

  const reply = await callClaudeJson(`You keep a published data-journalism article current after an official release.
You may only update its FIGURES; you may not rewrite it.

<event>
${event.title} (${event.occurred_on ?? ''})${event.summary ? `\n${event.summary}` : ''}
Outcome: ${JSON.stringify(event.outcome ?? {})}
</event>

<stored_data>
${JSON.stringify(reference)}
</stored_data>

<article published="${row.published}">
${copyForUpdate(live)}
</article>

Compare every figure in the article with the stored data: each series' "latest" reading and its "earlier"
readings, by period. The event only tells you why you are checking; the stored data decides. A figure is
superseded when the article presents it as the current reading and the store has a newer period for that series.
Figures the article gives as history (a past peak, a trough, a dated reading) stay as they are.

Decide:
- "unchanged": no figure in the article is superseded by newer stored data.
- "figures": some figures are superseded, and the article's headline claim and finding still hold with the new
  numbers. Give edits that swap each superseded figure (and its period, and a direction word such as rose/fell
  if the move reversed) for the latest stored reading. Keep every other word, footnote marker and sentence.
  Update footnote text that states the old figure or period the same way.
- "rewrite": the new data changes the finding: the headline claim no longer holds, the direction of the story
  reverses, or keeping it accurate needs new sentences or reasoning rather than new numbers.

Each edit's "find" must be an exact substring of the article copy above (without the "LABEL: " prefix),
long enough to be unique, and its "replace" must differ from it only in numbers, periods and direction words.
Respond ONLY with JSON:
{"verdict":"unchanged|figures|rewrite","reason":"one sentence","edits":[{"find":"...","replace":"..."}]}`,
  { label: `figures ${slug}`, maxTokens: 6000 }) as { verdict: string; reason?: string; edits?: CopyEdit[] };

  const reason = reply.reason ?? '';
  if (reply.verdict === 'rewrite') return { outcome: 'rewrite', reason };
  const edits = (reply.edits ?? []).filter((e) => e?.find && e.find !== e.replace);
  const beyond = edits.filter((e) => !isFiguresOnly(e.find, e.replace));
  if (beyond.length) {
    return { outcome: 'rewrite', reason: `the update needs more than figure changes (${beyond.map((e) => JSON.stringify(e.replace).slice(0, 80)).join('; ')})`, edits };
  }
  let edited: Content;
  try { edited = edits.length ? editContent(live, edits) : live; }
  catch (err) { return { outcome: 'held', reason: err instanceof Error ? err.message : String(err), edits }; }
  if (opts.dryRun) return { outcome: edits.length ? 'applied' : 'unchanged', reason: `(dry run) ${reason}`, edits };

  // Charts and the hero number are rebuilt from the store by the re-check, so they update even with no edits.
  await startRevisionFromLive(slug);
  await saveRevisionContent(slug, { ...edited, metric_ids_used: ids });
  const check = await recheckRevision(slug);
  if (!check.ok) return { outcome: 'held', reason: 'the updated article failed its checks', edits, issues: check.issues };
  const { content } = await loadRevisionContent(slug);
  const same = (k: keyof Content) => JSON.stringify(content[k]) === JSON.stringify(live[k]);
  if (!edits.length && same('body') && same('one_number')) {
    await discardRevision(slug);
    return { outcome: 'unchanged', reason };
  }
  await applyRevision(slug, { note });
  return { outcome: 'applied', reason, edits };
}

/**
 * Give a published story a new address. The old address must be redirected (next.config.mjs redirects) so
 * shared links keep working; this only moves the record and its desk placement.
 */
export async function renameStory(from: string, to: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(to)) throw new Error(`"${to}" is not a valid slug`);
  const db = createClient();
  const row = await loadPublished(from);
  const { data: taken } = await db.from('stories').select('story_id').eq('slug', to).maybeSingle();
  if (taken) throw new Error(`/stories/${to} already exists`);
  const { error } = await db.from('stories').update({ slug: to, updated_at: new Date().toISOString() }).eq('story_id', row.story_id);
  if (error) throw new Error(error.message);
  await db.from('story_desk').update({ slug: to }).eq('slug', from);
  return { from, to };
}

/** Every update note the article has carried, oldest first (from the archived versions and the live row). */
export async function noteHistory(slug: string) {
  const db = createClient();
  const row = await loadPublished(slug);
  const { data } = await db.from('story_revisions').select('content, resolved_at')
    .eq('story_id', row.story_id).eq('status', 'archived').order('resolved_at', { ascending: true });
  const notes = (data ?? []).map((r) => ({ at: r.resolved_at as string, note: ((r.content as { update_note?: string | null })?.update_note ?? '').trim() }));
  notes.push({ at: 'live', note: String(row.update_note ?? '').trim() });
  return notes.filter((n, i, all) => n.note && (i === 0 || n.note !== all[i - 1].note));
}
