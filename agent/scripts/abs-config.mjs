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
];

/**
 * Not yet verified. Run the discovery commands, confirm the dataflow id and key,
 * then move each into ABS_SERIES above. Candidate dataflows to check:
 *   wages            -> node scripts/watch-abs.mjs discover wage
 *   labour force     -> node scripts/watch-abs.mjs discover labour
 *   property prices  -> node scripts/watch-abs.mjs discover propert
 */
export const ABS_CANDIDATES = ['WPI', 'LF', 'RPPI'];
