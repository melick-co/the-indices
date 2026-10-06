import { createClient } from '@/lib/supabase-server';
import type { VisualSpec } from '@/lib/visuals-data';

export type Visual = {
  slug: string; dataset_key: string; template: VisualSpec['template']; title: string; subtitle: string | null; takeaways: string[]; alt: string | null;
  spec: VisualSpec; sources: { org: string; dataset: string; url?: string }[]; videos: Record<string, string>; published_at: string;
};

const COLS = 'slug, dataset_key, template, title, subtitle, takeaways, alt, spec, sources, videos, published_at';

/** Newest first. A race re-rendered on a later day replaces the earlier one, so only its newest render is listed. */
export async function loadVisuals(limit = 60): Promise<Visual[]> {
  const { data } = await createClient().from('visuals').select(COLS).eq('status', 'published')
    // Extra rows, so dropping older race renders still leaves `limit` to show.
    .order('published_at', { ascending: false }).limit(limit + 20);
  const seen = new Set<string>();
  return ((data ?? []) as Visual[]).filter((v) => {
    if (v.template !== 'race') return true;
    if (seen.has(v.dataset_key)) return false;
    seen.add(v.dataset_key);
    return true;
  }).slice(0, limit);
}

/** For an older render of a race: the slug of its newest render, or null if this one is the newest (or not a race). */
export async function newerRace(v: Visual): Promise<string | null> {
  if (v.template !== 'race') return null;
  const { data } = await createClient().from('visuals').select('slug').eq('dataset_key', v.dataset_key).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(1).maybeSingle();
  return data?.slug && data.slug !== v.slug ? data.slug : null;
}

export async function loadVisual(slug: string): Promise<Visual | null> {
  const { data } = await createClient().from('visuals').select(COLS).eq('slug', slug).eq('status', 'published').maybeSingle();
  return (data as Visual) ?? null;
}
