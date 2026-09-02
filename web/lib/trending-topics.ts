import { createClient } from '@/lib/supabase-server';

export type TrendTopic = {
  rank: number;
  topic: string;
  score?: number | null;
  mention_count?: number | null;
  tweet_volume?: number | null;
  summary?: string | null;
  url?: string | null;
  sample_headlines?: Array<{ title: string; link?: string | null }>;
};

export type TrendSnapshot = {
  source: 'rss' | 'x';
  region: 'au' | 'global';
  window_type: '1d' | '7d';
  period_end: string;
  topics: TrendTopic[];
  item_count: number;
  computed_at: string | null;
};

export type TrendingPageData = {
  period_end: string | null;
  rss_day: TrendSnapshot | null;
  rss_week: TrendSnapshot | null;
  x_au_day: TrendSnapshot | null;
  x_au_week: TrendSnapshot | null;
  x_global_day: TrendSnapshot | null;
  x_global_week: TrendSnapshot | null;
  x_configured: boolean;
};

async function latestSnapshot(
  supabase: ReturnType<typeof createClient>,
  source: string,
  region: string,
  windowType: string,
) {
  const { data } = await supabase.from('trending_snapshots')
    .select('source, region, window_type, period_end, topics, item_count, computed_at')
    .eq('source', source)
    .eq('region', region)
    .eq('window_type', windowType)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    ...data,
    topics: (data.topics ?? []) as TrendTopic[],
  } as TrendSnapshot;
}

export async function loadTrendingPage(): Promise<TrendingPageData> {
  const supabase = createClient();
  const [rss_day, rss_week, x_au_day, x_au_week, x_global_day, x_global_week] = await Promise.all([
    latestSnapshot(supabase, 'rss', 'au', '1d'),
    latestSnapshot(supabase, 'rss', 'au', '7d'),
    latestSnapshot(supabase, 'x', 'au', '1d'),
    latestSnapshot(supabase, 'x', 'au', '7d'),
    latestSnapshot(supabase, 'x', 'global', '1d'),
    latestSnapshot(supabase, 'x', 'global', '7d'),
  ]);

  const period_end = rss_day?.period_end
    ?? rss_week?.period_end
    ?? x_au_day?.period_end
    ?? null;

  const x_configured = Boolean(
    (x_au_day?.topics?.length ?? 0) > 0
    || (x_global_day?.topics?.length ?? 0) > 0
    || (x_au_week?.topics?.length ?? 0) > 0,
  );

  return {
    period_end,
    rss_day,
    rss_week,
    x_au_day,
    x_au_week,
    x_global_day,
    x_global_week,
    x_configured,
  };
}

export function formatPeriodEnd(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
