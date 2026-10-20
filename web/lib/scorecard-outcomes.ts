import type { ChangeKind } from '@/lib/scorecard';

/**
 * The scorecard's Outcomes: headline official series, each from the term's baseline to the latest reading.
 *
 * The "how much the government controls this" notes are fixed text, written and reviewed here, never generated. They
 * describe who sets or drives each measure; they make no judgement about the result.
 */

export type SeriesRef = {
  /** A stored metric id (observations), or a CPI component id (cpi:<code>:<measure>[:q]). */
  metric_id: string;
  label: string;
  unit: string;
  /** How the stored readings are turned into the figure shown. */
  transform?: 'sum4' | 'bn' | 'sum4_bn';
  /** Real wages: this series less another, period by period. */
  minus?: string;
};

export type OutcomeDef = {
  key: string;
  title: string;
  primary: SeriesRef;
  /** Shown beside the primary, never alone (headline CPI with the trimmed mean). */
  secondary?: SeriesRef;
  change: ChangeKind;
  decimals: number;
  /** Where Caveat charts it, or the official release. */
  link: { href: string; label: string };
  /** A cross-country series holding an OECD aggregate (entity OECD), when the store has one. */
  oecd?: { metric_id: string; entities: string[] };
  control: string;
  /** Extra fixed note (the CPI rule). */
  note?: string;
};

export const OECD_ENTITIES = ['OECD', 'OECD_AVG', 'OED', 'OECDE'];

export const CPI_NOTE = 'Headline CPI and the trimmed mean are shown together. The trimmed mean is the RBA\'s preferred measure of underlying inflation.';

export const OUTCOMES: OutcomeDef[] = [
  {
    key: 'inflation', title: 'Inflation',
    primary: { metric_id: 'cpi_annual_au', label: 'Headline CPI, annual change', unit: '%' },
    secondary: { metric_id: 'trimmed_mean_cpi_au', label: 'Trimmed mean, annual change', unit: '%' },
    change: 'pp', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release', label: 'ABS Consumer Price Index' },
    oecd: { metric_id: 'inflation_rate', entities: OECD_ENTITIES },
    control: 'Mostly outside the government\'s direct control. Interest rates, the main lever on inflation, are set by the independent Reserve Bank. Government spending, energy rebates and administered prices also move the figures.',
    note: CPI_NOTE,
  },
  {
    key: 'unemployment', title: 'Unemployment rate',
    primary: { metric_id: 'unemployment_rate_au', label: 'Unemployment rate, seasonally adjusted', unit: '%' },
    change: 'pp', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia/latest-release', label: 'ABS Labour Force' },
    oecd: { metric_id: 'unemployment_rate_monthly_au', entities: OECD_ENTITIES },
    control: 'Partly. It follows the business cycle, the world economy and the Reserve Bank\'s interest rate settings; government spending, migration settings and employment programs have some effect.',
  },
  {
    key: 'real-wages', title: 'Real wages',
    primary: { metric_id: 'wpi_annual_au', minus: 'cpi_annual_au', label: 'Wage Price Index growth less headline CPI inflation', unit: 'pp' },
    secondary: { metric_id: 'wpi_annual_au', label: 'Wage Price Index, annual change', unit: '%' },
    change: 'pp', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/latest-release', label: 'ABS Wage Price Index' },
    control: 'Partly. Most wages are set by employers, enterprise bargaining and the independent Fair Work Commission. The government makes submissions to the annual wage review and sets its own employees\' pay; prices depend largely on the Reserve Bank and world conditions.',
    note: 'Real wage growth here is the Wage Price Index annual change less headline CPI inflation for the same quarter. For the trimmed mean, the RBA\'s preferred measure of underlying inflation, see the inflation row.',
  },
  {
    key: 'gdp-per-capita', title: 'Real GDP per person',
    primary: { metric_id: 'gdp_per_capita_au', label: 'Real GDP per person, per quarter (chain volume, seasonally adjusted)', unit: '$' },
    change: 'pct', decimals: 0,
    link: { href: 'https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product/latest-release', label: 'ABS National Accounts' },
    control: 'Mostly outside direct control. It reflects productivity, commodity prices, the world economy and population growth; tax, spending and migration settings have some effect over time.',
  },
  {
    key: 'productivity', title: 'Productivity',
    primary: { metric_id: 'gdp_per_hour_worked_index_au', label: 'GDP per hour worked, index', unit: 'index' },
    change: 'pct', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product/latest-release', label: 'ABS National Accounts' },
    control: 'Limited in the short run. Productivity depends on business investment, technology, skills and the mix of industries; government policy on competition, regulation, education and infrastructure works over years.',
  },
  {
    key: 'rents', title: 'Rents',
    primary: { metric_id: 'rent_cpi_annual_au', label: 'CPI rents, annual change', unit: '%' },
    change: 'pp', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release', label: 'ABS Consumer Price Index' },
    control: 'Partly. Rents follow housing supply, population growth and interest rates. Rental law is mostly set by the states; the Commonwealth sets Commonwealth Rent Assistance, which lowers rents as measured in the CPI, and migration settings.',
  },
  {
    key: 'migration', title: 'Net overseas migration',
    primary: { metric_id: 'pop_nom_q', label: 'Net overseas migration, four quarters to date', unit: 'persons', transform: 'sum4' },
    change: 'pct', decimals: 0,
    link: { href: 'https://www.abs.gov.au/statistics/people/population/national-state-and-territory-population/latest-release', label: 'ABS National, state and territory population' },
    control: 'Partly. The government sets visa settings and the permanent migration program; departures, Australians returning, students and visitors\' decisions also move the figure.',
  },
  {
    key: 'budget', title: 'Commonwealth budget balance (GFS)',
    primary: { metric_id: 'gfs_cwth_nob', label: 'Net operating balance, four quarters to date', unit: '$bn', transform: 'sum4_bn' },
    secondary: { metric_id: 'gfs_cwth_nlb', label: 'Net lending (+) or borrowing (−), four quarters to date', unit: '$bn', transform: 'sum4_bn' },
    change: 'abs', decimals: 1,
    link: { href: '/australia-inc', label: 'The government\'s books' },
    control: 'Largely. Spending and tax decisions are the government\'s own, though revenue also rises and falls with commodity prices, wages and employment.',
    note: 'Government finance statistics (accrual) for the Commonwealth general government sector, as reported by the Australian authorities to the IMF. This differs from the underlying cash balance quoted in the budget papers.',
  },
  {
    key: 'debt', title: 'Government debt',
    primary: { metric_id: 'gov_gross_debt_gdp', label: 'General government gross debt, per cent of GDP', unit: '%' },
    change: 'pp', decimals: 1,
    link: { href: 'https://data-explorer.oecd.org/', label: 'OECD' },
    oecd: { metric_id: 'gov_gross_debt_gdp', entities: OECD_ENTITIES },
    control: 'Largely, over time. Debt builds up from the government\'s own deficits, though interest rates and economic growth change the ratio to GDP. This measure covers all levels of government.',
  },
  {
    key: 'electricity', title: 'Electricity prices',
    primary: { metric_id: 'cpi:40055:index:q', label: 'CPI electricity, index', unit: 'index' },
    change: 'pct', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release', label: 'ABS Consumer Price Index' },
    control: 'Partly. Wholesale prices, network costs and state regulation set most of the bill. Commonwealth energy bill rebates lower prices as measured in the CPI while they are paid, and raise the measured change when they end.',
  },
  {
    key: 'childcare', title: 'Child care prices',
    primary: { metric_id: 'cpi:115498:index:q', label: 'CPI child care, index', unit: 'index' },
    change: 'pct', decimals: 1,
    link: { href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release', label: 'ABS Consumer Price Index' },
    control: 'Largely. The Commonwealth sets the Child Care Subsidy, which the CPI nets off what families pay; providers set their own fees.',
  },
  {
    key: 'completions', title: 'Homes completed',
    primary: { metric_id: 'dwelling_completions_au', label: 'Dwelling units completed, four quarters to date (original)', unit: 'dwellings', transform: 'sum4' },
    change: 'pct', decimals: 0,
    link: { href: 'https://www.abs.gov.au/statistics/industry/building-and-construction/building-activity-australia/latest-release', label: 'ABS Building Activity' },
    control: 'Partly. Builders, lenders and buyers decide what gets built; states and councils control planning and zoning. The Commonwealth funds incentives and social housing and sets migration and tax settings.',
  },
  {
    key: 'cash-rate', title: 'Cash rate',
    primary: { metric_id: 'cash_rate_au', label: 'RBA cash rate target', unit: '%' },
    change: 'pp', decimals: 2,
    link: { href: 'https://www.rba.gov.au/statistics/cash-rate/', label: 'RBA cash rate' },
    control: 'Not controlled by the government. The cash rate is set by the Reserve Bank\'s independent Monetary Policy Board; the Treasurer agrees the inflation target with the Bank.',
  },
];
