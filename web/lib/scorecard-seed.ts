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
    // The department measures the target on net emissions including LULUCF over the year to each quarter, against the
    // year to June 2005 ("the baseline year for Australia's 43% reduction by 2030 target", Quarterly Update, March 2026).
    // The series is that per cent change (negative = below 2005), loaded by agent/scripts/load-official-workbooks.mjs
    // from the Quarterly Update's data workbook. Rated as a level falling to -43: the reference level is the series'
    // own (it moves with each inventory revision), so no fixed baseline_value is stored.
    metric_id: 'emissions_change_from_2005_au',
    series_label: 'National Greenhouse Gas Inventory Quarterly Update (DCCEEW): emissions including LULUCF over the year to each quarter, per cent change on the year to June 2005',
    data_note: 'Measured from the data workbook of DCCEEW\'s Quarterly Update of Australia\'s National Greenhouse Gas Inventory; rated once the series is stored.',
    target_value: -43, target_unit: '% change on 2005 levels', start_date: '2022-05-21', target_date: '2030-12-31',
    direction: 'decrease', baseline_value: null, baseline_period: '2004-05', method: 'level',
    target_text: '43% below 2005 levels', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the start of the government\'s first term (21 May 2022), the term in which the target was legislated: the starting reading is the year to June 2022. Measured as the department measures the target: net emissions including land use (LULUCF) over the year to each quarter, against the year to June 2005, the target\'s baseline year. "By 2030" is read as the end of 2030.',
    needs: { series: 'Australia net greenhouse gas emissions including LULUCF, National Greenhouse Gas Inventory', org: 'DCCEEW' },
  },
  {
    slug: 'renewables-82-per-cent-of-electricity-by-2030',
    title: '82 per cent of electricity from renewable sources by 2030',
    quote: 'help deliver the Australian Government’s 82% renewable electricity by 2030 target',
    source_url: 'https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme',
    source_title: 'Capacity Investment Scheme (Department of Climate Change, Energy, the Environment and Water)',
    source_date: null,
    // The 82% target is for on-grid electricity: DCCEEW publishes on-grid generation as Australian Energy Statistics
    // supplementary statistics "to track progress towards Australia's target to reach 82% renewable electricity on-grid
    // by 2030" (pumped hydro excluded). Table O covers all generation, off-grid included, so it is not the target's
    // measure (loaded as context: renewable_share_generation_au). Calendar years: the 2030 reading is the year named.
    metric_id: 'renewable_share_ongrid_au',
    series_label: 'Australian Energy Statistics (DCCEEW): renewable share of on-grid electricity generation, calendar year',
    data_note: 'Measured from DCCEEW\'s Australian Energy Statistics on-grid generation statistics; rated once the series is stored.',
    target_value: 82, target_unit: '% of on-grid electricity generation', start_date: '2022-05-21', target_date: '2030-12-31',
    direction: 'increase', baseline_value: null, baseline_period: null, method: 'share',
    target_text: '82% renewable electricity', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the start of the government\'s first term (21 May 2022), the term in which the target was set: the starting reading is calendar 2022. Measured on the department\'s on-grid generation statistics, published to track this target (pumped hydro excluded); years the department marks as estimates are not used. "By 2030" is read as the end of 2030.',
    needs: { series: 'Renewable share of electricity generation, Australia, Australian Energy Statistics Table O', org: 'DCCEEW' },
  },
  {
    slug: 'bulk-billing-9-in-10-gp-visits-by-2030',
    title: '9 in 10 GP visits bulk billed by 2030',
    quote: 'Australians will save hundreds of dollars a year in out-of-pocket costs, with 9 in 10 GP visits to be bulk billed by 2030 thanks to a $7.9 billion investment.',
    source_url: 'https://www.health.gov.au/sites/default/files/2025-03/budget-2025-26-strengthening-medicare-more-bulk-billing.pdf',
    source_title: 'Budget 2025–26: Strengthening Medicare, more bulk billing (Department of Health, Disability and Ageing)',
    source_date: '2025-03-25',
    // "9 in 10 GP visits" is the services measure: the share of GP non-referred attendances bulk billed (Medicare
    // quarterly statistics, state and territory, Table 1), not the patient bulk billing rate (the share of patients all
    // of whose GP services were bulk billed). Quarterly and seasonal; pace runs from the March quarter 2025 reading.
    metric_id: 'gp_bulk_billing_rate_au',
    series_label: 'Medicare quarterly statistics (Department of Health, Disability and Ageing): GP non-referred attendances bulk billed, per cent of services',
    data_note: 'Measured from the Department of Health, Disability and Ageing\'s Medicare quarterly statistics (state and territory); rated once the series is stored.',
    target_value: 90, target_unit: '% of GP visits bulk billed', start_date: '2025-03-25', target_date: '2030-12-31',
    direction: 'increase', baseline_value: null, baseline_period: null, method: 'level',
    target_text: '9 in 10 GP visits', deadline_text: 'by 2030',
    start_basis: 'Pace is counted from the 2025–26 Budget (25 March 2025), which set the target: the starting reading is the March quarter 2025. Measured as the share of GP services (visits) bulk billed, the measure the target names, not the share of patients bulk billed for every visit. "By 2030" is read as the end of 2030.',
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
