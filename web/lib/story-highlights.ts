/**
 * The story in three numbers (StoryHighlights): the model picks the standfirst's key points and how to show each
 * (figure, label, note, direction, which of the story's own charts to sparkline). Every number in what it writes must
 * already be in the story, or the set is rejected: the graphic can only restate checked figures, never add one.
 */
import type { Story, StoryBlock, StoryChartBlock, StoryHighlight, StoryHighlights } from '@/lib/story-types';

const MODEL = 'claude-sonnet-4-6';

export const chartsOf = (blocks: StoryBlock[] = []) => blocks.filter((b): b is StoryChartBlock => b.type === 'chart' && Array.isArray(b.series) && b.series.length > 1);

/** Numbers as written, normalised: "A$2,568 billion" and "A$2,568bn" both give 2568; "7.3 per cent" gives 7.3. */
export function numbersIn(text: string): string[] {
  return (text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** Everything the story itself says, as the pool of numbers a highlight may use. */
export function storyNumbers(story: Pick<Story, 'title' | 'hook' | 'caveat' | 'oneNumber' | 'body'>): Set<string> {
  const parts: string[] = [story.title, story.hook, story.caveat, story.oneNumber?.value ?? '', story.oneNumber?.label ?? '', story.oneNumber?.comparison ?? ''];
  for (const b of story.body?.blocks ?? []) {
    if (b.type === 'paragraph') parts.push(b.text);
    if (b.type === 'chart') {
      parts.push(b.title ?? '', b.subtitle ?? '', b.caption ?? '');
      for (const p of b.series) parts.push(String(p.value), p.label);
    }
  }
  return new Set(numbersIn(parts.join(' ').replace(/\[\^\d+\]/g, ' ')));
}

/** Problems with a set of highlights; empty when every number is the story's own and every chart exists. */
export function checkHighlights(items: StoryHighlight[], story: Pick<Story, 'title' | 'hook' | 'caveat' | 'oneNumber' | 'body'>): string[] {
  const have = storyNumbers(story);
  const charts = chartsOf(story.body?.blocks);
  const problems: string[] = [];
  if (items.length < 2 || items.length > 4) problems.push(`${items.length} highlights (want 2 to 4)`);
  for (const h of items) {
    for (const n of numbersIn(`${h.figure} ${h.label} ${h.note ?? ''}`)) if (!have.has(n)) problems.push(`"${n}" in "${h.figure} / ${h.label} / ${h.note ?? ''}" is not in the story`);
    if (h.chart != null && !charts[h.chart]) problems.push(`chart ${h.chart} does not exist`);
    if (!h.figure?.trim() || !h.label?.trim()) problems.push('a highlight is missing its figure or label');
  }
  return problems;
}

type StoryForHighlights = Pick<Story, 'title' | 'hook' | 'caveat' | 'kicker' | 'oneNumber' | 'body'>;

/** Ask for the highlights, check them, and ask once more with the problems if they fail. Null if they never pass. */
export async function generateHighlights(story: StoryForHighlights, log: (m: string) => void = () => {}): Promise<StoryHighlights | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) { log('No ANTHROPIC_API_KEY; no highlights.'); return null; }
  const charts = chartsOf(story.body?.blocks).map((c, i) => ({
    index: i, title: c.title, subtitle: c.subtitle,
    from: c.series[0], to: c.series.at(-1), points: c.series.length,
  }));
  const paragraphs = (story.body?.blocks ?? []).filter((b) => b.type === 'paragraph').slice(0, 8).map((b) => (b as { text: string }).text.replace(/\[\^\d+\]/g, ''));
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 900,
        system: [
          'You design the graphic at the top of a data-journalism article: "the story in three numbers". A reader should get the gist of the standfirst from it at a glance, then read on.',
          'Pick 3 highlights (2 to 4 if the story needs it) that follow the standfirst, in its order. Each: figure (compact, as it should appear large, e.g. "A$2,568bn", "4.6%", "-A$34bn"), label (what it is, at most 6 words), note (one line of context, at most 10 words), direction (up, down or flat: the way the figure moved), and chart (the index of the story chart that shows it, or null).',
          'Use only numbers that appear in the story as given; do not compute, round differently or add any. Write bn for billion and % for per cent. Australian English, no em dashes.',
          'Reply with JSON only: {"items":[{"figure":"","label":"","note":"","direction":"up","chart":0}]}.',
        ].join(' '),
        messages: [{ role: 'user', content: JSON.stringify({ kicker: story.kicker, headline: story.title, standfirst: story.hook.replace(/\[\^\d+\]/g, ''), key_number: story.oneNumber, charts, opening_paragraphs: paragraphs }) + feedback }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) { log(`Highlights: model error ${res.status}`); return null; }
    const body = await res.json() as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    let items: StoryHighlight[] = [];
    try { items = (JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { items: StoryHighlight[] }).items ?? []; } catch { /* checked below */ }
    const problems = checkHighlights(items, story);
    if (!problems.length) return { items, generated_at: new Date().toISOString(), model: MODEL };
    log(`Highlights attempt ${attempt} rejected: ${problems.join('; ')}`);
    feedback = `\n\nYour last answer was rejected: ${problems.join('; ')}. Use only numbers that appear in the story.`;
  }
  return null;
}
