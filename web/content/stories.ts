/** Story registry. Each story is a versioned entry here; the body lives in its page.
 *  Evidence pages are generated from `evidence` below, so every claim on social
 *  resolves to its receipts. */
export interface SourceRow {
  metric: string; org: string; tier: 1 | 2 | 3; url: string;
  period: string; basis: string;
}
export interface Story {
  slug: string; kicker: string; title: string; hook: string; caveat: string;
  published: string; oneNumber: { value: string; label: string };
  evidence: { table?: { head: string[]; rows: string[][] }; sources: SourceRow[] };
}

export const STORIES: Story[] = [
  {
    slug: 'migration-denominator',
    kicker: 'Migration · Denominator check',
    title: 'America takes the most migrants in the world. Per person, it ranks 26th.',
    hook: 'The chart everyone shared measures the size of the economy, not how open a country is.',
    caveat: 'Per-capita structurally favours micro-states like Luxembourg and Iceland. Eight countries here use unstandardised national statistics.',
    published: '2026-08-07',
    oneNumber: { value: '1st → 26th', label: 'United States, absolute intake to intake per person' },
    evidence: {
      table: {
        head: ['Country', 'Inflow 2024 (000s)', 'Population (m)', 'Per 1,000', 'Rank abs', 'Rank per capita'],
        rows: [
          ['United States', '1,425.1', '340.1', '4.2', '1', '26'],
          ['Germany', '586.2', '83.6', '7.0', '2', '19'],
          ['Canada', '483.6', '41.5', '11.7', '3', '6'],
          ['Australia', '239.3', '27.2', '8.8', '8', '14'],
          ['Japan', '177.1', '123.8', '1.4', '10', '35'],
          ['Luxembourg', '26.4', '0.67', '39.4', '30', '1'],
          ['Iceland', '14.8', '0.39', '37.9', '33', '2'],
        ],
      },
      sources: [
        { metric: 'Permanent migration inflow, 2024', org: 'OECD', tier: 1,
          url: 'https://data-explorer.oecd.org/s/31n', period: '2024',
          basis: 'Standardised inflows of permanent-type migrants; foreign nationals; includes status changes' },
        { metric: 'Population, 2024', org: 'World Bank', tier: 1,
          url: 'https://data.worldbank.org/', period: '2024', basis: 'Mid-year total population' },
      ],
    },
  },
  {
    slug: 'wage-spiral',
    kicker: 'Wages · Claim check',
    title: 'The minimum wage just jumped 6%. The last two big rises were followed by falling inflation.',
    hook: 'The spiral has now been predicted six years running. The regulator measured what one rise actually adds.',
    caveat: 'Timing is not exoneration: rate rises did much of the disinflation work in 2023 and 2024. The 2023 minimum-wage figure of 8.65% includes a one-off technical realignment, so award rates are the like-for-like comparison.',
    published: '2026-08-07',
    oneNumber: { value: '0.36pp', label: 'Measured contribution of the 2024 rise to wage growth' },
    evidence: {
      table: {
        head: ['Decision (1 Jul)', 'Award rise', 'CPI at decision', 'CPI ~12 months later', 'Direction'],
        rows: [
          ['2021', '2.5%', '3.8%', '6.1%', 'rising'],
          ['2022', '4.6%', '6.1%', '6.0%', 'falling'],
          ['2023', '5.75%', '6.0%', '3.8%', 'falling'],
          ['2024', '3.75%', '3.8%', '2.1%', 'falling'],
          ['2025', '3.5%', '2.1%', '3.8%', 'rising'],
          ['2026', '4.75%', '~4%', 'pending', '—'],
        ],
      },
      sources: [
        { metric: 'Annual Wage Review decisions 2021–2026', org: 'Fair Work Commission', tier: 1,
          url: 'https://www.fwc.gov.au/hearings-decisions/major-cases/annual-wage-reviews',
          period: '2021–2026', basis: 'Modern award increases, effective 1 July' },
        { metric: 'Consumer Price Index', org: 'ABS', tier: 1,
          url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia',
          period: '2021–2026', basis: 'Headline CPI, annual change to June' },
        { metric: 'Wage-growth pass-through of the 2024 increase', org: 'Fair Work Commission', tier: 1,
          url: 'https://www.fwc.gov.au/hearings-decisions/major-cases/annual-wage-reviews',
          period: '2025', basis: 'AWR 2025 decision: 0.36pp of the Wage Price Index' },
      ],
    },
  },
];

export const bySlug = (s: string) => STORIES.find((x) => x.slug === s);
