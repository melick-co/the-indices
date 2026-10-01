/**
 * OECD series (SDMX REST, https://sdmx.oecd.org/public/rest). Keys verified
 * Oct 2026 with `node scripts/watch-oecd.mjs peek <flow> <key>`.
 *
 * flow is "AGENCY,DSD@DATAFLOW,VERSION". Series sharing a flow and key are
 * fetched once and split by `measure` (the API rate-limits hard). All series
 * are general government (S13), percent of GDP, one row per country per year.
 *
 * Government at a Glance publishes only each country's latest year, so
 * expenditure and debt start as a snapshot and build history as the yearly
 * updates land. Revenue Statistics carries full history.
 */
export const OECD_SERIES = [
  {
    metric_id: 'gov_expenditure_gdp',
    name: 'General government expenditure',
    flow: 'OECD.GOV.GIP,DSD_GOV@DF_GOV_PF_YU,1.0',
    key: 'A..GE+GGD.PT_B1GQ.S13.YU.PF',
    measure: 'GE',
    startPeriod: '2010',
    unit: 'percent of GDP',
    basis: 'General government total expenditure, OECD Government at a Glance (yearly updates)',
    direction: 'neutral',
    category: 'fiscal',
    source_dataset: 'Government at a Glance: public finance, yearly updates',
  },
  {
    metric_id: 'gov_gross_debt_gdp',
    name: 'General government gross debt',
    flow: 'OECD.GOV.GIP,DSD_GOV@DF_GOV_PF_YU,1.0',
    key: 'A..GE+GGD.PT_B1GQ.S13.YU.PF',
    measure: 'GGD',
    startPeriod: '2010',
    unit: 'percent of GDP',
    basis: 'General government gross debt (SNA), OECD Government at a Glance (yearly updates); not the Maastricht definition',
    direction: 'higher_is_more_pressure',
    category: 'fiscal',
    source_dataset: 'Government at a Glance: public finance, yearly updates',
  },
  {
    metric_id: 'tax_revenue_gdp',
    name: 'Total tax revenue',
    flow: 'OECD.CTP.TPS,DSD_REV_COMP_OECD@DF_RSOECD,2.0',
    key: '.TAX_REV.S13._T._T.PT_B1GQ.A',
    measure: 'TAX_REV',
    startPeriod: '2000',
    unit: 'percent of GDP',
    basis: 'Total tax revenue incl. social security contributions, general government, OECD Revenue Statistics',
    direction: 'neutral',
    category: 'fiscal',
    source_dataset: 'Revenue Statistics: comparative tax revenues',
  },
];
