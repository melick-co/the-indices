import { createClient } from '@/lib/supabase-server';
import { STORIES as STATIC_STORIES } from '@/content/stories';
import type {
  HomeSection,
  Story,
  StoryArt,
  StoryBody,
  StoryEvidence,
  StoryOneNumber,
} from '@/lib/story-types';
import { attachGeneratedArt, isStaticStorySlug, parseStoryArt } from '@/lib/story-art';

export type DeskOverlay = {
  home_section: HomeSection | null;
  home_rank: number | null;
  pinned_hero: boolean;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  art: StoryArt[];
};

type DbStoryRow = {
  story_id: string;
  pitch_id: string | null;
  slug: string;
  status: string;
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  published: string;
  one_number: StoryOneNumber;
  evidence: StoryEvidence;
  body: StoryBody;
  frame_check?: boolean | null;
  home_section?: HomeSection | null;
  home_rank?: number | null;
  pinned_hero?: boolean | null;
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  art?: unknown;
};

function inferFrameCheck(kicker: string, title: string): boolean {
  return /\b(check|denominator|blindspot|flip|surprise|claim check|frame)\b/i
    .test(`${kicker} ${title}`);
}

function overlayFromRow(row: {
  home_section?: HomeSection | null;
  home_rank?: number | null;
  pinned_hero?: boolean | null;
  hero_image_url?: string | null;
  hero_image_alt?: string | null;
  art?: unknown;
}): DeskOverlay {
  return {
    home_section: row.home_section ?? null,
    home_rank: row.home_rank ?? null,
    pinned_hero: Boolean(row.pinned_hero),
    hero_image_url: row.hero_image_url ?? null,
    hero_image_alt: row.hero_image_alt ?? null,
    art: parseStoryArt(row.art),
  };
}

function applyOverlay(story: Story, overlay: DeskOverlay | undefined): Story {
  if (!overlay) return story;
  return {
    ...story,
    homeSection: overlay.home_section,
    homeRank: overlay.home_rank,
    pinnedHero: overlay.pinned_hero,
    heroImageUrl: overlay.hero_image_url,
    heroImageAlt: overlay.hero_image_alt,
    art: overlay.art.length ? overlay.art : story.art,
  };
}

function rowToStory(row: DbStoryRow): Story {
  const overlay = overlayFromRow(row);
  return applyOverlay({
    slug: row.slug,
    kicker: row.kicker,
    title: row.title,
    hook: row.hook,
    caveat: row.caveat,
    published: row.published,
    oneNumber: row.one_number,
    evidence: row.evidence,
    body: row.body,
    pitchId: row.pitch_id ?? undefined,
    frameCheck: row.frame_check ?? inferFrameCheck(row.kicker, row.title),
    status: (row.status as Story['status']) ?? 'published',
    staticBody: false,
    storyId: row.story_id,
  }, overlay);
}

function staticToStory(s: Story): Story {
  return {
    ...s,
    status: s.status ?? 'published',
    staticBody: true,
  };
}

const STORY_COLS = [
  'story_id', 'pitch_id', 'slug', 'status', 'kicker', 'title', 'hook', 'caveat',
  'published', 'one_number', 'evidence', 'body', 'frame_check',
  'home_section', 'home_rank', 'pinned_hero',
  'hero_image_url', 'hero_image_alt', 'art',
].join(', ');

async function loadDeskOverlays(): Promise<Map<string, DeskOverlay>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('story_desk')
    .select('slug, home_section, home_rank, pinned_hero, hero_image_url, hero_image_alt, art');
  if (error || !data?.length) return new Map();
  return new Map(
    (data as Array<{
      slug: string;
      home_section?: HomeSection | null;
      home_rank?: number | null;
      pinned_hero?: boolean | null;
      hero_image_url?: string | null;
      hero_image_alt?: string | null;
      art?: unknown;
    }>).map((row) => [row.slug, overlayFromRow(row)]),
  );
}

export async function loadPublishedDbStories(): Promise<Story[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('stories')
    .select(STORY_COLS)
    .eq('status', 'published')
    .order('published', { ascending: false });
  if (error || !data?.length) return [];
  return (data as unknown as DbStoryRow[]).map(rowToStory);
}

/**
 * Static registry plus DB-published stories.
 * Founding slugs keep their React bodies even if a stories row exists;
 * other collisions prefer the DB row.
 */
export async function loadAllStories(): Promise<Story[]> {
  const [dbStories, overlays] = await Promise.all([
    loadPublishedDbStories(),
    loadDeskOverlays(),
  ]);
  const bySlug = new Map<string, Story>();
  for (const s of STATIC_STORIES) {
    bySlug.set(s.slug, applyOverlay(staticToStory(s), overlays.get(s.slug)));
  }
  for (const s of dbStories) {
    if (isStaticStorySlug(s.slug)) continue;
    bySlug.set(s.slug, s);
  }
  return [...bySlug.values()].sort((a, b) => b.published.localeCompare(a.published));
}

export async function loadStoryBySlug(
  slug: string,
  opts?: { allowDraft?: boolean },
): Promise<Story | null> {
  const supabase = createClient();
  const [{ data }, overlays] = await Promise.all([
    supabase.from('stories').select(STORY_COLS).eq('slug', slug).maybeSingle(),
    loadDeskOverlays(),
  ]);
  if (data && !isStaticStorySlug(slug)) {
    const row = data as unknown as DbStoryRow;
    if (row.status === 'published' || opts?.allowDraft) return rowToStory(row);
  }
  const staticStory = STATIC_STORIES.find((s) => s.slug === slug);
  if (!staticStory) return null;
  return applyOverlay(staticToStory(staticStory), overlays.get(slug));
}

export async function loadStoryByPitchId(pitchId: string): Promise<Story | null> {
  const supabase = createClient();
  const { data } = await supabase.from('stories')
    .select(STORY_COLS)
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (!data) return null;
  return rowToStory(data as unknown as DbStoryRow);
}

/** Every story the desk can see: DB (any status) plus static founding stories. */
export async function loadDeskStories(): Promise<Story[]> {
  const supabase = createClient();
  const [{ data, error }, overlays] = await Promise.all([
    supabase.from('stories').select(STORY_COLS).order('published', { ascending: false }),
    loadDeskOverlays(),
  ]);
  const dbStories = (!error && data?.length) ? (data as unknown as DbStoryRow[]).map(rowToStory) : [];
  const bySlug = new Map<string, Story>();
  for (const s of STATIC_STORIES) {
    bySlug.set(s.slug, applyOverlay(staticToStory(s), overlays.get(s.slug)));
  }
  for (const s of dbStories) {
    if (isStaticStorySlug(s.slug)) continue;
    bySlug.set(s.slug, s);
  }
  return [...bySlug.values()];
}

export async function loadStoryLinksByPitch(): Promise<Record<string, { slug: string; status: string }>> {
  const supabase = createClient();
  const { data } = await supabase.from('stories')
    .select('pitch_id, slug, status')
    .not('pitch_id', 'is', null)
    .in('status', ['draft', 'published']);
  return Object.fromEntries(
    (data ?? [])
      .filter((r: { pitch_id: string | null }) => r.pitch_id)
      .map((r: { pitch_id: string; slug: string; status: string }) => [
        r.pitch_id,
        { slug: r.slug, status: r.status },
      ]),
  );
}

/**
 * Attach a generated still or clip produced outside the desk (e.g. Runway).
 * Does not call any generator. Writes `stories.art` for DB stories and
 * `story_desk.art` for static founding slugs.
 */
export async function attachGeneratedArtToStory(
  slug: string,
  piece: Omit<StoryArt, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): Promise<StoryArt[]> {
  const supabase = createClient();
  const now = new Date().toISOString();

  if (isStaticStorySlug(slug)) {
    const { data } = await supabase.from('story_desk')
      .select('slug, home_section, home_rank, pinned_hero, hero_image_url, hero_image_alt, art')
      .eq('slug', slug)
      .maybeSingle();
    const current = data as {
      home_section?: HomeSection | null;
      home_rank?: number | null;
      pinned_hero?: boolean | null;
      hero_image_url?: string | null;
      hero_image_alt?: string | null;
      art?: unknown;
    } | null;
    const art = attachGeneratedArt(current?.art, piece);
    const asHero = piece.kind === 'hero' || piece.kind === 'still';
    const { error } = await supabase.from('story_desk').upsert({
      slug,
      home_section: current?.home_section ?? null,
      home_rank: current?.home_rank ?? null,
      pinned_hero: current?.pinned_hero ?? false,
      hero_image_url: asHero ? piece.url : (current?.hero_image_url ?? null),
      hero_image_alt: asHero ? (piece.alt ?? current?.hero_image_alt ?? null) : (current?.hero_image_alt ?? null),
      art,
      updated_at: now,
    }, { onConflict: 'slug' });
    if (error) throw new Error(error.message);
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
  return art;
}
