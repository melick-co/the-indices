import { createClient } from '@/lib/supabase-server';
import type { VisualSpec } from '@/lib/visuals-data';

export type Visual = {
  slug: string; dataset_key: string; template: VisualSpec['template']; title: string; subtitle: string | null; takeaways: string[]; alt: string | null;
  spec: VisualSpec; sources: { org: string; dataset: string; url?: string }[]; videos: Record<string, string>; published_at: string;
};

const COLS = 'slug, dataset_key, template, title, subtitle, takeaways, alt, spec, sources, videos, published_at';

export async function loadVisuals(limit = 60): Promise<Visual[]> {
  const { data } = await createClient().from('visuals').select(COLS).eq('status', 'published').order('published_at', { ascending: false }).limit(limit);
  return (data ?? []) as Visual[];
}

export async function loadVisual(slug: string): Promise<Visual | null> {
  const { data } = await createClient().from('visuals').select(COLS).eq('slug', slug).eq('status', 'published').maybeSingle();
  return (data as Visual) ?? null;
}
