/**
 * ABS series configuration.
 *
 * IMPORTANT: dataKey values below are best-effort and MUST be verified on first
 * run. Use the discovery commands to check them:
 *
 *   node scripts/watch-abs.mjs discover cpi        # find dataflow ids
 *   node scripts/watch-abs.mjs structure CPI       # see dimensions + codes
 *   node scripts/watch-abs.mjs peek CPI <dataKey>  # preview values
 *
 * A wrong dataKey returns either 404 or the wrong series, not silent nonsense,
 * so verification is quick. Set `dataKey: 'all'` with `lastN` to fetch broadly
 * and inspect what comes back.
 */
export const ABS_SERIES = [
  {
    metric_id: 'cpi_annual_au',
    name: 'Australia CPI, annual change',
    dataflow: 'CPI',
    // All groups CPI, percentage change from corresponding quarter of previous year,
    // Australia, quarterly. VERIFY with `structure CPI`.
    dataKey: '3.10001.10.50.Q',
    lastN: 24,
    unit: 'percent',
    basis: 'Headline CPI, annual change, original series',
    direction: 'higher_is_more_pressure',
    category: 'prices',
    source_id: 'abs_cpi',
  },
  {
    metric_id: 'wpi_annual_au',
    name: 'Australia Wage Price Index, annual change',
    dataflow: 'WPI',
    dataKey: 'all',
    lastN: 24,
    unit: 'percent',
    basis: 'Total hourly rates of pay excluding bonuses, annual change',
    direction: 'higher_is_less_pressure',
    category: 'income',
    source_id: 'abs_wpi',
  },
  {
    metric_id: 'unemployment_rate_au',
    name: 'Australia unemployment rate',
    dataflow: 'LF',
    dataKey: 'all',
    lastN: 24,
    unit: 'percent',
    basis: 'Persons, seasonally adjusted',
    direction: 'higher_is_more_pressure',
    category: 'labour',
    source_id: 'abs_lf',
  },
  {
    metric_id: 'residential_property_price_au',
    name: 'Australia residential property price index',
    dataflow: 'RPPI',
    dataKey: 'all',
    lastN: 24,
    unit: 'index',
    basis: 'Weighted average of eight capital cities',
    direction: 'higher_is_more_pressure',
    category: 'housing',
    source_id: 'abs_rppi',
  },
];
