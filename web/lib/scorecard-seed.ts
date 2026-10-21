import type { CommitmentDraft } from '@/lib/scorecard';

/**
 * Commitments found and read in the official documents while the scorecard was built (October 2026). They are
 * candidates, not exceptions: each goes through the same strict check as anything the model drafts (the quote must be
 * in the document's own text, and the source check must confirm it), and lives only with an official stored series.
 *
 * Considered and left out (no quotable official numeric target, or no official series that measures it):
 *  - the budget balance against the government's own forecast: the budget forecasts the underlying cash balance; the
 *    official stored series is GFS accrual net lending (IMF QGFS), a different measure. It is under Outcomes instead.
 *  - real wages: the commitment ("get wages moving") has no numeric target. Under Outcomes.
 *  - energy bills "$275 lower": from a 2022 party policy document, not an official one, and the CPI measures prices,
 *    not dollars a year.
 *  - fee-free TAFE places, social and affordable homes, first home buyer guarantees: official targets exist, but no
 *    official statistical series measures them (program counts reported by departments).
 */
export const SEED: CommitmentDraft[] = [
  {
    slug: 'housing-accord-1-2-million-homes',
    title: '1.2 million new homes in the five years from 1 July 2024 (National Housing Accord)',
    // The Prime Minister's media release (PM&C's official transcript archive). Treasury's Accord page carries the same
    // target but was down for maintenance on 21 Oct 2026 (HTTP 503 "Site under maintenance").
    quote: 'That’s why National Cabinet has agreed to an ambitious new national target to build 1.2 million new well-located homes over five years, from 1 July 2024.',
    source_url: 'https://pmtranscripts.pmc.gov.au/node/40913',
    source_title: 'Prime Minister, media release: Meeting of National Cabinet, working together to deliver better housing outcomes (transcript 45222)',
    source_date: '2023-08-16',
    metric_id: 'dwelling_completions_au',
    series_label: 'ABS Building Activity: dwelling units completed, total residential, original, summed by quarter',
    data_note: null,
    target_value: 1_200_000, target_unit: 'homes', start_date: '2024-07-01', target_date: '2029-06-30',
    direction: 'increase', baseline_value: null, baseline_period: null, method: 'cumulative_sum',
    target_text: '1.2 million new well-located homes', deadline_text: 'over five years, from 1 July 2024',
    start_basis: 'The Accord period begins 1 July 2024, as the source states.',
    needs: { series: 'Dwelling units completed, total residential, total sectors, quarterly, original (Building Activity, Australia)', org: 'ABS' },
  },
  {
    slug: 'emissions-43-per-cent-below-2005-by-2030',
    title: 'Emissions 43 per cent below 2005 levels by 2030',
    quote: 'Australia’s current legislated target to reduce emissions is 43% below 2005 levels by 2030 and to achieve net zero emissions by 2050.',
    source_url: 'https://www.dcceew.gov.au/climate-change/emissions-reduction',
    source_title: 'Reducing emissions (Department of Climate Change, Energy, the Environment and Water)',
    source_date: null,
    metric_id: null,
    series_label: 'National Greenhouse Gas Inventory: net emissions including land use (DCCEEW)',
    data_note: 'Needs Australia\'s net greenhouse gas emissions (National Greenhouse Gas Inventory, DCCEEW), with the 2005 level, from an official machine-readable source.',
    target_value: 43, target_unit: '% below 2005', start_date: '2022-05-21', target_date: '2030-12-31',
    direction: 'decrease', baseline_value: null, baseline_period: '2005', method: 'change',
    target_text: '43% below 2005 levels', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the start of the government\'s first term (21 May 2022), the term in which the target was legislated. "By 2030" is read as the end of 2030.',
    needs: { series: 'Australia net greenhouse gas emissions including LULUCF, National Greenhouse Gas Inventory', org: 'DCCEEW' },
  },
  {
    slug: 'renewables-82-per-cent-of-electricity-by-2030',
    title: '82 per cent of electricity from renewable sources by 2030',
    quote: 'help deliver the Australian Government’s 82% renewable electricity by 2030 target',
    source_url: 'https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme',
    source_title: 'Capacity Investment Scheme (Department of Climate Change, Energy, the Environment and Water)',
    source_date: null,
    metric_id: null,
    series_label: 'Australian Energy Statistics: renewable share of electricity generation (DCCEEW)',
    data_note: 'Needs the renewable share of Australian electricity generation (Australian Energy Statistics, Table O, DCCEEW) from an official machine-readable source.',
    target_value: 82, target_unit: '% of electricity generation', start_date: '2022-05-21', target_date: '2030-12-31',
    direction: 'increase', baseline_value: null, baseline_period: null, method: 'share',
    target_text: '82% renewable electricity', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the start of the government\'s first term (21 May 2022), the term in which the target was set. "By 2030" is read as the end of 2030.',
    needs: { series: 'Renewable share of electricity generation, Australia, Australian Energy Statistics Table O', org: 'DCCEEW' },
  },
  {
    slug: 'bulk-billing-9-in-10-gp-visits-by-2030',
    title: '9 in 10 GP visits bulk billed by 2030',
    quote: 'Australians will save hundreds of dollars a year in out-of-pocket costs, with 9 in 10 GP visits to be bulk billed by 2030 thanks to a $7.9 billion investment.',
    source_url: 'https://www.health.gov.au/sites/default/files/2025-03/budget-2025-26-strengthening-medicare-more-bulk-billing.pdf',
    source_title: 'Budget 2025–26: Strengthening Medicare, more bulk billing (Department of Health, Disability and Ageing)',
    source_date: '2025-03-25',
    metric_id: null,
    series_label: 'Medicare statistics: GP non-referred attendances bulk billed (Department of Health, Disability and Ageing)',
    data_note: 'Needs the GP bulk billing rate (Medicare quarterly statistics, Department of Health, Disability and Ageing) from an official machine-readable source.',
    target_value: 90, target_unit: '% of GP visits bulk billed', start_date: '2025-03-25', target_date: '2030-12-31',
    direction: 'increase', baseline_value: null, baseline_period: null, method: 'level',
    target_text: '9 in 10 GP visits', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the 2025–26 Budget (25 March 2025), which set the target. "By 2030" is read as the end of 2030.',
    needs: { series: 'GP non-referred attendances bulk billing rate, Medicare quarterly statistics', org: 'Department of Health, Disability and Ageing' },
  },
];

/** Official pages the first run reads for further commitments (the model drafts; the strict check decides). */
export const SEED_SOURCES = [
  'https://pmtranscripts.pmc.gov.au/node/40913',
  'https://treasury.gov.au/policy-topics/housing/accord',
  'https://www.dcceew.gov.au/climate-change/emissions-reduction',
  'https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme',
  'https://www.dcceew.gov.au/climate-change/publications/australias-emissions-projections-2024',
  'https://www.health.gov.au/sites/default/files/2025-03/budget-2025-26-strengthening-medicare-more-bulk-billing.pdf',
  'https://budget.gov.au/content/overview/index.htm',
  'https://www.pm.gov.au/media',
  'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases',
];
