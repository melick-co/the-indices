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
  // Founding story "migration-denominator" (Oct 2026). The OECD publishes standardised permanent inflows by entry
  // category only (work, family, humanitarian, free movement, accompanying family, other); the total is their sum,
  // which matches the OECD's published totals (USA 2024: 1,425.1 thousand). Per 1,000 residents uses the World
  // Bank mid-year population stored as `population`.
  {
    metric_id: 'perm_migration_inflow',
    name: 'Permanent migration inflow (standardised)',
    flow: 'OECD.ELS.IMD,DSD_MIG_INT@DF_MIG_INT_PER,1.0',
    key: 'all',
    measure: 'MIG_FLW',
    sumOver: 'MIGRATION_TYPE',
    csv: true,  // its SDMX-JSON response drops about a quarter of the observations
    scale: 1 / 1000,
    decimals: 1,
    startPeriod: '2010',
    unit: 'thousand persons',
    basis: 'Standardised inflows of permanent-type migrants, all entry categories summed, OECD International Migration Database',
    direction: 'neutral',
    category: 'demography',
    source_dataset: 'International Migration Outlook: standardised inflows of permanent-type migrants',
    perCapita: {
      metric_id: 'perm_migration_inflow_per_1000',
      name: 'Permanent migration inflow per 1,000 residents',
      unit: 'per 1,000 residents',
      basis: 'Standardised permanent-type inflows (OECD) per 1,000 mid-year population (World Bank)',
      population: 'population',
      per: 1000,
    },
  },
];

/**
 * OECD How's Life? current well-being indicators (OECD WISE centre), for the quality-of-life dashboard (Oct 2026).
 * All share one request (the cache key is the flow, key and start period); each series is split out by MEASURE.
 * Totals only: all ages, both sexes, all education levels.
 */
const HSL_FLOW = 'OECD.WISE.WDP,DSD_HSL@DF_HSL_CWB,1.1';
const HSL = [
  ['1_1', 'Household net adjusted disposable income per person', 'US dollars per person, PPP', 'higher_is_less_pressure'],
  ['1_2', 'Income inequality: top to bottom income quintile', 'ratio (S80/S20)', 'higher_is_more_pressure'],
  ['1_3', 'Median household net wealth', 'US dollars per household, PPP', 'higher_is_less_pressure'],
  ['1_4', 'Relative income poverty', 'percent of population', 'higher_is_more_pressure'],
  ['1_6', 'Financial insecurity: liquid assets below three months of poverty-line income', 'percent of population', 'higher_is_more_pressure'],
  ['2_1', 'Employment rate, ages 25-64', 'percent of population aged 25-64', 'higher_is_less_pressure'],
  ['2_2', 'Gender wage gap', 'percent of median male wage', 'higher_is_more_pressure'],
  ['2_3', 'Long-term unemployment rate', 'percent of labour force', 'higher_is_more_pressure'],
  ['2_4', 'Young people not in employment, education or training', 'percent of population aged 15-24', 'higher_is_more_pressure'],
  ['2_7', 'Long hours in paid work (50+ a week)', 'percent of employees', 'higher_is_more_pressure'],
  ['2_8', 'Average annual gross earnings', 'US dollars, PPP', 'higher_is_less_pressure'],
  ['3_2', 'Housing affordability: income left after housing costs', 'percent of household disposable income', 'higher_is_less_pressure'],
  ['3_3', 'Housing cost overburden', 'percent of population', 'higher_is_more_pressure'],
  ['5_1', 'Life expectancy at birth', 'years', 'higher_is_less_pressure'],
  ['5_2', 'Perceived health as positive', 'percent of population aged 16+', 'higher_is_less_pressure'],
  ['5_3', 'Deaths from suicide, alcohol and drugs', 'deaths per 100,000 people', 'higher_is_more_pressure'],
  ['6_1', 'Student reading skills (PISA)', 'PISA points', 'higher_is_less_pressure'],
  ['6_2', 'Student mathematics skills (PISA)', 'PISA points', 'higher_is_less_pressure'],
  ['6_3', 'Student science skills (PISA)', 'PISA points', 'higher_is_less_pressure'],
  ['7_1', 'Social support: someone to count on', 'percent of population aged 15+', 'higher_is_less_pressure'],
  ['8_1', 'Having a say in government', 'percent of population aged 16-65', 'higher_is_less_pressure'],
  ['8_2', 'Voter turnout', 'percent of registered voters', 'higher_is_less_pressure'],
  ['9_2', 'Exposure to air pollution above WHO guidelines', 'percent of population', 'higher_is_more_pressure'],
  ['9_3', 'Exposure to extreme temperature', 'percent of population', 'higher_is_more_pressure'],
  ['10_1', 'Homicides', 'deaths per 100,000 people', 'higher_is_more_pressure'],
  ['10_2', 'Feeling safe walking alone at night', 'percent of population aged 15+', 'higher_is_less_pressure'],
  ['10_3', 'Road deaths', 'deaths per 100,000 people', 'higher_is_more_pressure'],
  ['11_1', 'Life satisfaction', '0-10 scale', 'higher_is_less_pressure'],
  ['11_2', 'Negative affect balance: more negative than positive feelings', 'percent of population aged 15+', 'higher_is_more_pressure'],
];
const HSL_KEY = `.${HSL.map(([m]) => m).join('+')}.._T._T._T.`;
for (const [measure, name, unit, direction] of HSL) {
  OECD_SERIES.push({
    metric_id: `hsl_${measure}`,
    name,
    flow: HSL_FLOW,
    key: HSL_KEY,
    measure,
    csv: true,
    startPeriod: '2010',
    unit,
    basis: `OECD How's Life? current well-being indicator ${measure} (all ages, both sexes, all education levels)`,
    direction,
    category: 'wellbeing',
    source_dataset: "How's Life? Current well-being (OECD WISE)",
  });
}

// Confidence (sentiment dashboard): the OECD's harmonised consumer and business confidence indicators, monthly,
// amplitude-adjusted so each country's long-run average is 100. One request returns both for every country.
const CLI_FLOW = 'OECD.SDD.STES,DSD_STES@DF_CLI,4.1';
const CLI_KEY = '.M.CCICP+BCICP......';
for (const [measure, metric_id, name] of [
  ['CCICP', 'consumer_confidence_oecd', 'Consumer confidence index (OECD harmonised)'],
  ['BCICP', 'business_confidence_oecd', 'Business confidence index (OECD harmonised)'],
]) {
  OECD_SERIES.push({
    metric_id, name, flow: CLI_FLOW, key: CLI_KEY, measure, csv: true, startPeriod: '2000-01',
    unit: 'index, long-run average = 100',
    basis: `OECD ${name.replace(' (OECD harmonised)', '')}, amplitude adjusted (long-run average 100), monthly`,
    direction: 'higher_is_less_pressure',
    category: 'sentiment',
    source_dataset: 'Composite leading indicators: confidence indicators (OECD Main Economic Indicators)',
  });
}
