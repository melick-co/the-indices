import { sortStoriesByTrend, type TrendIndexEntry } from '@/lib/trend-weight';
import type { HomeSection, Story } from '@/lib/story-types';

export type HomeStory = Pick<
  Story,
  'slug' | 'kicker' | 'title' | 'hook' | 'published' | 'frameCheck' | 'homeSection' | 'homeRank' | 'pinnedHero'
>;

export type HomeLayout<T extends HomeStory> = {
  hero: T | null;
  frameChecks: T[];
  stories: T[];
  /** Published pieces other than the lead, desk-then-trend order. */
  rest: T[];
};

/** Grid section a story belongs in. Desk placement wins; otherwise frameCheck. */
export function visualHomeSection(story: HomeStory): Exclude<HomeSection, 'hero'> {
  if (story.homeSection === 'frame_checks') return 'frame_checks';
  if (story.homeSection === 'stories') return 'stories';
  return story.frameCheck ? 'frame_checks' : 'stories';
}

function hasManualRank(story: HomeStory): boolean {
  return story.homeRank != null && Number.isFinite(story.homeRank);
}

/**
 * Honour desk order when a story has been placed; fall back to trend sort
 * for everything else. Placed stories sit above unplaced ones in a section.
 */
export function compareDeskThenTrend<T extends HomeStory>(
  a: T,
  b: T,
  trendRank: Map<string, number>,
): number {
  const aPlaced = hasManualRank(a);
  const bPlaced = hasManualRank(b);
  if (aPlaced && bPlaced && a.homeRank !== b.homeRank) {
    return (a.homeRank as number) - (b.homeRank as number);
  }
  if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
  return (trendRank.get(a.slug) ?? 9999) - (trendRank.get(b.slug) ?? 9999);
}

export function buildHomeLayout<T extends HomeStory>(
  published: T[],
  trendIndex: TrendIndexEntry[],
): HomeLayout<T> {
  const trendSorted = sortStoriesByTrend(published, trendIndex);
  const trendRank = new Map(trendSorted.map((s, i) => [s.slug, i]));
  const cmp = (a: T, b: T) => compareDeskThenTrend(a, b, trendRank);

  const frameChecks = published.filter((s) => visualHomeSection(s) === 'frame_checks').sort(cmp);
  const stories = published.filter((s) => visualHomeSection(s) === 'stories').sort(cmp);

  const pinned = published.filter((s) => s.pinnedHero).sort(cmp);
  const hero = pinned[0] ?? frameChecks[0] ?? stories[0] ?? null;
  const rest = published.filter((s) => s.slug !== hero?.slug).sort(cmp);

  return { hero, frameChecks, stories, rest };
}
