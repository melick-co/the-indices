import { createClient } from '@/lib/supabase-server';
import { STORIES as STATIC_STORIES } from '@/content/stories';
import type { Story, StoryBody, StoryEvidence, StoryOneNumber } from '@/lib/story-types';

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
};

function inferFrameCheck(kicker: string, title: string): boolean {
  return /\b(check|denominator|blindspot|flip|surprise|claim check|frame)\b/i
    .test(`${kicker} ${title}`);
}

function rowToStory(row: DbStoryRow): Story {
  return {
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
  };
}

const STORY_COLS =
  'story_id, pitch_id, slug, status, kicker, title, hook, caveat, published, one_number, evidence, body, frame_check';

export async function loadPublishedDbStories(): Promise<Story[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('stories')
    .select(STORY_COLS)
    .eq('status', 'published')
    .order('published', { ascending: false });
  if (error || !data?.length) return [];
  return (data as DbStoryRow[]).map(rowToStory);
}

/** Static registry plus DB-published stories; DB wins on slug collision. */
export async function loadAllStories(): Promise<Story[]> {
  const dbStories = await loadPublishedDbStories();
  const bySlug = new Map<string, Story>();
  for (const s of STATIC_STORIES) bySlug.set(s.slug, { ...s, status: 'published' });
  for (const s of dbStories) bySlug.set(s.slug, s);
  return [...bySlug.values()].sort((a, b) => b.published.localeCompare(a.published));
}

export async function loadStoryBySlug(
  slug: string,
  opts?: { allowDraft?: boolean },
): Promise<Story | null> {
  const supabase = createClient();
  const { data } = await supabase.from('stories')
    .select(STORY_COLS)
    .eq('slug', slug)
    .maybeSingle();
  if (data) {
    const row = data as DbStoryRow;
    if (row.status === 'published' || opts?.allowDraft) return rowToStory(row);
  }
  const staticStory = STATIC_STORIES.find((s) => s.slug === slug);
  return staticStory ? { ...staticStory, status: 'published' } : null;
}

export async function loadStoryByPitchId(pitchId: string): Promise<Story | null> {
  const supabase = createClient();
  const { data } = await supabase.from('stories')
    .select(STORY_COLS)
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (!data) return null;
  return rowToStory(data as DbStoryRow);
}

/** Map pitch_id → { slug, status } for Foundry/Studio boards (includes drafts). */
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
