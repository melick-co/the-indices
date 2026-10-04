import { SECTIONS, type Indicator, type Section } from '@/content/dashboard/economy';

/**
 * The sentiment dashboard: how Australians and businesses feel, from the OECD's harmonised confidence indices
 * (official, monthly, comparable across countries), set beside the official numbers that test the mood. Published
 * polls appear below the grid as clearly labelled private context (tier 3), never as a headline figure.
 */

/** An economy-dashboard indicator, reused as-is so both dashboards show identical readings. */
function economy(sectionId: string, metricId: string, minus?: string): Indicator {
  const s = SECTIONS.find((x) => x.id === sectionId);
  const ind = s && [s.headline, ...s.others].find((i) => i.metric_id === metricId && i.minus === minus);
  if (!ind) throw new Error(`sentiment: no economy indicator ${sectionId}/${metricId}`);
  return ind;
}

const LONG_RUN_100 = (what: string, url: string) => ({
  kind: 'floor' as const, value: 100, short: 'its long-run average',
  label: `100, the index's long-run average: above 100 means ${what} are more confident than usual, below 100 less`,
  source: { text: 'OECD, composite leading indicators and confidence indices', url },
});

export const SENTIMENT_SECTIONS: Section[] = [
  {
    id: 'consumers',
    title: 'Consumers',
    question: 'How do households feel, and do the numbers bear it out?',
    headline: {
      metric_id: 'consumer_confidence_oecd', label: 'Consumer confidence (OECD harmonised index)', short: 'Consumer confidence',
      subject: 'Consumer confidence',
      why: 'How households rate their finances and the economy, harmonised by the OECD from national consumer surveys and scaled so each country\'s long-run average is 100. Gloomy households spend less, which feeds back into growth.',
      benchmark: LONG_RUN_100('consumers', 'https://www.oecd.org/en/data/indicators/consumer-confidence-index-cci.html'),
      higherIsBetter: true, history: 60, unit: 'index',
    },
    // The numbers that test the mood: what households face in their budgets.
    others: [
      economy('jobs', 'wpi_annual_au', 'cpi_annual_au'),
      economy('prices', 'cpi_monthly_annual_au'),
      economy('jobs', 'unemployment_rate_au'),
      economy('housing', 'housing_repayments_income_au'),
      economy('prices', 'rent_cpi_annual_au'),
    ],
  },
  {
    id: 'business',
    title: 'Business',
    question: 'How do firms feel, and is the economy giving them reason to?',
    headline: {
      metric_id: 'business_confidence_oecd', label: 'Business confidence (OECD harmonised index)', short: 'Business confidence',
      subject: 'Business confidence',
      why: 'How firms see production, orders and stocks in the months ahead, harmonised by the OECD from national business surveys and scaled so each country\'s long-run average is 100. It tends to turn before investment and hiring do.',
      benchmark: LONG_RUN_100('firms', 'https://www.oecd.org/en/data/indicators/business-confidence-index-bci.html'),
      higherIsBetter: true, history: 60, unit: 'index',
    },
    others: [
      economy('growth', 'gdp_growth_qoq_au'),
      economy('growth', 'market_gva_per_hour_annual_au'),
      economy('rates', 'cash_rate_au'),
      economy('rates', 'bond_yield_10y_au'),
    ],
  },
];

export const sentimentSectionById = (id: string) => SENTIMENT_SECTIONS.find((s) => s.id === id);
