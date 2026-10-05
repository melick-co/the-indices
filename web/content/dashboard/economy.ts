/**
 * The economists' dashboard: seven sections, each led by the official indicator economists watch, with smaller
 * indicators alongside. Every number on the dashboard comes from stored official data; the words here say why an
 * indicator matters and what it should be.
 *
 * "What it should be": an official target where one exists (with its source); otherwise the series' own long-run
 * average, and for cross-country series the OECD median, both computed from the data.
 */

export type Benchmark =
  | { kind: 'target'; low: number; high: number; label: string; source: { text: string; url: string } }
  | { kind: 'floor'; value: number; label: string; source: { text: string; url: string }; /** Tile wording, e.g. "its long-run average" (default "benchmark"). */ short?: string }
  | { kind: 'average'; years: number }
  /** Judged against the OECD median (well-being measures with no target and sparse history). */
  | { kind: 'oecd' };

export type Indicator = {
  /** Stored series (or cpi: component id). */
  metric_id: string;
  /** A derived reading: metric_id minus `minus`, period by period (e.g. wages less prices). */
  minus?: string;
  label: string;
  /** Short plain name for tiles. */
  short?: string;
  /** Minimum decimal places for this reading ("0.0%" rather than "0%"). */
  decimals?: number;
  /** The subject for summary sentences when the label does not read as one ("The share of people in poverty"). */
  subject?: string;
  /** Why the number matters, in one or two sentences. */
  why: string;
  benchmark: Benchmark;
  /** Higher is better for the economy (true), worse (false), or neither (undefined). */
  higherIsBetter?: boolean;
  /** Policy rates and other series that hold between dated changes. */
  step?: boolean;
  /** How many recent readings the history chart shows. */
  history?: number;
  /** Cross-country series to compare against, when the Australian series has no peers of its own. */
  peers?: { metric_id: string; label: string; unit?: Indicator['unit'] | 'usd' };
  /** Display unit when the stored one is not reader-friendly. */
  unit?: 'percent' | 'pts' | 'aud' | 'aud_bn' | 'persons' | 'per_1000' | 'index' | 'percent_gdp' | 'usd'
    | 'years' | 'points' | 'score' | 'per_100k' | 'ratio';
};

export type Section = {
  id: string;
  title: string;
  /** What the section answers, in a line. */
  question: string;
  headline: Indicator;
  others: Indicator[];
  /** Caveat composite indices that belong to this section. */
  composites?: { id: string; label: string }[];
};

const RBA_TARGET = {
  text: 'Reserve Bank of Australia, Inflation target',
  url: 'https://www.rba.gov.au/inflation/inflation-target.html',
};

export const SECTIONS: Section[] = [
  {
    id: 'growth',
    title: 'Growth & living standards',
    question: 'Is the economy growing faster than the population it supports?',
    headline: {
      metric_id: 'gdp_per_capita_qoq_au', label: 'Real GDP per person, quarterly growth', short: 'GDP per person', decimals: 1,
      why: 'Output per resident is the closest single measure of living standards: headline GDP can grow while each person\'s share shrinks.',
      benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'percent',
      peers: { metric_id: 'gdp_per_capita', label: 'GDP per person (US dollars)', unit: 'usd' },
    },
    others: [
      { metric_id: 'gdp_growth_qoq_au', label: 'Real GDP, quarterly growth', short: 'GDP growth',
        why: 'The size of the whole economy; it rises with population as well as productivity.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'percent' },
      { metric_id: 'gdp_per_hour_worked_annual_au', label: 'Labour productivity (GDP per hour worked), annual growth', short: 'Productivity',
        why: 'Productivity growth is what lets wages rise without adding to inflation, and the main source of long-run income growth.',
        benchmark: { kind: 'floor', value: 1.2, label: 'Treasury\'s long-run productivity assumption (1.2% a year)',
          source: { text: 'Australian Treasury, 2026 Intergenerational Report', url: 'https://treasury.gov.au/publication/2026-intergenerational-report' } },
        higherIsBetter: true, history: 40, unit: 'percent' },
      { metric_id: 'market_gva_per_hour_annual_au', label: 'Market-sector productivity, annual growth', short: 'Market productivity',
        why: 'Strips out the non-market sector, where output is hard to measure, to show productivity in the businesses that sell goods and services.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'percent' },
      { metric_id: 'gdp_per_capita_au', label: 'Real GDP per person (2022-23 dollars, quarterly)', short: 'GDP per person (level)',
        why: 'The level behind the growth rate: whether Australians are better or worse off than a year or a decade ago.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'aud' },
    ],
  },
  {
    id: 'jobs',
    title: 'Jobs & wages',
    question: 'Is everyone who wants work finding it, and are wages keeping up with prices?',
    headline: {
      metric_id: 'unemployment_rate_au', label: 'Unemployment rate', short: 'Unemployment',
      why: 'The share of the labour force looking for work; the RBA\'s mandate includes full employment, and a rising rate is usually the first sign of a slowdown.',
      benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 60, unit: 'percent',
      peers: { metric_id: 'unemployment_rate', label: 'Unemployment rate', unit: 'percent' },
    },
    others: [
      { metric_id: 'wpi_annual_au', label: 'Wage Price Index, annual growth', short: 'Wages',
        why: 'The price of labour for a fixed set of jobs, so it is not distorted by changes in who is working.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'percent' },
      { metric_id: 'wpi_annual_au', minus: 'cpi_annual_au', label: 'Real wage growth (wages less headline CPI)', short: 'Real wages',
        why: 'Whether pay rises are buying more or less than a year ago. Below zero, workers are losing ground.',
        benchmark: { kind: 'floor', value: 0, label: 'zero, the point where wages keep pace with prices',
          source: { text: 'Derived from ABS Wage Price Index and Consumer Price Index', url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation' } },
        higherIsBetter: true, history: 40, unit: 'pts' },
      { metric_id: 'wpi_private_annual_au', label: 'Private-sector wages, annual growth', short: 'Private wages',
        why: 'Private pay is set by bargaining in the market; it moves first when the labour market tightens or loosens.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: true, history: 40, unit: 'percent' },
      { metric_id: 'wpi_public_annual_au', label: 'Public-sector wages, annual growth', short: 'Public wages',
        why: 'Set by government agreements, so it reflects policy as much as the market.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'percent' },
    ],
  },
  {
    id: 'prices',
    title: 'Prices & inflation',
    question: 'Is inflation back in the RBA\'s 2–3 per cent target band?',
    headline: {
      metric_id: 'trimmed_mean_cpi_monthly_au', label: 'Trimmed mean inflation (monthly CPI), annual', short: 'Underlying inflation',
      why: 'The RBA\'s preferred measure of underlying inflation: it drops the biggest price moves each period, so it shows the trend that rate decisions respond to.',
      benchmark: { kind: 'target', low: 2, high: 3, label: 'RBA target band, 2–3%', source: RBA_TARGET },
      higherIsBetter: undefined, history: 60, unit: 'percent',
    },
    others: [
      { metric_id: 'cpi_monthly_annual_au', label: 'Headline CPI (monthly), annual', short: 'Headline CPI',
        why: 'What households experience at the till, including volatile items such as fuel and electricity.',
        benchmark: { kind: 'target', low: 2, high: 3, label: 'RBA target band, 2–3%', source: RBA_TARGET }, history: 60, unit: 'percent' },
      { metric_id: 'trimmed_mean_cpi_au', label: 'Trimmed mean inflation (quarterly CPI), annual', short: 'Underlying (quarterly)',
        why: 'The quarterly measure with the longest history, used in the RBA\'s forecasts.',
        benchmark: { kind: 'target', low: 2, high: 3, label: 'RBA target band, 2–3%', source: RBA_TARGET }, history: 40, unit: 'percent',
        peers: { metric_id: 'inflation_wb', label: 'Consumer price inflation', unit: 'percent' } },
      { metric_id: 'rent_cpi_annual_au', label: 'Rents, annual change (CPI)', short: 'Rents',
        why: 'Rents are the largest service in the CPI basket and track how tight the housing market is for tenants.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 40, unit: 'percent' },
      { metric_id: 'cpi:40055:annual', label: 'Electricity prices, annual change (CPI)', short: 'Electricity',
        why: 'Electricity swings with wholesale prices and government rebates, and often explains gaps between headline and underlying inflation.',
        benchmark: { kind: 'average', years: 2 }, higherIsBetter: false, history: 36, unit: 'percent' },
    ],
  },
  {
    id: 'rates',
    title: 'Interest rates & credit',
    question: 'How tight is monetary policy, and how fast is borrowing growing?',
    headline: {
      metric_id: 'cash_rate_au', label: 'RBA cash rate target', short: 'Cash rate',
      why: 'The RBA\'s policy rate sets the floor for borrowing costs across the economy; it rises to cool inflation and falls to support growth.',
      benchmark: { kind: 'average', years: 10 }, step: true, history: 200, unit: 'percent',
    },
    others: [
      { metric_id: 'rba_hike_prob_market_au', label: 'Market-implied chance of a hike at the next RBA meeting', short: 'Hike odds',
        why: 'What traders in ASX cash rate futures expect the RBA to do next.',
        benchmark: { kind: 'average', years: 1 }, history: 12, unit: 'percent' },
      { metric_id: 'bond_yield_10y_au', label: '10-year government bond yield', short: '10-year yield',
        why: 'Long-term borrowing costs, set by markets; they carry expectations for growth, inflation and global rates.',
        benchmark: { kind: 'average', years: 10 }, history: 60, unit: 'percent' },
      { metric_id: 'credit_housing_12m_au', label: 'Housing credit, annual growth', short: 'Housing credit',
        why: 'How fast mortgage debt is growing; credit outrunning incomes raises household risk.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 60, unit: 'percent' },
    ],
  },
  {
    id: 'housing',
    title: 'Housing & household finances',
    question: 'How stretched are households by their mortgages and debts?',
    headline: {
      metric_id: 'housing_repayments_income_au', label: 'Scheduled mortgage repayments, share of disposable income', short: 'Repayment burden',
      why: 'The share of household income committed to scheduled mortgage repayments: the clearest gauge of mortgage stress across the economy.',
      benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 40, unit: 'percent',
    },
    others: [
      { metric_id: 'household_debt_income_au', label: 'Household debt to income', short: 'Debt to income',
        why: 'Total household debt relative to a year\'s disposable income; high leverage makes households sensitive to rate rises.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 40, unit: 'percent' },
      { metric_id: 'dwelling_stock_value_bn', label: 'Total value of residential dwellings', short: 'Dwelling values',
        why: 'The value of the housing stock that backs most household debt and wealth.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'aud_bn' },
      { metric_id: 'mean_dwelling_price', label: 'Mean dwelling price', short: 'Mean price',
        why: 'The average value of a home across Australia, from the ABS stock estimates.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'aud' },
    ],
    composites: [{ id: 'hsi', label: 'Household Squeeze Index' }],
  },
  {
    id: 'people',
    title: 'Population',
    question: 'How fast is the population growing, and why?',
    headline: {
      metric_id: 'pop_growth_rate_12m', label: 'Population growth, twelve months', short: 'Population growth',
      subject: 'Population growth over twelve months',
      why: 'Population growth adds to demand for housing and services and to the size of the economy, but not to income per person.',
      benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'percent',
    },
    others: [
      { metric_id: 'pop_change_12m', label: 'Population increase, twelve months', short: 'Population increase',
        subject: 'The population increase over twelve months',
        why: 'The number of extra residents in a year: what housing and services have to absorb.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'persons' },
      { metric_id: 'pop_nom_12m', label: 'Net overseas migration, twelve months', short: 'Net migration',
        subject: 'Net overseas migration over twelve months',
        why: 'Migrant arrivals minus departures: the main driver of population growth since the pandemic.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'persons' },
      { metric_id: 'pop_natural_increase_12m', label: 'Natural increase (births less deaths), twelve months', short: 'Natural increase',
        subject: 'Natural increase over twelve months',
        why: 'Births minus deaths: shrinking as the population ages and fertility falls.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'persons' },
      { metric_id: 'pop_erp_q', label: 'Estimated resident population', short: 'Population',
        why: 'The official population count, the denominator for every per-person measure.',
        benchmark: { kind: 'average', years: 10 }, history: 40, unit: 'persons' },
      { metric_id: 'perm_migration_inflow_per_1000', label: 'Permanent migration per 1,000 residents', short: 'Migration per person',
        why: 'Puts Australia\'s permanent intake on the same footing as other countries\'.',
        benchmark: { kind: 'average', years: 10 }, history: 15, unit: 'per_1000' },
    ],
  },
  {
    id: 'public',
    title: 'Public finances',
    question: 'How much does government borrow, tax and spend, compared with other rich countries?',
    headline: {
      metric_id: 'gov_gross_debt_gdp', label: 'General government gross debt, share of GDP', short: 'Government debt',
      why: 'Debt relative to the economy\'s size shows how much room government has to respond to the next downturn.',
      benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 15, unit: 'percent_gdp',
    },
    others: [
      { metric_id: 'tax_revenue_gdp', label: 'Total tax revenue, share of GDP', short: 'Tax revenue',
        why: 'How much of the economy government collects in tax, including social security contributions.',
        benchmark: { kind: 'average', years: 10 }, history: 20, unit: 'percent_gdp' },
      { metric_id: 'gov_expenditure_gdp', label: 'General government expenditure, share of GDP', short: 'Spending',
        why: 'The size of government relative to the economy.',
        benchmark: { kind: 'average', years: 10 }, history: 15, unit: 'percent_gdp' },
    ],
  },
];

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);

/** Every indicator in a section, headline first, with a stable id for its page. */
export function indicatorsOf(section: Section): Array<Indicator & { key: string }> {
  return [section.headline, ...section.others].map((i) => ({ ...i, key: i.minus ? `${i.metric_id}-less-${i.minus}` : i.metric_id.replace(/:/g, '-') }));
}
