import { ALL_INDICES } from '@/content/indices/registry';
import { loadRbaRateIndicator } from '@/lib/rba-rate-indicator';
import {
  DIAL_SCALES,
  formatDebtPerPerson,
  formatPeriodLabel,
  loadMetricMetaBatch,
  loadRecentSeries,
  oecdPercentileFootnote,
  readingAgeLabel,
  seriesChange,
  type MetricObservation,
} from '@/lib/metrics';

export type DashboardDial = {
  id: string;
  href: string;
  label: string;
  subtitle: string;
  kicker: string;
  tier: string;
  value: number | null;
  unit: string;
  min?: number;
  max?: number;
  invertScale?: boolean;
  decimals?: number;
  compact?: boolean;
  footnote?: string;
  spark?: { period: string; value: number }[];
  step?: boolean;
  change?: string;
  age?: string;
};

export type DashboardSection = {
  id: string;
  title: string;
  description?: string;
  dials: DashboardDial[];
};

/** One row of the readings table: every number on the page, with its receipt. */
export type ReadingRow = {
  id: string;
  href?: string;
  label: string;
  value: string;
  unit: string;
  period: string;
  change: string;
  source: string;
  tier: number | null;
};

/**
 * Metrics shown as dials, in display order. Each entry names the series, how to
 * read it, and how far back to look for a comparison. Anything with more than one
 * Australian observation also gets a sparkline.
 */
type DialSpec = {
  metricId: string;
  label: string;
  kicker: string;
  tier: string;
  unit: string;
  /** Policy rates hold their level between announcements. */
  step?: boolean;
  /** Rank Australia against OECD peers using this direction. */
  rank?: 'higher_is_more_pressure' | 'higher_is_less_pressure';
  note?: string;
};

const RATE_DIALS: DialSpec[] = [
  {
    metricId: 'cash_rate_au',
    label: 'RBA cash rate',
    kicker: 'Monetary · Australia',
    tier: 'Tier 1 · RBA target as announced',
    unit: 'percent',
    step: true,
  },
  {
    metricId: 'bond_yield_10y_au',
    label: '10-year bond yield',
    kicker: 'Markets · Australia',
    tier: 'Tier 1 · RBA F17 zero-coupon curve',
    unit: 'percent',
  },
];

const PRICE_DIALS: DialSpec[] = [
  {
    metricId: 'cpi_annual_au',
    label: 'CPI inflation',
    kicker: 'Prices · Australia',
    tier: 'Tier 1 · ABS all groups CPI, year on year',
    unit: 'percent',
  },
  {
    metricId: 'wpi_annual_au',
    label: 'Wage growth',
    kicker: 'Labour · Australia',
    tier: 'Tier 1 · ABS wage price index, year on year',
    unit: 'percent',
    note: 'Read against CPI, not on its own',
  },
];

const HOUSEHOLD_DIALS: DialSpec[] = [
  {
    metricId: 'household_debt_income_au',
    label: 'Household debt to income',
    kicker: 'Households · Australia',
    tier: 'Tier 1 · RBA table E2',
    unit: 'percent',
  },
  {
    metricId: 'credit_housing_12m_au',
    label: 'Housing credit growth',
    kicker: 'Credit · Australia',
    tier: 'Tier 1 · RBA housing credit, 12-month change',
    unit: 'percent',
  },
  {
    metricId: 'years_to_buy_home',
    label: 'Years to buy a home',
    kicker: 'Housing · Australia',
    tier: 'Tier 3 · 90m² city centre, net income',
    unit: 'years',
    rank: 'higher_is_more_pressure',
  },
];

const ECONOMY_DIALS: DialSpec[] = [
  {
    metricId: 'gdp_per_capita',
    label: 'GDP per capita',
    kicker: 'Economy · Australia',
    tier: 'Tier 1 · IMF WEO nominal USD',
    unit: 'USD',
    rank: 'higher_is_less_pressure',
  },
  {
    metricId: 'productivity_level',
    label: 'Productivity level',
    kicker: 'Productivity · Australia',
    tier: 'Tier 1 · GDP per hour worked, PPP',
    unit: 'USD PPP',
    rank: 'higher_is_less_pressure',
  },
  {
    metricId: 'productivity_growth_10y',
    label: 'Productivity growth',
    kicker: 'Productivity · Australia',
    tier: 'Tier 1 · 10-year CAGR, 2010 to 2020',
    unit: 'percent per year',
    rank: 'higher_is_less_pressure',
  },
  {
    metricId: 'unemployment_rate',
    label: 'Unemployment',
    kicker: 'Labour · Australia',
    tier: 'Tier 1 · ILO estimate, World Bank WDI',
    unit: 'percent',
    rank: 'higher_is_more_pressure',
  },
  {
    metricId: 'government_debt_gdp',
    label: 'Government debt',
    kicker: 'Fiscal · Australia',
    tier: 'Tier 1 · World Bank central govt debt',
    unit: 'percent',
    rank: 'higher_is_more_pressure',
  },
];

const ALL_DIAL_SPECS = [...RATE_DIALS, ...PRICE_DIALS, ...HOUSEHOLD_DIALS, ...ECONOMY_DIALS];

/**
 * Extra series carried in the readings table only, relabelled so they are not
 * mistaken for the Australian dials above. These are annual OECD-basis figures
 * used for cross-country comparison, on a different basis to the ABS prints.
 */
const TABLE_ONLY: Record<string, string> = {
  inflation_rate: 'CPI inflation · OECD annual basis',
  avg_wage_ppp: 'Average gross wage · OECD',
  real_wage_growth: 'Real wage growth 2010 to 2024 · OECD',
  household_savings_rate: 'Household net savings rate · OECD',
};

const TABLE_ONLY_IDS = Object.keys(TABLE_ONLY);

const DERIVED_IDS = ['gdp_nominal_usd', 'population'];

function ord(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function changeSuffix(unit: string) {
  if (unit === 'years') return ' yrs';
  if (unit === 'USD' || unit === 'USD PPP') return '';
  if (unit === '/100') return ' pts';
  return ' pp';
}

/** "+0.3 pp on 2026 Q1", or "unchanged since ..." when the level held. */
function formatChange(
  series: MetricObservation[] | undefined,
  unit: string,
  decimals: number,
): string | undefined {
  const change = seriesChange(series);
  if (!change) return undefined;
  const rounded = Number(change.delta.toFixed(decimals));
  const when = formatPeriodLabel(change.from);
  if (rounded === 0) return `unchanged since ${when}`;
  const sign = rounded > 0 ? '+' : '-';
  const magnitude = Math.abs(rounded);
  const shown = unit === 'USD' || unit === 'USD PPP'
    ? new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(magnitude)
    : magnitude.toFixed(decimals);
  return `${sign}${shown}${changeSuffix(unit)} on ${when}`;
}

/** Store units are spelled out, which wraps to two lines in a table cell. */
const SHORT_UNITS: Record<string, string> = {
  percent: '%',
  'percent per annum': '% pa',
  'percent per year': '% / yr',
  'percent of GDP': '% of GDP',
  'percent of labour force': '% of labour force',
  'percent probability': '% probability',
  'index (NYC=100)': 'index',
};

function shortUnit(unit: string): string {
  return SHORT_UNITS[unit] ?? unit;
}

function formatReading(value: number | null, unit: string, decimals: number): string {
  if (value == null) return '—';
  if (unit === 'persons' || Math.abs(value) >= 1000) {
    return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(value);
  }
  return value.toFixed(decimals);
}

function buildDial(
  spec: DialSpec,
  latest: MetricObservation | undefined,
  series: MetricObservation[] | undefined,
  footnote?: string,
): DashboardDial {
  const scale = DIAL_SCALES[spec.metricId];
  const decimals = scale?.decimals ?? 1;
  const notes = [footnote, spec.note].filter(Boolean).join(' · ');
  return {
    id: spec.metricId,
    href: `/metrics/${spec.metricId}`,
    label: spec.label,
    subtitle: latest ? formatPeriodLabel(latest.period) : 'No observation yet',
    kicker: spec.kicker,
    tier: spec.tier,
    value: latest?.value ?? null,
    unit: spec.unit,
    min: scale?.min,
    max: scale?.max,
    invertScale: scale?.invertScale,
    decimals: scale?.decimals,
    compact: scale?.compact,
    footnote: notes || undefined,
    spark: series && series.length > 1 ? series : undefined,
    step: spec.step,
    change: formatChange(series, spec.unit, decimals),
    age: latest ? readingAgeLabel(latest.period) : undefined,
  };
}

export async function loadDashboard(): Promise<{
  sections: DashboardSection[];
  readings: ReadingRow[];
  staleCount: number;
}> {
  const hsi = ALL_INDICES.find((p) => p.index.id === 'hsi');
  const aus = hsi?.results.find((r) => r.entity === 'AUS');
  const scored = hsi?.results.filter((r) => r.scored).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) ?? [];
  const rank = aus ? scored.findIndex((r) => r.entity === 'AUS') + 1 : null;

  const dialIds = ALL_DIAL_SPECS.map((s) => s.metricId);
  const allIds = [...dialIds, ...TABLE_ONLY_IDS, ...DERIVED_IDS];

  const [rba, series, meta] = await Promise.all([
    loadRbaRateIndicator().catch(() => null),
    loadRecentSeries(allIds, 16),
    loadMetricMetaBatch(allIds),
  ]);

  const latest = new Map(
    [...series].map(([metricId, rows]) => [metricId, rows[rows.length - 1]] as const),
  );

  const ranked = await Promise.all(ALL_DIAL_SPECS.map(async (spec) => {
    if (!spec.rank) return [spec.metricId, undefined] as const;
    const note = await oecdPercentileFootnote(
      spec.metricId,
      latest.get(spec.metricId)?.value ?? null,
      spec.rank,
    );
    return [spec.metricId, note] as const;
  }));
  const rankNotes = new Map(ranked);

  const debtPerPerson = formatDebtPerPerson(
    latest.get('government_debt_gdp')?.value ?? null,
    latest.get('gdp_nominal_usd')?.value ?? null,
    latest.get('population')?.value ?? null,
  );

  const dialFor = (spec: DialSpec) => {
    const extra = spec.metricId === 'government_debt_gdp'
      ? [rankNotes.get(spec.metricId), debtPerPerson].filter(Boolean).join(' · ')
      : rankNotes.get(spec.metricId);
    return buildDial(spec, latest.get(spec.metricId), series.get(spec.metricId), extra || undefined);
  };

  const indexSection: DashboardSection = {
    id: 'index',
    title: 'The index',
    description: 'A composite of tier 1 and 2 inputs, rebuilt each vintage rather than revised in place.',
    dials: [
      {
        id: 'hsi',
        href: '/indices/hsi',
        label: 'Household Squeeze Index',
        subtitle: 'Composite pressure on Australian households',
        kicker: 'Index · Australia',
        tier: `Vintage ${hsi?.index.vintage ?? '—'} · ${hsi?.methodology.components.length ?? 0} components`,
        value: aus?.score ?? null,
        unit: '/100',
        footnote: rank ? `${rank}${ord(rank)} highest of ${scored.length} OECD countries` : undefined,
      },
    ],
  };

  const rateSection: DashboardSection = {
    id: 'rates',
    title: 'Rates',
    description: 'Where the cash rate sits, what the market expects next, and what the long end is pricing.',
    dials: [
      dialFor(RATE_DIALS[0]),
      {
        id: 'rba-market',
        href: '/markets/rba-rate-rise',
        label: 'RBA hike · market-implied',
        subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
        kicker: 'Indicator · ASX futures',
        tier: 'Tier 2 · 25bp hike probability',
        value: rba?.market?.hike ?? null,
        unit: '%',
      },
      {
        id: 'rba-model',
        href: '/markets/rba-rate-rise',
        label: 'RBA hike · fundamentals',
        subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
        kicker: 'Indicator · derived model',
        tier: 'Tier 1/2 inputs · CPI, real rate, credit',
        value: rba?.fundamentals?.hike ?? null,
        unit: '%',
        footnote: 'Not an RBA forecast',
      },
      dialFor(RATE_DIALS[1]),
    ],
  };

  const priceSection: DashboardSection = {
    id: 'prices',
    title: 'Prices and wages',
    description: 'The two series that decide whether pay packets are gaining or losing ground.',
    dials: PRICE_DIALS.map(dialFor),
  };

  const householdSection: DashboardSection = {
    id: 'households',
    title: 'Households and housing',
    description: 'Leverage, the credit driving it, and what a home costs in years of income.',
    dials: HOUSEHOLD_DIALS.map(dialFor),
  };

  const economySection: DashboardSection = {
    id: 'economy',
    title: 'Economy and labour',
    description: 'Slower-moving fundamentals. These are annual series and several sit years behind.',
    dials: ECONOMY_DIALS.map(dialFor),
  };

  const sections = [indexSection, rateSection, priceSection, householdSection, economySection];

  const readings: ReadingRow[] = [];
  for (const metricId of [...dialIds, ...TABLE_ONLY_IDS]) {
    const obs = latest.get(metricId);
    const m = meta.get(metricId);
    const spec = ALL_DIAL_SPECS.find((s) => s.metricId === metricId);
    const unit = spec?.unit ?? m?.unit ?? '';
    const decimals = DIAL_SCALES[metricId]?.decimals ?? 1;
    readings.push({
      id: metricId,
      href: spec ? `/metrics/${metricId}` : undefined,
      label: spec?.label ?? TABLE_ONLY[metricId] ?? m?.name ?? metricId,
      value: formatReading(obs?.value ?? null, unit, decimals),
      unit: shortUnit(m?.unit ?? unit),
      period: obs ? formatPeriodLabel(obs.period) : '—',
      change: formatChange(series.get(metricId), unit, decimals) ?? '—',
      source: m?.source_org ?? '—',
      tier: m?.source_tier ?? null,
    });
  }

  const staleCount = sections
    .flatMap((s) => s.dials)
    .filter((d) => d.age).length;

  return { sections, readings, staleCount };
}