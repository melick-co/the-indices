import { RUBS, type RubPiece } from '@/content/the-rub/seed';
import type { TrendingPageData } from '@/lib/trending-topics';

export type RubSelection = {
  rub: RubPiece;
  peg: string | null;
  matched: boolean;
};

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

export function pickRub(trending: TrendingPageData | null, now = new Date()): RubSelection {
  const topics = haystack(trending);
  for (const rub of RUBS) {
    const hit = topics.find((topic) => rub.keywords.some((k) => topic.includes(k)));
    if (hit) return { rub, peg: hit, matched: true };
  }
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start) / 86_400_000);
  const rub = RUBS[day % RUBS.length];
  return { rub, peg: null, matched: false };
}

export function rubBySlug(slug: string): RubPiece | undefined {
  return RUBS.find((r) => r.slug === slug);
}
