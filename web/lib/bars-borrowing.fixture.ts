/**
 * Real figures for bars-borrowing.check.ts and the local preview: the Australian Government general government sector
 * underlying cash balance ($m; + surplus, − deficit) and its share of GDP (%), outcomes, as Treasury's Budget 2026–27
 * Budget Paper No. 1, Statement 11, Table 11.1 prints them (read by agent/scripts/load-budget-history.mjs on
 * 19 October 2026).
 */
export const UCB: Record<string, number> = {
  '2004-05': 13577, '2005-06': 15757, '2006-07': 17190, '2007-08': 19754, '2008-09': -27013, '2009-10': -54494,
  '2010-11': -47463, '2011-12': -43360, '2012-13': -18834, '2013-14': -48456, '2014-15': -37867, '2015-16': -39606,
  '2016-17': -33151, '2017-18': -10141, '2018-19': -690, '2019-20': -85272, '2020-21': -134171, '2021-22': -31962,
  '2022-23': 22064, '2023-24': 15779, '2024-25': -9990,
};

export const UCB_PCT_GDP: Record<string, number> = {
  '2004-05': 1.5, '2005-06': 1.6, '2006-07': 1.6, '2007-08': 1.7, '2008-09': -2.1, '2009-10': -4.2,
  '2010-11': -3.3, '2011-12': -2.9, '2012-13': -1.2, '2013-14': -3.0, '2014-15': -2.3, '2015-16': -2.4,
  '2016-17': -1.9, '2017-18': -0.5, '2018-19': 0.0, '2019-20': -4.3, '2020-21': -6.4, '2021-22': -1.4,
  '2022-23': 0.9, '2023-24': 0.6, '2024-25': -0.4,
};

/** As the loader writes source_dataset and source_url for budget_underlying_cash_balance_au. */
export const UCB_SOURCE = {
  dataset: 'Budget 2026–27 Budget Paper No. 1, Statement 11: Historical Australian Government Data, Table 11.1',
  url: 'https://budget.gov.au/content/bp1/download/bp1_bs-11.docx',
};
