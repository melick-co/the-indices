/**
 * Rank RSS items into top news topics for 1-day and 7-day windows.
 */
import { readFileSync } from 'node:fs';
import { detectTrends } from './trend-detect.mjs';
import { sydneyDate, toSydneyDate, sydneyDateRange, priorSydneyDate } from './sydney-time.mjs';

const TOP_N = 10;

function itemTimestamp(item) {
  return item.published_at ?? item.fetched_at;
}

/** Filter items whose Sydney calendar date is in the allowed set. */
export function filterItemsBySydneyDates(items, dates) {
  const allowed = new Set(dates);
  return (items ?? []).filter((it) => {
    const d = toSydneyDate(itemTimestamp(it));
    return d && allowed.has(d);
  });
}

/** Mechanical ranking from trend clusters. */
export function rankRssMechanical(recent, baseline, trackedTopics = []) {
  const clusters = detectTrends(recent, baseline, trackedTopics);
  return clusters.slice(0, TOP_N).map((c, i) => ({
    rank: i + 1,
    topic: c.label,
    score: Number(c.spike_score),
    mention_count: c.item_count,
    outlet_count: c.outlet_count,
    keywords: c.keywords,
    sample_headlines: (c.items ?? []).slice(0, 4).map((it) => ({
      title: it.title,
      link: it.link ?? null,
    })),
  }));
}

/** Use Claude to distill headlines into a clean top-10 topic list. */
export async function rankRssWithClaude(items, windowLabel) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.includes('your-')) {
    return null;
  }

  const headlines = items.slice(0, 120).map((it) => ({
    title: it.title,
    summary: (it.summary ?? '').slice(0, 160),
    keywords: it.matched_keywords ?? [],
    published_at: it.published_at,
  }));

  if (!headlines.length) return [];

  const charter = readFileSync(new URL('../../EDITORIAL.md', import.meta.url), 'utf8');
  const prompt = readFileSync(new URL('../../taste/trending-topics-prompt.md', import.meta.url), 'utf8')
    .replace('{EDITORIAL.md}', charter)
    .replace('{window_label}', windowLabel)
    .replace('{JSON: headlines}', JSON.stringify(headlines));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Claude trending topics ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }

  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Unparseable Claude trending topics response');
  }

  return (parsed.topics ?? []).slice(0, TOP_N).map((t, i) => ({
    rank: i + 1,
    topic: t.topic,
    score: t.score ?? (TOP_N - i),
    mention_count: t.mention_count ?? t.headline_count ?? 0,
    summary: t.summary ?? null,
    sample_headlines: (t.sample_headlines ?? []).slice(0, 4),
  }));
}

/**
 * Build ranked RSS topics for a window ending on periodEnd (Sydney date).
 * @param {'1d'|'7d'} windowType
 */
export async function rankRssTopics(allItems, baselineItems, trackedTopics, periodEnd, windowType) {
  const days = windowType === '1d' ? 1 : 7;
  const dates = windowType === '1d' ? [periodEnd] : sydneyDateRange(periodEnd, 7);
  const recent = filterItemsBySydneyDates(allItems, dates);
  const baselineEnd = priorSydneyDate(dates[0], 1);
  const baselineDates = windowType === '1d'
    ? [baselineEnd]
    : sydneyDateRange(baselineEnd, 7);
  const baseline = filterItemsBySydneyDates(baselineItems, baselineDates);

  const windowLabel = windowType === '1d'
    ? `the previous calendar day (${periodEnd}, Australia/Sydney)`
    : `the seven days ending ${periodEnd} (Australia/Sydney)`;

  let topics = await rankRssWithClaude(recent, windowLabel);
  if (!topics) {
    topics = rankRssMechanical(recent, baseline, trackedTopics);
  }

  return { topics, item_count: recent.length };
}
