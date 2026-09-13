import { createClient } from '@/lib/supabase-server';

export type MetricMeta = {
  metric_id: string;
  name: string;
  unit: string;
  basis: string | null;
  direction: string | null;
  category: string | null;
  source_tier: number | null;
  source_org: string | null;
  source_dataset: string | null;
  source_url: string | null;
  source_published: string | null;
  period: string | null;
};

export type MetricObservation = {
  period: string;
  value: number;
  status?: string | null;
};

export type DialScale = {
  min: number;
  max: number;
  invertScale?: boolean;
  decimals?: number;
  compact?: boolean;
};

/** Fixed dial bounds — green at favourable end, red at pressure end. */
export const DIAL_SCALES: Record<string, DialScale> = {
  gdp_per_capita: { min: 25_000, max: 90_000, invertScale: true, compact: true },
  productivity_level: { min: 40, max: 120, invertScale: true, decimals: 1 },
  productivity_growth_10y: { min: -1, max: 4, invertScale: true, decimals: 1 },
  government_debt_gdp: { min: 10, max: 150, decimals: 0 },
  household_debt_income_au: { min: 100, max: 250, decimals: 0 },
  years_to_buy_home: { min: 5, max: 25, decimals: 1 },
  unemployment_rate: { min: 2, max: 12, decimals: 1 },
  inflation_rate: { min: 0, max: 8, decimals: 1 },
  cash_rate_au: { min: 0, max: 8, decimals: 2 },
  bond_yield_10y_au: { min: 0, max: 8, decimals: 2 },
  cpi_annual_au: { min: 0, max: 8, decimals: 1 },
  wpi_annual_au: { min: 0, max: 6, decimals: 1 },
  credit_housing_12m_au: { min: 0, max: 12, invertScale: true, decimals: 1 },
};

const OECD_LIKE = new Set([
  'AUS', 'AUT', 'BEL', 'CAN', 'CHL', 'COL', 'CRI', 'CZE', 'DNK', 'EST',
  'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN',
  'KOR', 'LVA', 'LTU', 'LUX', 'MEX', 'NLD', 'NZL', 'NOR', 'POL', 'PRT',
  'SVK', 'SVN', 'ESP', 'SWE', 'CHE', 'TUR', 'GBR', 'USA',
]);

function parsePeriod(period: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Date(`${period}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(period)) return new Date(`${period}-01T00:00:00Z`);
  if (/^\d{4}-Q[1-4]$/i.test(period)) {
    const [y, q] = period.split('-Q');
    const m = (Number(q) - 1) * 3;
    return new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00Z`);
  }
  if (/^\d{4}$/.test(period)) return new Date(`${period}-07-01T00:00:00Z`);
  return new Date(period);
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

const META_COLS = 'metric_id, name, unit, basis, direction, category, source_tier, source_org, source_dataset, source_url, source_published, period';

export async function loadMetricMetaBatch(metricIds: string[]): Promise<Map<string, MetricMeta>> {
  const supabase = createClient();
  const { data } = await supabase.from('metrics').select(META_COLS).in('metric_id', metricIds);
  return new Map((data ?? []).map((row) => [row.metric_id, row as MetricMeta]));
}

export async function loadMetricMeta(metricId: string): Promise<MetricMeta | null> {
  const supabase = createClient();
  const { data } = await supabase.from('metrics')
    .select('metric_id, name, unit, basis, direction, category, source_tier, source_org, source_dataset, source_url, source_published, period')
    .eq('metric_id', metricId)
    .maybeSingle();
  return data ?? null;
}

export async function loadLatestAus(metricId: string): Promise<MetricObservation | null> {
  const supabase = createClient();
  const { data } = await supabase.from('observations')
    .select('period, value, status')
    .eq('metric_id', metricId)
    .eq('entity', 'AUS')
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.value == null) return null;
  return { period: data.period, value: data.value, status: data.status };
}

/**
 * Latest observations plus a short recent history for each metric, oldest first.
 * One bounded query per metric: a single `in` query would share PostgREST's row
 * cap and could silently drop whichever series happened to sort last.
 */
export async function loadRecentSeries(
  metricIds: string[],
  pointsPerMetric = 16,
): Promise<Map<string, MetricObservation[]>> {
  const supabase = createClient();
  const results = await Promise.all(metricIds.map(async (metricId) => {
    const { data } = await supabase.from('observations')
      .select('period, value, status')
      .eq('metric_id', metricId)
      .eq('entity', 'AUS')
      .order('period', { ascending: false })
      .limit(pointsPerMetric);
    const rows = (data ?? [])
      .filter((r) => r.value != null)
      .reverse() as MetricObservation[];
    return [metricId, rows] as const;
  }));
  return new Map(results.filter(([, rows]) => rows.length));
}

/** How far behind today's date an observation is, in whole months. */
function observationAgeMonths(period: string): number {
  const then = parsePeriod(period);
  if (Number.isNaN(then.getTime())) return 0;
  const now = new Date();
  return (now.getUTCFullYear() - then.getUTCFullYear()) * 12
    + (now.getUTCMonth() - then.getUTCMonth());
}

/**
 * Plain-language age for readings that are well behind today. Annual series are
 * always a year or two back by nature, so only flag what a reader would call old.
 */
export function readingAgeLabel(period: string): string | undefined {
  const months = observationAgeMonths(period);
  if (months < 18) return undefined;
  const years = Math.floor(months / 12);
  if (years < 2) return `${months} months old`;
  return `${years} years old`;
}

/** Signed change against the observation `back` steps earlier in the series. */
export function seriesChange(
  series: MetricObservation[] | undefined,
  back = 1,
): { delta: number; from: string } | undefined {
  if (!series || series.length < back + 1) return undefined;
  const latest = series[series.length - 1];
  const prior = series[series.length - 1 - back];
  if (latest.value == null || prior.value == null) return undefined;
  return { delta: latest.value - prior.value, from: prior.period };
}

export async function loadSeriesHistory(
  metricId: string,
  months = 12,
  step = false,
): Promise<MetricObservation[]> {
  const supabase = createClient();
  const { data } = await supabase.from('observations')
    .select('period, value, status')
    .eq('metric_id', metricId)
    .eq('entity', 'AUS')
    .order('period', { ascending: true })
    .limit(500);
  const all = (data ?? []).filter((r) => r.value != null) as MetricObservation[];
  const cutoff = monthsAgo(months).getTime();
  const inWindow = all.filter((r) => parsePeriod(r.period).getTime() >= cutoff);
  if (step) {
    const before = all.filter((r) => parsePeriod(r.period).getTime() < cutoff);
    if (before.length && inWindow.length) return [before[before.length - 1], ...inWindow];
    if (before.length && !inWindow.length) return before.slice(-2);
  }
  if (inWindow.length) return inWindow;
  return all.slice(-Math.min(24, all.length));
}

async function loadCrossSection(metricId: string): Promise<{ entity: string; value: number }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('observations')
    .select('entity, period, value')
    .eq('metric_id', metricId)
    .order('period', { ascending: false })
    .limit(5000);
  const latest = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.value == null || latest.has(row.entity)) continue;
    if (!OECD_LIKE.has(row.entity)) continue;
    latest.set(row.entity, row.value);
  }
  return [...latest.entries()].map(([entity, value]) => ({ entity, value }));
}

/**
 * Australia's standing against OECD peers, counted from the end of the
 * distribution the reader cares about: highest where more is better, lowest
 * where more is pressure. Counting from the wrong end reads as the opposite
 * verdict, so the direction of the metric decides.
 */
export async function oecdPercentileFootnote(
  metricId: string,
  value: number | null,
  direction: 'higher_is_more_pressure' | 'higher_is_less_pressure' | string | null,
): Promise<string | undefined> {
  if (value == null) return undefined;
  const peers = await loadCrossSection(metricId);
  if (peers.length < 5) return undefined;
  const higherIsGood = direction === 'higher_is_less_pressure';

  // Sort so position 1 is the favourable end for this metric.
  const sorted = [...peers].sort((a, b) => (higherIsGood ? b.value - a.value : a.value - b.value));
  const end = higherIsGood ? 'highest' : 'lowest';
  const index = sorted.findIndex((p) => p.entity === 'AUS');

  if (index < 0) {
    const better = sorted.filter((p) => (higherIsGood ? p.value > value : p.value < value)).length;
    return `${ordinal(better + 1)} ${end} of ${sorted.length + 1} OECD`;
  }
  return `${ordinal(index + 1)} ${end} of ${sorted.length} OECD`;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0];
  return `${n}${suffix}`;
}

export function formatDebtPerPerson(
  debtGdpPct: number | null,
  gdpNominalUsd: number | null,
  population: number | null,
): string | undefined {
  if (debtGdpPct == null || gdpNominalUsd == null || !population) return undefined;
  const perPerson = (debtGdpPct / 100 * gdpNominalUsd) / population;
  if (!Number.isFinite(perPerson)) return undefined;
  return `≈ ${formatUsd(perPerson)} per person`;
}

export function formatUsd(n: number, compact = false) {
  if (compact && n >= 1000) {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n);
}

export function formatPeriodLabel(period: string) {
  if (/^\d{4}-Q[1-4]$/i.test(period)) return period.replace('-Q', ' Q');
  if (/^\d{4}$/.test(period)) return period;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return new Date(`${period}T00:00:00Z`).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-AU', {
      month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }
  return period;
}
