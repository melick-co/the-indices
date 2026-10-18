/**
 * The two economy-wide emergency packages Treasury itself grouped and costed, with Treasury's own year-by-year impact
 * on the underlying cash balance. Used by the borrowing video's "trimmed" pass (lib/bars-borrowing.ts). Same rule for
 * both: the package group as Treasury defined it, the latest official Treasury table that splits it by year, figures
 * copied as printed (never apportioned or adjusted here). Costs are stored positive: each one widened the deficit.
 * Revenue lost to the recessions themselves is not a package cost and is not here.
 *
 * Checked in emergency-packages.check.ts against each table's own totals.
 */
export type PackageYear = { fy: string; cost: number; parts?: Record<string, number> };
export type EmergencyPackage = {
  key: 'gfc' | 'covid';
  /** As the video names it. */
  name: string;
  /** What Treasury's table counts in the group, in its words. */
  includes: string;
  source: { org: 'Treasury'; document: string; table: string; rows: string; url: string; published: string };
  /** Whether the figures are estimates at the time of the document (no later Treasury table splits the group by year). */
  basis: string;
  years: PackageYear[];
  /** Totals the document itself prints, for the check. */
  statedTotals: { label: string; value: number; parts?: string[] }[];
};

export const EMERGENCY_PACKAGES: EmergencyPackage[] = [
  {
    key: 'gfc',
    name: 'the GFC stimulus packages',
    includes: 'Major fiscal stimulus packages: Economic Security Strategy; November 2008 Council of Australian Governments reforms; December 2008 Nation Building Package; and Nation Building and Jobs Plan (the table\'s note)',
    source: {
      org: 'Treasury',
      document: '2009-10 Budget, Budget Paper No. 1, Statement 4: Assessing the Sustainability of the Budget',
      table: 'Table 1: The components of fiscal policy',
      rows: 'Major fiscal stimulus packages (underlying cash balance, $m)',
      url: 'https://reference-budget.tspace.gov.au/2009-10/content/bp1/downloads/bp1_bst4.pdf',
      published: '2009-05-12',
    },
    basis: 'Estimates at the 2009-10 Budget. No later Treasury table splits the stimulus packages by year (the 2009-10 MYEFO, 2009-10 Final Budget Outcome and the 2010-11 and 2011-12 Budgets were checked); the table ends at 2011-12.',
    years: [
      { fy: '2008-09', cost: 26587 },
      { fy: '2009-10', cost: 22352 },
      { fy: '2010-11', cost: 12716 },
      { fy: '2011-12', cost: 5056 },
    ],
    // The same table: effect of policy decisions less other policy decisions is the stimulus line, each year.
    statedTotals: [
      { label: 'Effect of policy decisions less other policy decisions, 2008-09', value: 33384 - 6797 },
      { label: 'Effect of policy decisions less other policy decisions, 2009-10', value: 31960 - 9608 },
      { label: 'Effect of policy decisions less other policy decisions, 2010-11', value: 18614 - 5898 },
      { label: 'Effect of policy decisions less other policy decisions, 2011-12', value: 13197 - 8141 },
    ],
  },
  {
    key: 'covid',
    name: 'the COVID-19 response measures',
    includes: 'Direct economic and health support since the onset of the pandemic (support since the 2019-20 MYEFO): the COVID-19 Response Package measures to the 2020-21 MYEFO, the 2021-22 Budget\'s economic measures, and the COVID-19 health response measures (the table\'s notes (a) to (f))',
    source: {
      org: 'Treasury',
      document: '2021-22 Budget fact sheet: Recovery and response support',
      table: 'Recovery and response support since the onset of the pandemic (as at 2021-22 Budget)',
      rows: 'TOTAL – economic response; TOTAL – health measures (impact on the underlying cash balance, $m)',
      url: 'https://archive.budget.gov.au/2021-22/factsheets/download/factsheet_recovery_response.pdf',
      published: '2021-05-11',
    },
    basis: 'Estimates at the 2021-22 Budget, the latest Treasury table that splits the $311 billion by year. Later Budgets give totals only ($314 billion of direct economic support at the March 2022 Budget) and note underspends in these measures in 2020-21 and 2021-22 (October 2022 Budget, Budget Paper No. 1, note to Chart 3.20).',
    years: [
      { fy: '2019-20', cost: 50439 + 6273, parts: { economic: 50439, health: 6273 } },
      { fy: '2020-21', cost: 136325 + 9584, parts: { economic: 136325, health: 9584 } },
      { fy: '2021-22', cost: 49869 + 4027, parts: { economic: 49869, health: 4027 } },
      { fy: '2022-23', cost: 32537 + 176, parts: { economic: 32537, health: 176 } },
      { fy: '2023-24', cost: 13258 + 8, parts: { economic: 13258, health: 8 } },
      { fy: '2024-25', cost: 8986 + 7, parts: { economic: 8986, health: 7 } },
    ],
    statedTotals: [
      { label: 'TOTAL – economic response, 2019-20 to 2024-25', value: 291414, parts: ['economic'] },
      { label: 'TOTAL – health measures, 2019-20 to 2024-25', value: 20075, parts: ['health'] },
      { label: 'Total direct economic and health support since the onset of the pandemic ($311 billion)', value: 311489 },
    ],
  },
];

/** Package cost by financial year ("2020-21" → $m), across both packages. */
export function packageCosts(packages = EMERGENCY_PACKAGES): Map<string, { cost: number; key: EmergencyPackage['key'] }> {
  const out = new Map<string, { cost: number; key: EmergencyPackage['key'] }>();
  for (const p of packages) for (const y of p.years) {
    if (out.has(y.fy)) throw new Error(`${y.fy} is in two packages`);
    out.set(y.fy, { cost: y.cost, key: p.key });
  }
  return out;
}
