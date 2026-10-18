/**
 * Real figures for bars-borrowing.check.ts and the local preview: the Australian Government general government sector
 * fiscal balance ($m; + surplus, − borrowing) and its share of GDP (%), outcomes, as Treasury's Budget 2026–27 Budget
 * Paper No. 1, Statement 11, Table 11.6 prints them (read by agent/scripts/load-budget-history.mjs on 19 October 2026).
 */
export const FISCAL_BALANCE: Record<string, number> = {
  '2004-05': 11892, '2005-06': 16094, '2006-07': 16365, '2007-08': 20475, '2008-09': -30445, '2009-10': -54400,
  '2010-11': -52802, '2011-12': -45474, '2012-13': -24842, '2013-14': -45390, '2014-15': -42206, '2015-16': -39513,
  '2016-17': -36865, '2017-18': -6493, '2018-19': 1350, '2019-20': -95844, '2020-21': -136108, '2021-22': -35061,
  '2022-23': 21926, '2023-24': 11996, '2024-25': -44806,
};

export const FISCAL_BALANCE_PCT_GDP: Record<string, number> = {
  '2004-05': 1.3, '2005-06': 1.6, '2006-07': 1.5, '2007-08': 1.7, '2008-09': -2.4, '2009-10': -4.2,
  '2010-11': -3.7, '2011-12': -3.0, '2012-13': -1.6, '2013-14': -2.8, '2014-15': -2.6, '2015-16': -2.4,
  '2016-17': -2.1, '2017-18': -0.4, '2018-19': 0.1, '2019-20': -4.8, '2020-21': -6.5, '2021-22': -1.5,
  '2022-23': 0.9, '2023-24': 0.4, '2024-25': -1.6,
};

/** As the loader writes source_dataset and source_url for budget_fiscal_balance_au. */
export const FISCAL_SOURCE = {
  dataset: 'Budget 2026–27 Budget Paper No. 1, Statement 11: Historical Australian Government Data, Table 11.6',
  url: 'https://budget.gov.au/content/bp1/download/bp1_bs-11.docx',
};
