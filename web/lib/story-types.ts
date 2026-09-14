/** Shared story shape for static registry and DB-generated stories. */

export interface SourceRow {
  metric: string;
  org: string;
  tier: 1 | 2 | 3;
  url: string;
  period: string;
  basis: string;
}

export interface StoryEvidence {
  table?: { head: string[]; rows: string[][] };
  sources: SourceRow[];
}

export interface StoryOneNumber {
  value: string;
  label: string;
}

export type ChartKind = 'bars' | 'rank_swap' | 'timeline';

export type ChartSeriesPoint = {
  label: string;
  value: number;
  highlight?: boolean;
};

export type StoryChartBlock = {
  type: 'chart';
  kind: ChartKind;
  title?: string;
  caption?: string;
  series: ChartSeriesPoint[];
  alt_series?: ChartSeriesPoint[];
  primary_label?: string;
  alt_label?: string;
};

export type StoryBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'layers'; items: string[] }
  | { type: 'heading'; text: string }
  | { type: 'pull'; text: string }
  | StoryChartBlock;

export interface StoryBody {
  blocks: StoryBlock[];
}

export type HomeSection = 'hero' | 'frame_checks' | 'stories';

export type StoryArtKind = 'still' | 'clip' | 'hero';
export type StoryArtSource = 'upload' | 'url' | 'generated';

/**
 * A still or clip attached to a story. The News Desk reads these; generators
 * (Runway or otherwise) write them via `attachGeneratedArt` in story-art.ts.
 * Do not call a generator from the desk.
 */
export interface StoryArt {
  id: string;
  kind: StoryArtKind;
  url: string;
  alt?: string;
  source: StoryArtSource;
  /** Set when source is generated, e.g. 'runway'. */
  generator?: string;
  prompt?: string;
  createdAt: string;
}

export interface Story {
  slug: string;
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  published: string;
  oneNumber: StoryOneNumber;
  evidence: StoryEvidence;
  /** Present for agent-generated stories; static stories use React body components. */
  body?: StoryBody;
  pitchId?: string;
  /**
   * Marks a story that corrects a widely shared frame (denominator flip,
   * viral claim check, rank surprise). Surfaces in the home Frame checks section
   * unless the desk has placed it elsewhere.
   */
  frameCheck?: boolean;
  /** Draft stories are preview-only until an editor promotes them. */
  status?: 'draft' | 'published' | 'archived';
  /** Desk placement. Null = auto from frameCheck, then trend sort. */
  homeSection?: HomeSection | null;
  /** Manual order within a home section. Null = fall back to trend sort. */
  homeRank?: number | null;
  /** When true, this story is the home hero regardless of trend. */
  pinnedHero?: boolean;
  heroImageUrl?: string | null;
  heroImageAlt?: string | null;
  /** Attached stills/clips, including generator output. */
  art?: StoryArt[];
  /** True for founding stories whose body is a React component in the repo. */
  staticBody?: boolean;
  storyId?: string;
}

/** Best (lowest) tier and unique publisher names for the receipt strip. */
export function storyReceipt(story: Story): { tier: 1 | 2 | 3; orgs: string } {
  const sources = story.evidence?.sources ?? [];
  const tier = (sources.reduce((best, s) => Math.min(best, s.tier) as 1 | 2 | 3, 3 as 1 | 2 | 3));
  const orgs = [...new Set(sources.map((s) => s.org).filter(Boolean))];
  return {
    tier: sources.length ? tier : 3,
    orgs: orgs.length ? orgs.join(' + ') : 'Sources pending',
  };
}
