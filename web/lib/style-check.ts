import type { StoryBlock, StoryChartBlock, StoryEvidence, StoryOneNumber, StoryQuoteBlock } from '@/lib/story-types';

/**
 * Pre-publish checklist from agent/NEWS-STYLE.md §6, as far as it can be
 * checked mechanically. `issues` are MUST items (they block publishing and feed
 * the revision rounds); `warnings` are style rules worth fixing that do not block.
 * Judgement calls (does the headline + deck tell the whole story?) are left to
 * the writer and revision prompts.
 */

export type StyleCheck = { ok: boolean; issues: string[]; warnings: string[] };

type Checkable = {
  title: string;
  hook: string;
  one_number?: StoryOneNumber | null;
  evidence?: StoryEvidence | null;
  body: { blocks: StoryBlock[] };
};

const HYPE = /\b(revolutionary|game[- ]changing|unprecedented|groundbreaking|stunning|shocking|staggering|jaw[- ]dropping|massive|skyrocket(?:s|ed|ing)?)\b/i;
const MARKER = /\[\^(\d+)\]/g;

const words = (t: string) => t.replace(MARKER, '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (t: string) => t.replace(MARKER, '').split(/(?<=[.!?])\s+(?=[A-Z"'“‘(])/).filter((x) => x.trim());
const paragraphs = (blocks: StoryBlock[]) => blocks.filter((b): b is Extract<StoryBlock, { type: 'paragraph' }> => b.type === 'paragraph');

/** Footnote numbers cited anywhere in a text. */
const cited = (t: string) => [...t.matchAll(MARKER)].map((m) => Number(m[1]));

// Figures: money, percentages, decimals, or integers of 10+ that are not years or days of the month.
const FIGURE = /(?:A\$|US\$|\$)\s?\d|\d[\d,]*(?:\.\d+)?\s?(?:%|per cent|pts?\b|bn\b|billion|million)|\b\d+\.\d+\b|\b(?!(?:19|20)\d{2}\b)\d{2,}[\d,]*\b(?!\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

/** Sentences that state a figure but carry no footnote marker. */
function unsourcedFigures(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘(])/)
    .filter((sentence) => !/\[\^\d+\]/.test(sentence) && FIGURE.test(sentence))
    .map((sentence) => sentence.slice(0, 90));
}

export function checkStyle(story: Checkable): StyleCheck {
  const issues: string[] = [];
  const warnings: string[] = [];
  const blocks = story.body.blocks;
  const paras = paragraphs(blocks);

  // 2.1 Headline: 6–12 words, a claim (not a question or a label).
  const hw = words(story.title);
  if (hw < 6 || hw > 12) issues.push(`headline is ${hw} words; it must be 6 to 12`);
  if (/\?\s*$/.test(story.title)) issues.push('headline is a question; it must make a claim');
  if (/[—:]/.test(story.title)) warnings.push('headline uses a dash or colon; prefer one clean claim');

  // 2.2 Deck: 20–35 words.
  const dw = words(story.hook);
  if (dw < 20 || dw > 35) issues.push(`deck is ${dw} words; it must be 20 to 35`);

  // 2.3 Hero graphic: a stat card from stored data, or a chart.
  const charts = blocks.filter((b): b is StoryChartBlock => b.type === 'chart');
  if (!story.one_number?.metric_id && !charts.length) issues.push('no hero graphic: give one_number a metric_id or include a chart');

  // 2.4 Lede: the first paragraph, at most 35 words.
  const lede = paras.find((p) => p.role === 'lede') ?? paras[0];
  if (!lede) issues.push('no lede paragraph');
  else if (words(lede.text) > 35) issues.push(`lede is ${words(lede.text)} words; it must be 35 or fewer`);
  if (lede && blocks.indexOf(lede) > 1) issues.push('the lede must open the story');

  // 2.5 Nut graf by paragraph 4.
  const nutIndex = paras.findIndex((p) => p.role === 'nut');
  if (nutIndex < 0) issues.push('no nut graf (a paragraph with role "nut")');
  else if (nutIndex > 3) issues.push(`nut graf is paragraph ${nutIndex + 1}; it must be by paragraph 4`);

  // 2.6 Quote: optional by house decision, but when present it must be verified and placed by paragraph 6.
  const quotes = blocks.filter((b): b is StoryQuoteBlock => b.type === 'quote');
  for (const q of quotes) {
    if (!q.verified) issues.push(`quote from ${q.speaker || 'unnamed speaker'} is not verified against its source`);
    if (!q.speaker?.trim()) issues.push('quote has no named speaker');
    if (!q.footnote) issues.push(`quote from ${q.speaker} has no footnote`);
  }
  if (!quotes.length) warnings.push('no verified direct quote (allowed by house decision when none is available)');

  // 2.8 / 2.9 To be sure and what's next.
  if (!paras.some((p) => p.role === 'to_be_sure')) issues.push('no "to be sure" paragraph (role "to_be_sure")');
  if (!paras.some((p) => p.role === 'whats_next')) issues.push('no "what\'s next" paragraph (role "whats_next")');

  // 3. Paragraphs of 1–3 sentences; average sentence under 25 words; no hype words.
  const allSentences: string[] = [];
  for (const [i, p] of paras.entries()) {
    const ss = sentences(p.text);
    allSentences.push(...ss);
    if (ss.length > 3) issues.push(`paragraph ${i + 1} has ${ss.length} sentences; the maximum is 3`);
  }
  const avg = allSentences.length ? allSentences.reduce((n, s) => n + words(s), 0) / allSentences.length : 0;
  if (avg >= 25) issues.push(`average sentence is ${avg.toFixed(1)} words; it must be under 25`);
  const hypeText = [story.title, story.hook, ...paras.map((p) => p.text)].join(' ');
  const hype = hypeText.match(HYPE);
  if (hype) issues.push(`hype word "${hype[0]}"`);

  // 4. Graphics: anatomy and a timeline when there are 3+ dated events.
  for (const c of charts) {
    const name = c.title ?? c.kind;
    if (!c.title?.trim()) issues.push('a chart has no takeaway headline');
    if (!c.subtitle?.trim()) issues.push(`chart "${name}" has no subtitle (units, timeframe)`);
    if (!c.alt?.trim()) issues.push(`chart "${name}" has no alt text`);
    if (!c.footnote) issues.push(`chart "${name}" has no footnote for its source line`);
  }
  const dated = new Set(
    paras.flatMap((p) => p.text.match(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b|\b(?:19|20)\d{2}-Q\d\b|\b[A-Z]\w+ quarter(?: of)? (?:19|20)\d{2}\b/gi) ?? [])
      .map((d) => d.toLowerCase()),
  );
  if (dated.size >= 3 && !blocks.some((b) => b.type === 'timeline')) {
    issues.push(`story cites ${dated.size} dated events; it needs a timeline`);
  }

  // 5. Footnotes: every figure in the body carries a marker; markers resolve; no orphans.
  const notes = new Set((story.evidence?.footnotes ?? []).map((f) => f.n));
  if (!notes.size) issues.push('no Sources section (evidence.footnotes is empty)');
  const markerTexts = [
    ...paras.map((p) => p.text),
    ...blocks.flatMap((b) => (b.type === 'layers' ? b.items : [])),
    story.hook,
  ];
  const used = new Set<number>([
    ...markerTexts.flatMap(cited),
    ...charts.map((c) => c.footnote ?? 0),
    ...quotes.map((q) => q.footnote ?? 0),
    ...blocks.flatMap((b) => (b.type === 'timeline' ? b.events.map((e) => e.footnote ?? 0) : [])),
    story.one_number?.footnote ?? 0,
  ].filter(Boolean));
  for (const n of used) if (!notes.has(n)) issues.push(`footnote [^${n}] is cited but missing from Sources`);
  for (const n of notes) if (!used.has(n)) warnings.push(`footnote ${n} is never cited`);
  const unsourced = [
    ...paras.flatMap((p) => unsourcedFigures(p.text)),
    ...blocks.flatMap((b) => (b.type === 'layers' ? b.items.flatMap(unsourcedFigures) : [])),
  ];
  for (const s of unsourced.slice(0, 6)) issues.push(`figure without a footnote marker: "${s}…"`);
  if (unsourced.length > 6) issues.push(`${unsourced.length - 6} more sentences with figures lack footnote markers`);

  return { ok: issues.length === 0, issues, warnings };
}

// ---------- quote verification ----------

const normalise = (t: string) => t
  .toLowerCase()
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z#0-9]+;/gi, ' ')
  .replace(/[‘’`´]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/[^a-z0-9%$.,'\- ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Keep only quotes found word for word on their source page; drop the rest
 * (house decision: a story publishes without a quote rather than with an
 * unverifiable one). Returns the blocks and a note per dropped quote.
 */
export async function verifyQuotes(blocks: StoryBlock[]): Promise<{ blocks: StoryBlock[]; dropped: string[] }> {
  const out: StoryBlock[] = [];
  const dropped: string[] = [];
  const pages = new Map<string, string | null>();
  for (const b of blocks) {
    if (b.type !== 'quote') { out.push(b); continue; }
    const url = b.source_url?.trim();
    const quote = normalise(b.text ?? '');
    if (!url || !/^https?:\/\//.test(url) || quote.split(' ').length < 4) {
      dropped.push(`quote from ${b.speaker || 'unnamed'} has no usable source URL or is too short to verify`);
      continue;
    }
    if (!pages.has(url)) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; caveat-factcheck/0.1)' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
        pages.set(url, res.ok ? normalise(await res.text()) : null);
      } catch {
        pages.set(url, null);
      }
    }
    const page = pages.get(url);
    if (page && page.includes(quote)) out.push({ ...b, verified: true });
    else dropped.push(`quote from ${b.speaker} not found word for word at ${url}${page === null ? ' (page unavailable)' : ''}`);
  }
  return { blocks: out, dropped };
}
