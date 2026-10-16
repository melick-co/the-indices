'use server';
import { sydneyDay } from '@/lib/dates';
import { requireAdmin } from '@/lib/auth';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import type {
  HomeSection,
  StoryArt,
  StoryBlock,
  StoryBody,
  StoryEvidence,
  StoryOneNumber,
} from '@/lib/story-types';
import { attachGeneratedArt, isStaticStorySlug, parseStoryArt } from '@/lib/story-art';
import {
  applyRevision, discardRevision, hasPendingRevision, holdAsRevision, recheckDraft, recheckRevision, saveRevisionContent,
  type StoredCheck,
} from '@/lib/refresh-story';
import { sanitiseEvidence } from '@/lib/desk-evidence';
import { attachHighlights } from '@/lib/story-highlights';
import {
  claimsOf, ensurePublishable, gateIssues, gateMessage, passedStrict, recheck, sameClaims, stampFields,
} from '@/lib/publish-gate';

/** What a desk action that can be held by the publish gate returns (thrown errors lose their message in production). */
export type DeskResult = { ok: boolean; issues: string[]; message?: string };

function revalidateStory(slug: string) {
  revalidatePath('/');
  revalidatePath('/foundry');
  revalidatePath('/foundry/pitches');
  revalidatePath('/foundry/desk');
  revalidatePath(`/foundry/desk/${slug}`);
  revalidatePath(`/stories/${slug}`);
  revalidatePath(`/evidence/${slug}`);
}

type DeskRow = {
  slug: string;
  home_section: HomeSection | null;
  home_rank: number | null;
  pinned_hero: boolean;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  art: unknown;
};

async function loadDeskRow(slug: string): Promise<DeskRow | null> {
  const supabase = createClient();
  const { data } = await supabase.from('story_desk').select('*').eq('slug', slug).maybeSingle();
  return (data as DeskRow | null) ?? null;
}

async function upsertDesk(slug: string, patch: Partial<DeskRow>) {
  const supabase = createClient();
  const current = await loadDeskRow(slug);
  const { error } = await supabase.from('story_desk').upsert({
    slug,
    home_section: current?.home_section ?? null,
    home_rank: current?.home_rank ?? null,
    pinned_hero: current?.pinned_hero ?? false,
    hero_image_url: current?.hero_image_url ?? null,
    hero_image_alt: current?.hero_image_alt ?? null,
    art: current?.art ?? [],
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'slug' });
  if (error) throw new Error(error.message);
}

function usesDeskOverlay(slug: string) {
  return isStaticStorySlug(slug);
}

async function unpinAll(supabase: ReturnType<typeof createClient>) {
  await supabase.from('stories').update({ pinned_hero: false, updated_at: new Date().toISOString() })
    .eq('pinned_hero', true);
  await supabase.from('story_desk').update({ pinned_hero: false, updated_at: new Date().toISOString() })
    .eq('pinned_hero', true);
}

export async function pinHero(slug: string) {
  await requireAdmin();
  const supabase = createClient();
  await unpinAll(supabase);
  const now = new Date().toISOString();
  if (usesDeskOverlay(slug)) {
    await upsertDesk(slug, { pinned_hero: true });
  } else {
    const { error } = await supabase.from('stories')
      .update({ pinned_hero: true, updated_at: now }).eq('slug', slug);
    if (error) throw new Error(error.message);
  }
  revalidateStory(slug);
}

export async function unpinHero(slug: string) {
  await requireAdmin();
  const supabase = createClient();
  const now = new Date().toISOString();
  if (usesDeskOverlay(slug)) {
    await upsertDesk(slug, { pinned_hero: false });
  } else {
    const { error } = await supabase.from('stories')
      .update({ pinned_hero: false, updated_at: now }).eq('slug', slug);
    if (error) throw new Error(error.message);
  }
  revalidateStory(slug);
}

export async function setHomeSection(slug: string, section: HomeSection | null) {
  await requireAdmin();
  const supabase = createClient();
  const now = new Date().toISOString();
  if (section === 'hero') await unpinAll(supabase);
  const patch: Record<string, unknown> = {
    home_section: section,
    updated_at: now,
  };
  if (section === 'hero') patch.pinned_hero = true;
  if (usesDeskOverlay(slug)) {
    await upsertDesk(slug, {
      home_section: section,
      ...(section === 'hero' ? { pinned_hero: true } : {}),
    });
  } else {
    const { error } = await supabase.from('stories').update(patch).eq('slug', slug);
    if (error) throw new Error(error.message);
  }
  revalidateStory(slug);
}

/** Persist manual order for one home section. Rank is the array index. */
export async function reorderSection(
  section: Exclude<HomeSection, 'hero'>,
  orderedSlugs: string[],
) {
  await requireAdmin();
  const supabase = createClient();
  const now = new Date().toISOString();
  for (let i = 0; i < orderedSlugs.length; i += 1) {
    const slug = orderedSlugs[i];
    if (usesDeskOverlay(slug)) {
      await upsertDesk(slug, { home_section: section, home_rank: i });
    } else {
      const { error } = await supabase.from('stories').update({
        home_section: section,
        home_rank: i,
        updated_at: now,
      }).eq('slug', slug);
      if (error) throw new Error(error.message);
    }
  }
  revalidatePath('/');
  revalidatePath('/foundry/desk');
}

/**
 * Set a story's status. Publishing goes through the publish gate: the story goes live only if its current content
 * passed the strict check (run here when it has not; a minute or two with the claim audit).
 */
export async function setStoryStatus(slug: string, status: 'draft' | 'published' | 'archived'): Promise<DeskResult> {
  await requireAdmin();
  if (usesDeskOverlay(slug)) {
    throw new Error('Founding stories are always published. Edit status in the repo.');
  }
  const supabase = createClient();
  if (status === 'published') {
    const { data: current } = await supabase.from('stories').select('status').eq('slug', slug).maybeSingle();
    if (current?.status !== 'published') {
      const gate = await ensurePublishable(slug);
      if (!gate.ok) {
        revalidateStory(slug);
        return { ok: false, issues: gate.issues, message: 'Not published: it has not passed the strict check.' };
      }
    }
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === 'published') patch.published = now.slice(0, 10);
  const { error } = await supabase.from('stories').update(patch).eq('slug', slug);
  if (error) return { ok: false, issues: [gateMessage(error)], message: gateMessage(error) };

  if (status === 'published') {
    const { data } = await supabase.from('stories').select('pitch_id').eq('slug', slug).maybeSingle();
    if (data?.pitch_id) {
      await supabase.rpc('set_actor', { who: 'editor' }).then(() => {}, () => {});
      await supabase.from('pitches').update({
        state: 'published',
        state_changed: now,
        last_evaluated: now,
      }).eq('id', data.pitch_id);
    }
  }
  revalidateStory(slug);
  return { ok: true, issues: [] };
}

export type StoryCopyPayload = {
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  oneNumber: StoryOneNumber;
  frameCheck: boolean;
  published: string;
  body: StoryBody;
  evidence: StoryEvidence;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  homeSection: HomeSection | null;
};

function requireText(label: string, value: string) {
  if (!value.trim()) throw new Error(`${label} cannot be empty`);
}

function sanitiseBody(body: StoryBody): StoryBody {
  const blocks = (body.blocks ?? []).map((block): StoryBlock => {
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'pull') {
      return { ...block, text: block.text ?? '' };
    }
    if (block.type === 'layers') {
      return { type: 'layers' as const, items: (block.items ?? []).map((t) => t ?? '') };
    }
    if (block.type === 'quote') {
      return {
        type: 'quote', text: (block.text ?? '').trim(), speaker: (block.speaker ?? '').trim(),
        title: block.title?.trim() || undefined, said: block.said?.trim() || undefined,
        source_url: (block.source_url ?? '').trim(), footnote: block.footnote,
        verified: Boolean(block.verified),
      };
    }
    if (block.type === 'timeline') {
      return {
        type: 'timeline', title: (block.title ?? '').trim(), subtitle: block.subtitle?.trim() || undefined,
        events: (block.events ?? []).map((ev) => ({ date: (ev.date ?? '').trim(), label: (ev.label ?? '').trim(), footnote: ev.footnote }))
          .filter((ev) => ev.date && ev.label),
      };
    }
    const series = (block.series ?? []).map((p) => ({
      label: (p.label ?? '').trim(),
      value: Number(p.value),
      highlight: Boolean(p.highlight),
    })).filter((p) => p.label && Number.isFinite(p.value));
    const alt = (block.alt_series ?? []).map((p) => ({
      label: (p.label ?? '').trim(),
      value: Number(p.value),
      highlight: Boolean(p.highlight),
    })).filter((p) => p.label && Number.isFinite(p.value));
    return {
      // Keep the data spec, binding and anatomy so a desk save never drops them.
      ...block,
      type: 'chart' as const,
      kind: block.kind === 'rank_swap' || block.kind === 'timeline' || block.kind === 'line' ? block.kind : 'bars' as const,
      title: block.title?.trim() || undefined,
      subtitle: block.subtitle?.trim() || undefined,
      alt: block.alt?.trim() || undefined,
      caption: block.caption?.trim() || undefined,
      primary_label: block.primary_label?.trim() || undefined,
      alt_label: block.alt_label?.trim() || undefined,
      series,
      alt_series: alt.length ? alt : undefined,
    };
  });
  return { blocks };
}

export type SaveCopyResult = DeskResult & {
  staticBody: boolean;
  /** Edits to a live story that failed the strict check: held as a pending revision, the live article unchanged. */
  held?: boolean;
};

/**
 * Save the desk's copy. A draft is saved as it is. On a live story, edits that change its claims go live only if
 * they pass the strict check (saved as checked, stamped for the publish gate); otherwise the live article stays as
 * it is and the edits are held as a pending revision with the issues. Image, placement and dates always save.
 */
export async function saveStoryCopy(slug: string, payload: StoryCopyPayload): Promise<SaveCopyResult> {
  await requireAdmin();
  requireText('Title', payload.title);
  requireText('Kicker', payload.kicker);
  requireText('Hook', payload.hook);
  requireText('Caveat', payload.caveat);

  const heroImageUrl = payload.heroImageUrl?.trim() || null;
  const heroImageAlt = payload.heroImageAlt?.trim() || null;

  if (usesDeskOverlay(slug)) {
    await upsertDesk(slug, {
      hero_image_url: heroImageUrl,
      hero_image_alt: heroImageAlt,
      home_section: payload.homeSection,
    });
    revalidateStory(slug);
    return { ok: true, issues: [], staticBody: true };
  }

  const supabase = createClient();
  const { data: row, error: readErr } = await supabase.from('stories').select('*').eq('slug', slug).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error(`No story row for ${slug}`);
  const stored = row.body as { highlights?: unknown } | null;
  const copy = {
    kicker: payload.kicker.trim(),
    title: payload.title.trim(),
    hook: payload.hook.trim(),
    caveat: payload.caveat.trim(),
    // Keep the hero number's binding (metric_id, period, comparison); the desk edits value and label.
    one_number: { ...payload.oneNumber, value: payload.oneNumber.value.trim(), label: payload.oneNumber.label.trim() },
    // The highlight panel is not edited on the desk; keep it.
    body: { ...sanitiseBody(payload.body), ...(stored?.highlights ? { highlights: stored.highlights } : {}) },
    evidence: sanitiseEvidence(payload.evidence, row.evidence as StoryEvidence | null),
  };
  const meta = {
    frame_check: Boolean(payload.frameCheck),
    published: payload.published?.slice(0, 10) || sydneyDay(),
    hero_image_url: heroImageUrl,
    hero_image_alt: heroImageAlt,
    home_section: payload.homeSection,
    updated_at: new Date().toISOString(),
  };

  const live = row.status === 'published';
  // The stored copy cleaned the same way, so an untouched field never reads as an edit.
  const one = (row.one_number ?? {}) as StoryOneNumber;
  const before = {
    kicker: String(row.kicker ?? '').trim(), title: String(row.title ?? '').trim(),
    hook: String(row.hook ?? '').trim(), caveat: String(row.caveat ?? '').trim(),
    one_number: { ...one, value: String(one.value ?? '').trim(), label: String(one.label ?? '').trim() },
    body: sanitiseBody((row.body ?? { blocks: [] }) as StoryBody),
    evidence: sanitiseEvidence((row.evidence ?? { sources: [] }) as StoryEvidence, row.evidence as StoryEvidence | null),
  };
  const unchanged = sameClaims(before, copy);
  if (!live || unchanged) {
    // Unchanged copy is not rewritten (a draft keeps its check stamp); only image, placement and dates save. A
    // changed draft is saved as it is: it is checked before it goes live.
    const { error } = await supabase.from('stories').update(unchanged ? meta : { ...copy, ...meta }).eq('slug', slug);
    if (error) throw new Error(gateMessage(error));
    revalidateStory(slug);
    return { ok: true, issues: [], staticBody: false };
  }

  // The live story's claims change: the strict check runs first.
  if (await hasPendingRevision(slug)) {
    return {
      ok: false, staticBody: false,
      issues: ['this story has a pending revision: make the edits there (Fix and re-check), not on the live copy'],
      message: 'Not saved: this story has a pending revision.',
    };
  }
  const saved = ((row.evidence as StoryEvidence | null)?.metric_ids) ?? [];
  const { content, check } = await recheck({ ...copy, frame_check: meta.frame_check, metric_ids_used: saved }, row.pitch_id as string | null);
  if (!passedStrict(check)) {
    const { error } = await supabase.from('stories').update(meta).eq('slug', slug);
    if (error) throw new Error(gateMessage(error));
    await holdAsRevision(slug, content, { ...check, ok: false, issues: gateIssues(check) });
    revalidateStory(slug);
    return {
      ok: false, held: true, staticBody: false, issues: gateIssues(check),
      message: 'Not live: the edits failed the strict check, so the live article is unchanged. They are held as a pending revision to fix and re-check.',
    };
  }
  const checked = { ...claimsOf(content), body: { ...(content.body as object), ...(stored?.highlights ? { highlights: stored.highlights } : {}) } };
  const stamp = await stampFields(supabase, checked, check);
  const { error } = await supabase.from('stories').update({ ...checked, ...meta, ...stamp }).eq('slug', slug);
  if (error) {
    return { ok: false, staticBody: false, issues: [gateMessage(error)], message: gateMessage(error) };
  }
  // New figures, new highlights.
  await attachHighlights(supabase, slug).catch(() => null);
  revalidateStory(slug);
  return { ok: true, issues: [], staticBody: false };
}

export async function saveHeroImage(slug: string, url: string, alt: string) {
  await requireAdmin();
  const heroImageUrl = url.trim() || null;
  const heroImageAlt = alt.trim() || null;
  const now = new Date().toISOString();
  if (usesDeskOverlay(slug)) {
    await upsertDesk(slug, { hero_image_url: heroImageUrl, hero_image_alt: heroImageAlt });
  } else {
    const supabase = createClient();
    const { error } = await supabase.from('stories').update({
      hero_image_url: heroImageUrl,
      hero_image_alt: heroImageAlt,
      updated_at: now,
    }).eq('slug', slug);
    if (error) throw new Error(error.message);
  }
  revalidateStory(slug);
}

export async function recordStoryArt(
  slug: string,
  piece: Omit<StoryArt, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) {
  await requireAdmin();
  const supabase = createClient();
  const now = new Date().toISOString();
  if (usesDeskOverlay(slug)) {
    const current = await loadDeskRow(slug);
    const art = attachGeneratedArt(current?.art, piece);
    await upsertDesk(slug, { art });
    if (piece.kind === 'hero' || piece.kind === 'still') {
      await upsertDesk(slug, {
        art,
        hero_image_url: piece.url,
        hero_image_alt: piece.alt ?? null,
      });
    }
    revalidateStory(slug);
    return art;
  }
  const { data, error: readErr } = await supabase.from('stories')
    .select('art').eq('slug', slug).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!data) throw new Error(`No story row for ${slug}`);
  const art = attachGeneratedArt(data.art, piece);
  const patch: Record<string, unknown> = { art, updated_at: now };
  if (piece.kind === 'hero' || piece.kind === 'still') {
    patch.hero_image_url = piece.url;
    if (piece.alt) patch.hero_image_alt = piece.alt;
  }
  const { error } = await supabase.from('stories').update(patch).eq('slug', slug);
  if (error) throw new Error(error.message);
  revalidateStory(slug);
  return parseStoryArt(art);
}

export type DeskRender = {
  renderId: string;
  kind: string;
  url: string;
  prompt: string;
};

/** Succeeded ElevenLabs (or earlier Runway) renders for this slug. Read-only; does not start jobs. */
export async function loadSucceededRenders(slug: string): Promise<DeskRender[]> {
  await requireAdmin();
  const supabase = createClient();
  const { data, error } = await supabase.from('story_reel_renders')
    .select('render_id, kind, output_url, prompt_text')
    .eq('story_slug', slug)
    .eq('status', 'succeeded')
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error || !data?.length) return [];
  return (data as Array<{
    render_id: string; kind: string; output_url: string | null; prompt_text: string | null;
  }>)
    .filter((r) => r.output_url)
    .map((r) => ({
      renderId: r.render_id,
      kind: r.kind,
      url: r.output_url as string,
      prompt: r.prompt_text ?? '',
    }));
}

/** Attach an existing render URL to the story. Does not call a generator. */
export async function attachRenderToStory(slug: string, render: DeskRender, asHero: boolean) {
  await requireAdmin();
  const isClip = render.kind === 'clip' || render.kind === 'chart_video' || render.kind === 'reel';
  return recordStoryArt(slug, {
    kind: asHero ? 'hero' : isClip ? 'clip' : 'still',
    url: render.url,
    source: 'generated',
    generator: 'runway',
    prompt: render.prompt || undefined,
    id: `render-${render.renderId}`,
  });
}

/** The copy fields a revision holds, sanitised the same way as a desk save. */
function revisionContent(payload: StoryCopyPayload) {
  requireText('Title', payload.title);
  requireText('Kicker', payload.kicker);
  requireText('Hook', payload.hook);
  requireText('Caveat', payload.caveat);
  return {
    kicker: payload.kicker.trim(),
    title: payload.title.trim(),
    hook: payload.hook.trim(),
    caveat: payload.caveat.trim(),
    one_number: { ...payload.oneNumber, value: payload.oneNumber.value.trim(), label: payload.oneNumber.label.trim() },
    evidence: sanitiseEvidence(payload.evidence),
    body: sanitiseBody(payload.body),
    frame_check: Boolean(payload.frameCheck),
  };
}

/** Save edits to a published story's pending revision (the live article is untouched). */
export async function saveRevisionCopy(slug: string, payload: StoryCopyPayload) {
  await requireAdmin();
  await saveRevisionContent(slug, revisionContent(payload));
  revalidateStory(slug);
}

/**
 * "Fix and re-check": save the editor's copy, then run every publishing check on it (figures, charts from
 * stored data, house style, quotes, claim audit) without rewriting it.
 */
export async function recheckStory(slug: string, payload: StoryCopyPayload, target: 'draft' | 'revision'): Promise<StoredCheck> {
  await requireAdmin();
  let check: StoredCheck;
  if (target === 'revision') {
    await saveRevisionContent(slug, revisionContent(payload));
    check = await recheckRevision(slug);
  } else {
    await saveStoryCopy(slug, payload);
    check = await recheckDraft(slug);
  }
  revalidateStory(slug);
  // Shown as the publish gate reads it: a pass without the claim audit is not a pass.
  return passedStrict(check) ? check : { ...check, ok: false, issues: gateIssues(check) };
}

/**
 * Put a story's pending revision live, only if it passed the strict check. The desk cannot override a failed
 * check; an override needs a reason and runs from the command line (refresh-stories.ts --apply --force).
 */
export async function applyStoryRevision(slug: string): Promise<DeskResult> {
  await requireAdmin();
  try {
    await applyRevision(slug);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, issues: [message], message: 'Not applied: the revision has not passed the strict check.' };
  }
  revalidateStory(slug);
  return { ok: true, issues: [] };
}

export async function discardStoryRevision(slug: string) {
  await requireAdmin();
  await discardRevision(slug);
  revalidateStory(slug);
}
