import { ALL_INDICES } from '@/content/indices/registry';
import { loadRbaRateIndicator } from '@/lib/rba-rate-indicator';
import {
  DIAL_SCALES,
  formatDebtPerPerson,
  formatPeriodLabel,
  loadLatestBatch,
  oecdPercentileFootnote,
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
};

export type DashboardSection = {
  id: string;
  title: string;
  description?: string;
  dials: DashboardDial[];
};

function ord(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function metricDial(
  id: string,
  label: string,
  obs: { period: string; value: number } | undefined,
  meta: {
    kicker: string;
    tier: string;
    unit: string;
    direction?: string | null;
    footnote?: string;
  },
): DashboardDial {
  const scale = DIAL_SCALES[id];
  return {
    id,
    href: `/metrics/${id}`,
    label,
    subtitle: obs ? formatPeriodLabel(obs.period) : 'No observation yet',
    kicker: meta.kicker,
    tier: meta.tier,
    value: obs?.value ?? null,
    unit: meta.unit,
    min: scale?.min,
    max: scale?.max,
    invertScale: scale?.invertScale,
    decimals: scale?.decimals,
    compact: scale?.compact,
    footnote: meta.footnote,
  };
}

export async function loadDashboardSections(): Promise<DashboardSection[]> {
  const hsi = ALL_INDICES.find((p) => p.index.id === 'hsi');
  const aus = hsi?.results.find((r) => r.entity === 'AUS');
  const scored = hsi?.results.filter((r) => r.scored).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) ?? [];
  const rank = aus ? scored.findIndex((r) => r.entity === 'AUS') + 1 : null;

  let rba;
  try {
    rba = await loadRbaRateIndicator();
  } catch {
    rba = null;
  }

  const metricIds = [
    'gdp_per_capita',
    'productivity_level',
    'productivity_growth_10y',
    'government_debt_gdp',
    'household_debt_income_au',
    'gdp_nominal_usd',
    'population',
    'years_to_buy_home',
    'unemployment_rate',
    'inflation_rate',
  ];
  const latest = await loadLatestBatch(metricIds);

  const [
    gdpFoot, prodFoot, prodGrowthFoot, debtFoot, hhDebtFoot, homeFoot, unempFoot, inflFoot,
  ] = await Promise.all([
    oecdPercentileFootnote('gdp_per_capita', latest.get('gdp_per_capita')?.value ?? null, 'higher_is_less_pressure'),
    oecdPercentileFootnote('productivity_level', latest.get('productivity_level')?.value ?? null, 'higher_is_less_pressure'),
    oecdPercentileFootnote('productivity_growth_10y', latest.get('productivity_growth_10y')?.value ?? null, 'higher_is_less_pressure'),
    oecdPercentileFootnote('government_debt_gdp', latest.get('government_debt_gdp')?.value ?? null, 'higher_is_more_pressure'),
    oecdPercentileFootnote('household_debt_income_au', latest.get('household_debt_income_au')?.value ?? null, 'higher_is_more_pressure'),
    oecdPercentileFootnote('years_to_buy_home', latest.get('years_to_buy_home')?.value ?? null, 'higher_is_more_pressure'),
    oecdPercentileFootnote('unemployment_rate', latest.get('unemployment_rate')?.value ?? null, 'higher_is_more_pressure'),
    oecdPercentileFootnote('inflation_rate', latest.get('inflation_rate')?.value ?? null, 'higher_is_more_pressure'),
  ]);

  const debtPerPerson = formatDebtPerPerson(
    latest.get('government_debt_gdp')?.value ?? null,
    latest.get('gdp_nominal_usd')?.value ?? null,
    latest.get('population')?.value ?? null,
  );

  const monetary: DashboardSection = {
    id: 'monetary',
    title: 'Indices & monetary',
    description: 'Composite squeeze index and next-meeting RBA hike odds.',
    dials: [
      {
        id: 'hsi',
        href: '/indices/hsi',
        label: 'Household Squeeze Index',
        subtitle: 'Composite pressure on Australian households',
        kicker: 'Index · Australia',
        tier: `Vintage ${hsi?.index.vintage ?? '—'} · tier 1/2 inputs`,
        value: aus?.score ?? null,
        unit: '/100',
        footnote: rank ? `${rank}${ord(rank)} of ${scored.length} OECD countries` : undefined,
      },
      {
        id: 'rba-market',
        href: '/indicators/rba-rate-rise',
        label: 'RBA hike · market-implied',
        subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
        kicker: 'Indicator · ASX futures',
        tier: 'Tier 2 · 25bp hike probability',
        value: rba?.market?.hike ?? null,
        unit: '%',
      },
      {
        id: 'rba-model',
        href: '/indicators/rba-rate-rise',
        label: 'RBA hike · fundamentals',
        subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
        kicker: 'Indicator · derived model',
        tier: 'Tier 1/2 inputs · CPI, real rate, credit',
        value: rba?.fundamentals?.hike ?? null,
        unit: '%',
      },
    ],
  };

  const macro: DashboardSection = {
    id: 'macro',
    title: 'Macro fundamentals',
    description: 'Income, productivity, fiscal position, and household leverage.',
    dials: [
      metricDial('gdp_per_capita', 'GDP per capita', latest.get('gdp_per_capita'), {
        kicker: 'Economy · Australia',
        tier: 'Tier 1 · IMF WEO nominal USD',
        unit: 'USD',
        footnote: gdpFoot,
      }),
      metricDial('productivity_level', 'Productivity level', latest.get('productivity_level'), {
        kicker: 'Productivity · Australia',
        tier: 'Tier 1 · GDP per hour worked (PPP)',
        unit: 'USD PPP',
        footnote: prodFoot,
      }),
      metricDial('productivity_growth_10y', 'Productivity growth (10y)', latest.get('productivity_growth_10y'), {
        kicker: 'Productivity · Australia',
        tier: 'Tier 1 · 10-year CAGR (2010–2020 vintage)',
        unit: 'percent per year',
        footnote: prodGrowthFoot,
      }),
      metricDial('government_debt_gdp', 'Government debt', latest.get('government_debt_gdp'), {
        kicker: 'Fiscal · Australia',
        tier: 'Tier 1 · World Bank central govt debt % GDP',
        unit: 'percent',
        footnote: [debtFoot, debtPerPerson].filter(Boolean).join(' · ') || undefined,
      }),
      metricDial('household_debt_income_au', 'Household debt to income', latest.get('household_debt_income_au'), {
        kicker: 'Household · Australia',
        tier: 'Tier 1 · RBA quarterly E2',
        unit: 'percent',
        footnote: hhDebtFoot,
      }),
    ],
  };

  const housingLabour: DashboardSection = {
    id: 'housing-labour',
    title: 'Housing & labour',
    description: 'Affordability, jobs market, and price pressure.',
    dials: [
      metricDial('years_to_buy_home', 'Years to buy a home', latest.get('years_to_buy_home'), {
        kicker: 'Housing · Australia',
        tier: 'Tier 3 · 90m² city-centre, net income',
        unit: 'years',
        footnote: homeFoot,
      }),
      metricDial('unemployment_rate', 'Unemployment', latest.get('unemployment_rate'), {
        kicker: 'Labour · Australia',
        tier: 'Tier 1 · ILO estimate, World Bank WDI',
        unit: 'percent',
        footnote: unempFoot,
      }),
      metricDial('inflation_rate', 'Inflation', latest.get('inflation_rate'), {
        kicker: 'Prices · Australia',
        tier: 'Tier 1 · Headline CPI, annual',
        unit: 'percent',
        footnote: inflFoot,
      }),
    ],
  };

  return [monetary, macro, housingLabour];
}

/** @deprecated use loadDashboardSections */
export async function loadDashboardDials(): Promise<DashboardDial[]> {
  const sections = await loadDashboardSections();
  return sections.flatMap((s) => s.dials);
}
