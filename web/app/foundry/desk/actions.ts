'use server';
import { requireAdmin } from '@/lib/auth';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import type {
  HomeSection,
  SourceRow,
  StoryArt,
  StoryBlock,
  StoryBody,
  StoryEvidence,
  StoryOneNumber,
} from '@/lib/story-types';
import { attachGeneratedArt, isStaticStorySlug, parseStoryArt } from '@/lib/story-art';
import {
  applyRevision, discardRevision, recheckDraft, recheckRevision, saveRevisionContent, type StoredCheck,
} from '@/lib/refresh-story';

function revalidateStory(slug: string) {
  revalidatePath('/');
  revalidatePath('/foundry');
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

export async function setStoryStatus(slug: string, status: 'draft' | 'published' | 'archived') {
  await requireAdmin();
  if (usesDeskOverlay(slug)) {
    throw new Error('Founding stories are always published. Edit status in the repo.');
  }
  const supabase = createClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === 'published') patch.published = now.slice(0, 10);
  const { error } = await supabase.from('stories').update(patch).eq('slug', slug);
  if (error) throw new Error(error.message);

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

function sanitiseEvidence(evidence: StoryEvidence): StoryEvidence {
  const sources: SourceRow[] = (evidence.sources ?? [])
    .filter((s) => s.metric?.trim() && s.org?.trim())
    .map((s) => ({
      metric: s.metric.trim(),
      org: s.org.trim(),
      tier: s.tier === 2 || s.tier === 3 ? s.tier : 1,
      url: (s.url ?? '').trim(),
      period: (s.period ?? '').trim(),
      basis: (s.basis ?? '').trim(),
    }));
  const table = evidence.table
    ? {
      head: evidence.table.head.map((h) => h.trim()).filter(Boolean),
      rows: evidence.table.rows.map((r) => r.map((c) => c ?? '')),
    }
    : undefined;
  if (table && !table.head.length) return { sources };
  return { table, sources };
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

export async function saveStoryCopy(slug: string, payload: StoryCopyPayload) {
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
    return { ok: true as const, staticBody: true };
  }

  const supabase = createClient();
  const { error } = await supabase.from('stories').update({
    kicker: payload.kicker.trim(),
    title: payload.title.trim(),
    hook: payload.hook.trim(),
    caveat: payload.caveat.trim(),
    // Keep the hero number's binding (metric_id, period, comparison); the desk edits value and label.
    one_number: { ...payload.oneNumber, value: payload.oneNumber.value.trim(), label: payload.oneNumber.label.trim() },
    frame_check: Boolean(payload.frameCheck),
    published: payload.published?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    body: sanitiseBody(payload.body),
    evidence: sanitiseEvidence(payload.evidence),
    hero_image_url: heroImageUrl,
    hero_image_alt: heroImageAlt,
    home_section: payload.homeSection,
    updated_at: new Date().toISOString(),
  }).eq('slug', slug);
  if (error) throw new Error(error.message);
  revalidateStory(slug);
  return { ok: true as const, staticBody: false };
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
  if (target === 'revision') {
    await saveRevisionContent(slug, revisionContent(payload));
    const check = await recheckRevision(slug);
    revalidateStory(slug);
    return check;
  }
  await saveStoryCopy(slug, payload);
  const check = await recheckDraft(slug);
  revalidateStory(slug);
  return check;
}

/** Put a story's pending revision live. `force` is the editor overriding a failed check. */
export async function applyStoryRevision(slug: string, force = false) {
  await requireAdmin();
  const result = await applyRevision(slug, { force });
  revalidateStory(slug);
  return result;
}

export async function discardStoryRevision(slug: string) {
  await requireAdmin();
  await discardRevision(slug);
  revalidateStory(slug);
}
