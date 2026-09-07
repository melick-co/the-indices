import type { TrendingPageData, TrendSnapshot, TrendTopic } from '@/lib/trending-topics';

/** Relative emphasis mirrors the trending page: yesterday's news weighs most. */
const FEED_WEIGHTS: Array<{ snap: keyof TrendingPageData; multiplier: number }> = [
  { snap: 'rss_day', multiplier: 1.0 },
  { snap: 'rss_week', multiplier: 0.5 },
  { snap: 'x_au_day', multiplier: 0.7 },
  { snap: 'x_au_week', multiplier: 0.35 },
  { snap: 'x_global_day', multiplier: 0.25 },
  { snap: 'x_global_week', multiplier: 0.12 },
];

export type TrendIndexEntry = {
  topic: string;
  weight: number;
  tokens: string[];
};

function isSnapshot(s: unknown): s is TrendSnapshot {
  return s != null && typeof s === 'object' && 'topics' in s;
}

function topicBaseScore(topic: TrendTopic): number {
  if (topic.score != null && Number.isFinite(topic.score)) return topic.score;
  const rank = topic.rank ?? 10;
  return Math.max(1, 11 - rank);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function normalizeTopicLabel(raw: string): string {
  return raw.replace(/^#+/, '').trim();
}

/** Combined trend index from all snapshots on the trending page. */
export function buildTrendIndex(data: TrendingPageData): TrendIndexEntry[] {
  const byKey = new Map<string, TrendIndexEntry>();

  for (const { snap, multiplier } of FEED_WEIGHTS) {
    const snapshot = data[snap];
    if (!isSnapshot(snapshot)) continue;
    for (const t of snapshot.topics ?? []) {
      const label = normalizeTopicLabel(t.topic);
      if (!label) continue;
      const key = label.toLowerCase();
      const contribution = topicBaseScore(t) * multiplier;
      const tokens = [
        ...tokenize(label),
        ...(t.summary ? tokenize(t.summary) : []),
        ...(t.sample_headlines ?? []).flatMap((h) => tokenize(h.title)),
      ];
      const existing = byKey.get(key);
      if (existing) {
        existing.weight += contribution;
        existing.tokens = [...new Set([...existing.tokens, ...tokens])];
      } else {
        byKey.set(key, { topic: label, weight: contribution, tokens: [...new Set(tokens)] });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => b.weight - a.weight);
}

/** Score searchable text against the combined trend index (higher = more topical now). */
export function scoreTextAgainstTrends(text: string, index: TrendIndexEntry[]): number {
  if (!text.trim() || !index.length) return 0;
  const hay = text.toLowerCase();
  const hayTokens = new Set(tokenize(text));
  let total = 0;

  for (const entry of index) {
    const topicLower = entry.topic.toLowerCase();
    if (topicLower.length >= 4 && hay.includes(topicLower)) {
      total += entry.weight * 1.5;
      continue;
    }
    const matched = entry.tokens.filter((t) => hayTokens.has(t) || hay.includes(t));
    if (!matched.length) continue;
    const overlap = matched.length / Math.max(entry.tokens.length, 1);
    total += entry.weight * Math.min(1, overlap + 0.25);
  }

  return total;
}

export function sortByTrendScore<T>(
  items: T[],
  index: TrendIndexEntry[],
  textOf: (item: T) => string,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const scored = items.map((item) => ({
    item,
    trendScore: scoreTextAgainstTrends(textOf(item), index),
  }));
  scored.sort((a, b) => {
    if (b.trendScore !== a.trendScore) return b.trendScore - a.trendScore;
    return tieBreak ? tieBreak(a.item, b.item) : 0;
  });
  return scored.map((s) => s.item);
}

export type PitchLike = {
  headline: string;
  hook?: string | null;
  mechanism?: string | null;
  metric_ids?: string[] | null;
  rank_value?: number | null;
  first_seen?: string;
  trigger_rows?: { keywords?: string[]; label?: string } | null;
};

export function pitchTrendText(p: PitchLike): string {
  const parts = [
    p.headline,
    p.hook,
    p.mechanism,
    p.metric_ids?.join(' '),
    p.trigger_rows?.label,
    ...(p.trigger_rows?.keywords ?? []),
  ];
  return parts.filter(Boolean).join(' ');
}

export function sortPitchesByTrend<T extends PitchLike>(pitches: T[], index: TrendIndexEntry[]): T[] {
  const stateOrder = ['pitched', 'candidate', 'approved', 'watchlist', 'dormant', 'rejected', 'published'];
  const byState = new Map<string, T[]>();
  for (const p of pitches) {
    const state = (p as PitchLike & { state?: string }).state ?? 'candidate';
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state)!.push(p);
  }
  const out: T[] = [];
  for (const state of stateOrder) {
    const group = byState.get(state);
    if (!group?.length) continue;
    out.push(...sortByTrendScore(group, index, pitchTrendText, (a, b) => {
      const rankDiff = (b.rank_value ?? 0) - (a.rank_value ?? 0);
      if (rankDiff) return rankDiff;
      return (b.first_seen ?? '').localeCompare(a.first_seen ?? '');
    }));
  }
  for (const [state, group] of byState) {
    if (stateOrder.includes(state)) continue;
    out.push(...sortByTrendScore(group, index, pitchTrendText));
  }
  return out;
}

export type StoryLike = {
  slug: string;
  kicker: string;
  title: string;
  hook: string;
  published: string;
};

export function storyTrendText(s: StoryLike): string {
  return [s.slug.replace(/-/g, ' '), s.kicker, s.title, s.hook].join(' ');
}

export function sortStoriesByTrend<T extends StoryLike>(stories: T[], index: TrendIndexEntry[]): T[] {
  return sortByTrendScore(stories, index, storyTrendText, (a, b) =>
    b.published.localeCompare(a.published),
  );
}
