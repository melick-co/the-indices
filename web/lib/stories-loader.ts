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
};

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
  };
}

export async function loadPublishedDbStories(): Promise<Story[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('stories')
    .select('story_id, pitch_id, slug, status, kicker, title, hook, caveat, published, one_number, evidence, body')
    .eq('status', 'published')
    .order('published', { ascending: false });
  if (error || !data?.length) return [];
  return (data as DbStoryRow[]).map(rowToStory);
}

/** Static registry plus DB-published stories; DB wins on slug collision. */
export async function loadAllStories(): Promise<Story[]> {
  const dbStories = await loadPublishedDbStories();
  const bySlug = new Map<string, Story>();
  for (const s of STATIC_STORIES) bySlug.set(s.slug, s);
  for (const s of dbStories) bySlug.set(s.slug, s);
  return [...bySlug.values()].sort((a, b) => b.published.localeCompare(a.published));
}

export async function loadStoryBySlug(slug: string): Promise<Story | null> {
  const dbStories = await loadPublishedDbStories();
  const fromDb = dbStories.find((s) => s.slug === slug);
  if (fromDb) return fromDb;
  return STATIC_STORIES.find((s) => s.slug === slug) ?? null;
}

export async function loadStoryByPitchId(pitchId: string): Promise<Story | null> {
  const supabase = createClient();
  const { data } = await supabase.from('stories')
    .select('story_id, pitch_id, slug, status, kicker, title, hook, caveat, published, one_number, evidence, body')
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (!data) return null;
  return rowToStory(data as DbStoryRow);
}
