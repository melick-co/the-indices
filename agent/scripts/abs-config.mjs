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
    name: 'Australia WPI, annual change',
    dataflow: 'WPI',
    // The ABS headline measure (excl bonuses, seasonally adjusted), so stored figures match the release.
    dataKey: '3.THRPEB.7.TOT.20.AUS.Q', // YoY | total hourly excl bonuses | all sectors | all industries | SA
    lastN: 40,
    unit: 'percent',
    basis: 'Total hourly rates of pay excluding bonuses, seasonally adjusted, YoY, all industries (ABS headline)',
    direction: 'higher_is_more_pressure',
    category: 'labour',
    source_id: 'abs_awe',
    verified: true,
  },
  // Added Oct 2026: series pitches kept asking for. Keys verified with
  // `node scripts/watch-abs.mjs peek <dataflow> <key>`.
  {
    metric_id: 'trimmed_mean_cpi_au',
    name: 'Australia trimmed mean CPI, annual change',
    dataflow: 'CPI_Q',
    dataKey: '3.999902.20.50.Q',  // % change from previous year | Trimmed Mean | SA | Australia | Quarterly
    lastN: 40,
    unit: 'percent',
    basis: 'Trimmed mean, seasonally adjusted, change from same quarter previous year (quarterly CPI)',
    direction: 'higher_is_more_pressure',
    category: 'prices',
    source_id: 'abs_cpi',
    verified: true,
  },
  {
    metric_id: 'wpi_private_annual_au',
    name: 'Australia WPI, private sector, annual change',
    dataflow: 'WPI',
    dataKey: '3.THRPEB.1.TOT.20.AUS.Q', // YoY | total hourly excl bonuses | Private | all industries | SA
    lastN: 40,
    unit: 'percent',
    basis: 'Total hourly rates of pay excluding bonuses, seasonally adjusted, YoY, private sector (ABS headline)',
    direction: 'higher_is_more_pressure',
    category: 'labour',
    source_id: 'abs_awe',
    verified: true,
  },
  {
    metric_id: 'wpi_public_annual_au',
    name: 'Australia WPI, public sector, annual change',
    dataflow: 'WPI',
    dataKey: '3.THRPEB.2.TOT.20.AUS.Q', // YoY | total hourly excl bonuses | Public | all industries | SA
    lastN: 40,
    unit: 'percent',
    basis: 'Total hourly rates of pay excluding bonuses, seasonally adjusted, YoY, public sector (ABS headline)',
    direction: 'higher_is_more_pressure',
    category: 'labour',
    source_id: 'abs_awe',
    verified: true,
  },
  {
    metric_id: 'gdp_growth_qoq_au',
    name: 'Australia real GDP, quarterly growth',
    dataflow: 'ANA_AGG',
    dataKey: 'M2.GPM.20.AUS.Q',   // chain volume % change | GDP | SA | Australia | Quarterly
    lastN: 40,
    unit: 'percent',
    basis: 'GDP, chain volume measures, seasonally adjusted, change from previous quarter',
    direction: 'higher_is_less_pressure',
    category: 'output',
    source_id: 'abs_ana',
    verified: true,
  },
  {
    metric_id: 'gdp_per_hour_worked_index_au',
    name: 'Australia GDP per hour worked, index',
    dataflow: 'ANA_AGG',
    dataKey: 'M5.GPM_PHW.20.AUS.Q', // index | GDP per hour worked | SA | Australia | Quarterly
    lastN: 44,
    unit: 'index',
    basis: 'GDP per hour worked (whole economy), seasonally adjusted index',
    direction: 'higher_is_less_pressure',
    category: 'productivity',
    source_id: 'abs_ana',
    verified: true,
    derive: {
      metric_id: 'gdp_per_hour_worked_annual_au',
      name: 'Australia GDP per hour worked, annual change',
      unit: 'percent',
      basis: 'Derived: GDP per hour worked index (SA), change on same quarter previous year',
      direction: 'higher_is_less_pressure',
      category: 'productivity',
      lag: 4,
    },
  },
  {
    metric_id: 'market_gva_per_hour_index_au',
    name: 'Australia market sector GVA per hour worked, index',
    dataflow: 'ANA_AGG',
    dataKey: 'M5.GVA_MKT_PHW.20.AUS.Q', // index | market sector GVA per hour worked | SA | Australia
    lastN: 44,
    unit: 'index',
    basis: 'Gross value added per hour worked, market sector, seasonally adjusted index',
    direction: 'higher_is_less_pressure',
    category: 'productivity',
    source_id: 'abs_ana',
    verified: true,
    derive: {
      metric_id: 'market_gva_per_hour_annual_au',
      name: 'Australia market sector GVA per hour worked, annual change',
      unit: 'percent',
      basis: 'Derived: market sector GVA per hour worked index (SA), change on same quarter previous year',
      direction: 'higher_is_less_pressure',
      category: 'productivity',
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
