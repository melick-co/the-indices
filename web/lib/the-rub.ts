import { RUBS, type RubPiece } from '@/content/the-rub/seed';
import { createClient } from '@/lib/supabase-server';
import type { TrendingPageData } from '@/lib/trending-topics';

export type RubSelection = {
  rub: RubPiece;
  peg: string | null;
  matched: boolean;
};

type RubRow = { slug: string; title: string; keywords: string[] | null; peg: string | null; paragraphs: unknown; published: string | null };

function toPiece(r: RubRow): RubPiece | null {
  const paragraphs = Array.isArray(r.paragraphs) ? r.paragraphs.filter((p): p is string => typeof p === 'string') : [];
  if (!r.slug || !r.title || !paragraphs.length || !r.published) return null;
  return { slug: r.slug, title: r.title, keywords: r.keywords ?? [], published: r.published, ...(r.peg ? { peg: r.peg } : {}), paragraphs };
}

/**
 * Published columns, newest first, from the rubs table (agent/supabase/47_the_rub.sql). Until that migration has
 * run, or if the read fails or returns nothing, the static seed stands in, so the column never disappears.
 */
export async function loadRubs(): Promise<RubPiece[]> {
  try {
    const { data, error } = await createClient().from('rubs')
      .select('slug, title, keywords, peg, paragraphs, published')
      .eq('status', 'published')
      .order('published', { ascending: false });
    if (error || !data?.length) return RUBS;
    const pieces = (data as RubRow[]).map(toPiece).filter((p): p is RubPiece => !!p);
    return pieces.length ? pieces : RUBS;
  } catch (e) {
    // Next signals "render this on request" by throwing; that must reach Next, not become the static fallback.
    if ((e as { digest?: string } | null)?.digest === 'DYNAMIC_SERVER_USAGE') throw e;
    return RUBS;
  }
}

function haystack(trending: TrendingPageData | null): string[] {
  if (!trending) return [];
  return [
    ...(trending.rss_day?.topics ?? []),
    ...(trending.x_au_day?.topics ?? []),
    ...(trending.rss_week?.topics ?? []).slice(0, 5),
  ]
    .map((t) => t.topic.toLowerCase())
    .filter(Boolean);
}

/** Pure: the column whose keywords match a trending topic, else the day-of-year rotation. */
export function chooseRub(rubs: RubPiece[], trending: TrendingPageData | null, now = new Date()): RubSelection {
  const pool = rubs.length ? rubs : RUBS;
  const topics = haystack(trending);
  for (const rub of pool) {
    const hit = topics.find((topic) => rub.keywords.some((k) => topic.includes(k)));
    if (hit) return { rub, peg: hit, matched: true };
  }
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start) / 86_400_000);
  const rub = pool[day % pool.length];
  return { rub, peg: null, matched: false };
}

export function findRub(rubs: RubPiece[], slug: string): RubPiece | undefined {
  return rubs.find((r) => r.slug === slug);
}

export async function pickRub(trending: TrendingPageData | null, now = new Date()): Promise<RubSelection> {
  return chooseRub(await loadRubs(), trending, now);
}

export async function rubBySlug(slug: string): Promise<RubPiece | undefined> {
  return findRub(await loadRubs(), slug);
}
