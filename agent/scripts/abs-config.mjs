/**
 * ABS series configuration. Keys below are VERIFIED against the live API
 * (Aug 2026) unless marked otherwise.
 *
 * Discovery commands if a key ever breaks:
 *   node scripts/watch-abs.mjs discover cpi
 *   node scripts/watch-abs.mjs structure CPI
 *   node scripts/watch-abs.mjs keys CPI "All groups CPI" Australia Quarterly
 *   node scripts/watch-abs.mjs peek CPI 1.10001.10.50.Q
 *
 * Note: ABS does not publish "percentage change from previous year" for
 * All groups CPI. We pull the index (MEASURE 1) and derive annual change
 * ourselves as index[t] / index[t-4] - 1, which is how the headline rate is
 * defined. Derived series are stored with status 'derived'.
 */
export const ABS_SERIES = [
  {
    metric_id: 'cpi_index_au',
    name: 'Australia CPI, index',
    dataflow: 'CPI',
    dataKey: '1.10001.10.50.Q',   // index numbers | All groups | Original | Australia | Quarterly
    lastN: 40,
    unit: 'index',
    basis: 'All groups CPI, original series, index numbers',
    direction: 'higher_is_more_pressure',
    category: 'prices',
    source_id: 'abs_cpi',
    verified: true,
    // derive annual change from this index and store as a second metric
    derive: {
      metric_id: 'cpi_annual_au',
      name: 'Australia CPI, annual change',
      unit: 'percent',
      basis: 'Derived: All groups CPI index, change on same quarter previous year',
      direction: 'higher_is_more_pressure',
      category: 'prices',
      lag: 4,
    },
  },
  {
    metric_id: 'wpi_annual_au',
    name: 'Australia Wage Price Index, annual change',
    dataflow: 'WPI',
    // MEASURE.INDEX.SECTOR.INDUSTRY.TSEST.REGION.FREQ
    // 3 = % change on same quarter previous year | THRPEB = excluding bonuses
    // 7 = private and public | TOT = all industries | 10 = original | AUS | Q
    // This is the headline WPI figure, and the measure the FWC quotes.
    dataKey: '3.THRPEB.7.TOT.10.AUS.Q',
    lastN: 40,
    unit: 'percent',
    basis: 'Total hourly rates of pay excluding bonuses, all sectors, all industries, original',
    direction: 'higher_is_less_pressure',
    category: 'income',
    source_id: 'abs_wpi',
    verified: true,
  },
  {
    metric_id: 'wpi_index_au',
    name: 'Australia Wage Price Index',
    dataflow: 'WPI',
    dataKey: '1.THRPEB.7.TOT.10.AUS.Q',
    lastN: 40,
    unit: 'index',
    basis: 'Total hourly rates of pay excluding bonuses, all sectors, all industries, original',
    direction: 'higher_is_less_pressure',
    category: 'income',
    source_id: 'abs_wpi',
    verified: true,
  },
  {
    metric_id: 'house_price_index_au',
    name: 'Australia residential property price index',
    dataflow: 'RPPI',
    // MEASURE.PROPERTY_TYPE.REGION.FREQ
    // 1 = index numbers | 3 = residential property | 100 = weighted average of
    // eight capital cities | quarterly. NOTE: capitals only, not national.
    dataKey: '1.3.100.Q',
    lastN: 40,
    unit: 'index',
    basis: 'Residential property price index, weighted average of eight capital cities',
    direction: 'higher_is_more_pressure',
    category: 'housing',
    source_id: 'abs_rppi',
    verified: true,
  },
  {
    metric_id: 'house_price_annual_au',
    name: 'Australia residential property prices, annual change',
    dataflow: 'RPPI',
    dataKey: '3.3.100.Q',
    lastN: 40,
    unit: 'percent',
    basis: 'Residential property prices, change on same quarter previous year, eight capital cities',
    direction: 'higher_is_more_pressure',
    category: 'housing',
    source_id: 'abs_rppi',
    verified: true,
  },
];

/**
 * Capital-city property price indices. Same dataflow, region code varies.
 * Loaded by `node scripts/watch-abs.mjs cities` — kept separate from the
 * headline series so the daily detectors are not swamped by nine near-identical
 * housing rows. Divergence between capitals is its own story.
 */
export const RPPI_CITIES = [
  { code: '1GSYD', city: 'Sydney' },
  { code: '2GMEL', city: 'Melbourne' },
  { code: '3GBRI', city: 'Brisbane' },
  { code: '4GADE', city: 'Adelaide' },
  { code: '5GPER', city: 'Perth' },
  { code: '6GHOB', city: 'Hobart' },
  { code: '7GDAR', city: 'Darwin' },
  { code: '8ACTE', city: 'Canberra' },
];

/**
 * Not yet verified. Run the discovery commands, confirm the dataflow id and key,
 * then move each into ABS_SERIES above. Candidate dataflows to check:
 *   wages            -> node scripts/watch-abs.mjs discover wage
 *   labour force     -> node scripts/watch-abs.mjs discover labour
 *   property prices  -> node scripts/watch-abs.mjs discover propert
 */
/**
 * Labour Force dataflow is `LF`. Find the unemployment-rate key with:
 *   node scripts/watch-abs.mjs keys LF "Unemployment rate" Australia
 * then add it above following the pattern.
 */
export const ABS_CANDIDATES = ['LF'];
