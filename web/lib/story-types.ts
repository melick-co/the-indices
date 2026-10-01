/** Shared story shape for static registry and DB-generated stories. */

export interface SourceRow {
  metric: string;
  org: string;
  tier: 1 | 2 | 3;
  url: string;
  period: string;
  basis: string;
}

/** A numbered source note; body text cites it as [^n] (NEWS-STYLE.md §5). */
export interface Footnote {
  n: number;
  /** Organisation, title, dataset or publication, date, page or section. */
  text: string;
  url?: string;
}

export interface StoryEvidence {
  table?: { head: string[]; rows: string[][] };
  sources: SourceRow[];
  footnotes?: Footnote[];
}

export interface StoryOneNumber {
  value: string;
  label: string;
  /** When set, value, period and comparison are computed from this stored series (hero stat card). */
  metric_id?: string;
  period?: string;
  /** e.g. "up 0.6 pts on a year earlier"; computed, never written by the model. */
  comparison?: string;
  /** Direction of the change, for the ▲/▼ marker. */
  direction?: 'up' | 'down' | 'flat';
  footnote?: number;
}

export type ChartKind = 'bars' | 'rank_swap' | 'timeline' | 'line';

export type ChartSeriesPoint = {
  label: string;
  value: number;
  highlight?: boolean;
};

/**
 * Where a chart's numbers come from. When present, series values are filled
 * from stored observations by lib/chart-from-data.ts, never typed by a model.
 */
export type ChartDataSpec = {
  metric_id: string;
  /** latest_by_entity: one bar per country at the latest period; timeline: one entity over time. */
  mode: 'latest_by_entity' | 'timeline';
  /** ISO3 codes to include (latest_by_entity). Defaults to the top values plus Australia. */
  entities?: string[];
  /** Entity for a timeline. Defaults to AUS. */
  entity?: string;
  /** Number of most recent periods for a timeline. Defaults to 12. */
  last?: number;
  /** Second metric for rank_swap, compared on the same entities. */
  alt_metric_id?: string;
};

export type StoryChartBlock = {
  type: 'chart';
  kind: ChartKind;
  /** Takeaway headline ("Sales fell for a third straight quarter"), not the topic. */
  title?: string;
  /** Units, timeframe and what is measured. */
  subtitle?: string;
  /** Screen-reader description of the takeaway. */
  alt?: string;
  /** Footnote the source line links to. */
  footnote?: number;
  caption?: string;
  series: ChartSeriesPoint[];
  alt_series?: ChartSeriesPoint[];
  primary_label?: string;
  alt_label?: string;
  data?: ChartDataSpec;
  /** Set when series were filled from the store: which metric(s) and period(s). */
  bound?: { metric_id: string; period: string; alt_metric_id?: string; alt_period?: string };
};

/** Where a paragraph sits in the news structure (NEWS-STYLE.md §2). */
export type ParagraphRole = 'lede' | 'nut' | 'evidence' | 'context' | 'to_be_sure' | 'whats_next' | 'kicker';

/** A direct quote; runs only if verified word for word against source_url. */
export type StoryQuoteBlock = {
  type: 'quote';
  text: string;
  speaker: string;
  /** Speaker's title and organisation, e.g. "Governor, Reserve Bank of Australia". */
  title?: string;
  /** Where and when it was said, e.g. "Monetary policy decision statement, 30 September 2026". */
  said?: string;
  source_url: string;
  footnote?: number;
  verified?: boolean;
};

export type StoryTimelineBlock = {
  type: 'timeline';
  title: string;
  subtitle?: string;
  events: { date: string; label: string; footnote?: number }[];
};

export type StoryBlock =
  | { type: 'paragraph'; text: string; role?: ParagraphRole }
  | { type: 'layers'; items: string[] }
  | { type: 'heading'; text: string }
  | { type: 'pull'; text: string }
  | StoryQuoteBlock
  | StoryTimelineBlock
  | StoryChartBlock;

export interface StoryBody {
  blocks: StoryBlock[];
}

export type HomeSection = 'hero' | 'frame_checks' | 'stories';

export type StoryArtKind = 'still' | 'clip' | 'hero';
export type StoryArtSource = 'upload' | 'url' | 'generated';

/**
 * A still or clip attached to a story. The News Desk reads these; generators
 * (ElevenLabs or otherwise) write them via `attachGeneratedArt` in story-art.ts.
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
