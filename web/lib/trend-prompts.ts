/** Build Foundry session prompts from a trend hypothesis pitch. */

type TrendTrigger = {
  cluster_label?: string;
  keywords?: string[];
  data_needed?: string;
  item_ids?: string[];
};

export function buildTrendAskPrompt(headline: string, trigger: TrendTrigger): string {
  const parts = [
    `Investigate this trend hypothesis: ${headline}`,
    trigger.cluster_label ? `\nTrend cluster: ${trigger.cluster_label}` : '',
    trigger.keywords?.length ? `\nKeywords: ${trigger.keywords.join(', ')}` : '',
    trigger.data_needed ? `\nData to check: ${trigger.data_needed}` : '',
    '\nDoes our tier 1/2 data support, contradict, or complicate the narrative in the news?',
  ];
  return parts.join('');
}

export function buildTrendBrainstormPrompt(headline: string, trigger: TrendTrigger): string {
  const parts = [
    `Brainstorm Caveat angles on this feed trend: ${headline}`,
    trigger.cluster_label ? `\nCluster: ${trigger.cluster_label}` : '',
    trigger.keywords?.length ? `\nKeywords: ${trigger.keywords.join(', ')}` : '',
    trigger.data_needed ? `\nSuggested data checks: ${trigger.data_needed}` : '',
    '\nWhat would make this a story, and what would kill it?',
  ];
  return parts.join('');
}

export function trendInvestigatePrompts(headline: string, trigger: TrendTrigger) {
  return {
    title: headline.slice(0, 80),
    ask: buildTrendAskPrompt(headline, trigger),
    brainstorm: buildTrendBrainstormPrompt(headline, trigger),
  };
}
