import { numbersIn } from '../../agent/scripts/lib/figures.mjs';
import { ATTRIBUTION } from '@/lib/style-check';
import { ECONOMY_SECTION_IDS, IX } from '@/lib/indices-paths';
import { SECTIONS, indicatorsOf } from '@/content/dashboard/economy';
import type { CheckableStory } from '@/lib/fact-check';
import type { Footnote, StoryBlock } from '@/lib/story-types';

/**
 * Australia Inc.: the pure parts (shapes, rules, the fail-closed decision), shared by the pipeline
 * (lib/australia-inc-pipeline.ts), the page (app/australia-inc) and australia-inc.check.ts.
 *
 * The Bottom Line is a brief, not a story: the house story rules (headline and deck lengths, nut graf, to be sure)
 * do not apply. What does: no em dashes, Australian English, every figure either checked against stored data or
 * attributed to the official body that announced it (and found in its document), and links that resolve.
 */

export type LinkKind = 'chart' | 'story' | 'external' | 'source';
export type IncLink = { label: string; url: string; kind: LinkKind };
export type Verdict = 'agrees' | 'disagrees' | 'partly' | 'too early' | 'unclear' | 'no series';
export type IncClaim = {
  text: string; metric_id: string | null; verdict: Verdict; note?: string | null;
  /** The official series the source scout could look for when none is stored (lib/claim-requests.mjs). */
  needs?: { series: string; org: string; why: string; tier: number } | null;
};
export type IncKind = 'announcement' | 'news' | 'release';

export type IncItem = {
  id: string; title: string; url: string; publisher: string | null; published_at: string | null;
  kind: IncKind; summary: string | null; claims: IncClaim[]; links: IncLink[]; status: string;
};

export type BottomLineParagraph = { text: string; links: IncLink[] };
export type BottomLineCheck = {
  ok: boolean; audited: boolean; issues: string[]; warnings: string[];
  claims?: Array<{ claim: string; verdict: string; evidence: string }>; checked_at?: string;
};
export type BottomLine = {
  id: string; day: string; status: 'draft' | 'held' | 'published'; headline: string | null;
  paragraphs: BottomLineParagraph[]; items: Array<{ id?: string; title: string; url: string; publisher: string | null }>;
  check: BottomLineCheck; published_at: string | null;
};

/** What the writer returns: sentences, each tied to the source it reports (1-based) or to none (stored data). */
export type DraftSentence = { text: string; source: number | null };
export type DraftParagraph = { sentences: DraftSentence[]; links: IncLink[] };
export type BottomLineDraft = { headline: string; paragraphs: DraftParagraph[] };

/** A source the writer may cite: an announcement or news item, numbered from 1. */
export type SourceRef = { n: number; title: string; url: string; publisher: string; official: boolean };

export const VERDICTS: Verdict[] = ['agrees', 'disagrees', 'partly', 'too early', 'unclear', 'no series'];
const KINDS: LinkKind[] = ['chart', 'story', 'external', 'source'];

/** What touches the nation's bottom line: general news matching these joins the government feeds as candidates. */
export const BOTTOM_LINE_TOPICS = [
  'budget', 'tax', 'spending', 'debt', 'deficit', 'surplus', 'productivity', 'housing', 'home prices', 'rent',
  'energy price', 'electricity price', 'power bill', 'gas price', 'wages', 'wage', 'migration', 'immigration',
  'interest rate', 'cash rate', 'inflation', 'cpi', 'trade deal', 'trade war', 'trade deficit', 'trade surplus', 'terms of trade', 'tariff', 'export', 'regulation', 'treasurer',
  'treasury', 'myefo', 'pbo', 'gdp', 'unemployment', 'superannuation',
];

export function matchesTopics(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  return BOTTOM_LINE_TOPICS.some((k) => new RegExp(`\\b${k.replace(/ /g, '\\s+')}`, 'i').test(t));
}

/** Australian government and official bodies: their pages can be read and checked by the source check. */
export function isOfficialUrl(url: string): boolean {
  try { return new URL(url).hostname.toLowerCase().endsWith('.gov.au'); } catch { return false; }
}

const EM_DASH = /—/;
/** American spellings the house never uses ("Labor" is the party's name and is left alone). */
const US_SPELLING = /\b(?:analyz\w*|organiz\w*|realiz\w*|recogniz\w*|prioritiz\w*|stabiliz\w*|emphasiz\w*|minimiz\w*|maximiz\w*|criticiz\w*|characteriz\w*|utiliz\w*|center(?:s|ed)?|favor(?:s|ed|able)?|behavior\w*|colors?|defense|percent|modeling|traveling|fulfill|catalog)\b/i;
/** Our own pipeline's vocabulary must never reach readers. */
const INTERNAL = /\b(stored data|reference data|metric[_ ]ids?\b|the store\b|claim audit|fact[- ]check(?:er|ed)? (?:passed|held)|source item|\[\^\d+\])/i;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
export const sentenceText = (p: DraftParagraph) => p.sentences.map((s) => s.text.trim()).filter(Boolean).join(' ');

/** Coerce the model's reply to the draft shape, dropping anything malformed. */
export function normaliseDraft(raw: unknown): BottomLineDraft {
  const r = (raw ?? {}) as { headline?: unknown; paragraphs?: unknown };
  const paragraphs = (Array.isArray(r.paragraphs) ? r.paragraphs : []).map((p): DraftParagraph => {
    const q = (p ?? {}) as { sentences?: unknown; links?: unknown };
    const sentences = (Array.isArray(q.sentences) ? q.sentences : []).map((s): DraftSentence | null => {
      const x = (s ?? {}) as { text?: unknown; source?: unknown };
      if (typeof x.text !== 'string' || !x.text.trim()) return null;
      const n = Number(x.source);
      return { text: x.text.trim(), source: x.source == null || !Number.isInteger(n) || n < 1 ? null : n };
    }).filter((s): s is DraftSentence => s !== null);
    return { sentences, links: normaliseLinks(q.links) };
  }).filter((p) => p.sentences.length);
  return { headline: typeof r.headline === 'string' ? r.headline.trim() : '', paragraphs };
}

export function normaliseLinks(raw: unknown): IncLink[] {
  return (Array.isArray(raw) ? raw : []).map((l) => (l ?? {}) as Partial<IncLink>)
    .filter((l) => typeof l.label === 'string' && l.label.trim() && typeof l.url === 'string' && /^(https?:\/\/|\/)/.test(l.url))
    .map((l) => ({ label: l.label!.trim(), url: l.url!.trim(), kind: KINDS.includes(l.kind as LinkKind) ? l.kind as LinkKind : (l.url!.startsWith('/') ? 'chart' : 'external') }));
}

/** True when a sentence names its source: a reporting verb, or the publisher by name. */
function attributed(text: string, source?: SourceRef) {
  if (ATTRIBUTION.test(text)) return true;
  if (!source) return false;
  const name = source.publisher.toLowerCase();
  return name.length > 3 && text.toLowerCase().includes(name);
}

/** The brief's own rules (MUST items are issues; the rest warnings). Runs before the data and source checks. */
export function validateDraft(draft: BottomLineDraft, sources: SourceRef[]): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];
  const byN = new Map(sources.map((s) => [s.n, s]));
  if (!draft.headline) issues.push('no headline');
  else if (words(draft.headline) > 16) warnings.push(`headline is ${words(draft.headline)} words; keep it short`);
  if (draft.paragraphs.length < 3 || draft.paragraphs.length > 5) issues.push(`${draft.paragraphs.length} paragraphs; the brief has 3 to 5`);
  const total = draft.paragraphs.reduce((n, p) => n + words(sentenceText(p)), 0);
  if (total < 120 || total > 320) issues.push(`${total} words; the brief must run 120 to 320 (aim for 180 to 250)`);
  else if (total < 180 || total > 260) warnings.push(`${total} words; aim for 180 to 250`);

  const texts: Array<[string, string]> = [['headline', draft.headline]];
  draft.paragraphs.forEach((p, i) => {
    p.sentences.forEach((s, k) => texts.push([`paragraph ${i + 1} sentence ${k + 1}`, s.text]));
    p.links.forEach((l) => texts.push([`paragraph ${i + 1} link`, l.label]));
  });
  for (const [where, t] of texts) {
    if (EM_DASH.test(t)) issues.push(`${where}: em dash; rewrite without it`);
    const us = US_SPELLING.exec(t);
    if (us) issues.push(`${where}: "${us[0]}" is not Australian English`);
    const internal = INTERNAL.exec(t);
    if (internal) issues.push(`${where}: internal wording ("${internal[0]}")`);
  }

  for (const [i, p] of draft.paragraphs.entries()) {
    for (const [k, s] of p.sentences.entries()) {
      const where = `paragraph ${i + 1} sentence ${k + 1}`;
      const src = s.source == null ? undefined : byN.get(s.source);
      if (s.source != null && !src) { issues.push(`${where}: cites source ${s.source}, which is not in the list`); continue; }
      const figures = numbersIn(s.text);
      if (!figures.length) continue;
      if (src && !src.official) issues.push(`${where}: a figure from a news report (${src.publisher}); figures come from stored data or an official announcement`);
      else if (src && !attributed(s.text, src)) issues.push(`${where}: the figure is from ${src.publisher}; attribute it ("${src.publisher} said…")`);
    }
  }

  // House rule (CPI reporting): headline and trimmed mean together, with the RBA guard.
  const all = draft.paragraphs.flatMap((p) => p.sentences.map((s) => s.text));
  const pct = /\d(?:\.\d+)?\s*(?:%|per cent)/i;
  if (all.some((x) => /\b(?:inflation|CPI|consumer price)/i.test(x) && pct.test(x))) {
    const trimmed = all.filter((x) => /trimmed[- ]mean/i.test(x));
    if (!trimmed.some((x) => pct.test(x))) issues.push('an inflation figure without the trimmed mean figure; report headline CPI and trimmed mean together');
    if (!trimmed.some((x) => /\bRBA\b|Reserve Bank/i.test(x))) issues.push("inflation figures need the guard that the trimmed mean is the RBA's preferred measure of underlying inflation");
  }

  for (const [i, p] of draft.paragraphs.entries()) {
    if (!p.links.length) warnings.push(`paragraph ${i + 1} has no links`);
  }
  return { issues, warnings };
}

/** Issues from the claim audit and the source check, which quote the text they reject. */
const QUOTED = /^(claim not supported by stored data|source): "([^"]{8,})"/;

/**
 * The sentence ("<paragraph>:<sentence>", zero-based) a quoted claim comes from: the one containing the quote, or,
 * since the audit sometimes paraphrases, the one sharing most of the quote's content words (at least two thirds of
 * them, and clearly ahead of the next best). Null when it cannot be told, or when the quote is in the headline (a
 * headline cannot be cut), so the brief is held rather than guessed at.
 */
export function locateSentence(draft: BottomLineDraft, quote: string): string | null {
  const norm = (t: string) => wordsOf(t).join(' ');
  const q = norm(quote.replace(/\[[^\]]*\]/g, ' ').replace(/(?:\.\.\.|…)/g, ' '));
  if (!q) return null;
  const qWords = [...new Set(q.split(' ').filter((w) => !STOP.has(w)))];
  if (draft.headline && norm(draft.headline).includes(q)) return null;
  let best: { at: string; score: number } | null = null;
  let second = 0;
  draft.paragraphs.forEach((p, i) => p.sentences.forEach((s, k) => {
    const t = norm(s.text);
    const score = t.includes(q) || (q.length > 30 && q.includes(t)) ? 1
      : qWords.length ? qWords.filter((w) => t.split(' ').includes(w)).length / qWords.length : 0;
    if (!best || score > best.score) { second = best?.score ?? 0; best = { at: `${i}:${k}`, score }; }
    else if (score > second) second = score;
  }));
  if (!best || (best as { score: number }).score < 2 / 3 || (best as { score: number }).score - second < 0.2) return null;
  return (best as { at: string }).at;
}

/** The sentence-level breaches a sentence can simply be cut for: a news figure, an unattributed figure, internal wording. */
const DROPPABLE = /^paragraph (\d+) sentence (\d+): (?:a figure from a news report|the figure is from|internal wording)/;

/**
 * After the revision rounds, a brief held only for sentences that break the figures or wording rules loses those
 * sentences rather than the whole day: cutting a sentence cannot add a claim the checks have not seen. Returns null
 * when any issue is of another kind (an unsupported claim, a failed source check), so those still hold the brief.
 * Links whose words were in a cut sentence go with it.
 */
export function dropFlaggedSentences(
  draft: BottomLineDraft, links: IncLink[][], issues: string[],
): { draft: BottomLineDraft; links: IncLink[][]; dropped: string[] } | null {
  if (!issues.length) return null;
  const cut = new Set<string>();
  for (const i of issues) {
    const m = DROPPABLE.exec(i);
    if (m) { cut.add(`${Number(m[1]) - 1}:${Number(m[2]) - 1}`); continue; }
    // The claim audit and the source check quote the text instead of naming the sentence: find it.
    const quoted = QUOTED.exec(i);
    const at = quoted ? locateSentence(draft, quoted[2]) : null;
    if (!at) return null;
    cut.add(at);
  }
  const dropped: string[] = [];
  const kept: Array<{ p: DraftParagraph; links: IncLink[] }> = [];
  draft.paragraphs.forEach((p, i) => {
    const sentences = p.sentences.filter((s, k) => {
      if (!cut.has(`${i}:${k}`)) return true;
      dropped.push(s.text);
      return false;
    });
    if (!sentences.length) return;
    const text = sentences.map((s) => s.text).join(' ');
    kept.push({ p: { sentences, links: p.links.filter((l) => text.includes(l.label)) }, links: (links[i] ?? []).filter((l) => text.includes(l.label)) });
  });
  return { draft: { ...draft, paragraphs: kept.map((k) => k.p) }, links: kept.map((k) => k.links), dropped };
}

/** A sentence whose figures belong to an official document (checked against that document, not the store). */
export function isSourcedSentence(s: DraftSentence, sources: SourceRef[]): boolean {
  const src = s.source == null ? undefined : sources.find((x) => x.n === s.source);
  return Boolean(src?.official && attributed(s.text, src));
}

/**
 * The Bottom Line in the shape the publish gate's checks read (lib/fact-check.ts, lib/claim-audit.ts,
 * lib/source-check.ts). Sentences that report an official announcement carry a footnote to its page, so the claim
 * audit leaves them to the source check. With `dataOnly`, those sentences are left out (the figure check then sees
 * only the sentences whose figures must come from stored data).
 */
export function toCheckable(draft: BottomLineDraft, sources: SourceRef[], opts: { dataOnly?: boolean } = {}): CheckableStory {
  const used = new Map<number, Footnote>();
  const blocks: StoryBlock[] = draft.paragraphs.map((p) => ({
    type: 'paragraph' as const,
    text: p.sentences.flatMap((s) => {
      const src = s.source == null ? undefined : sources.find((x) => x.n === s.source);
      if (!src?.official) return [s.text];
      if (opts.dataOnly && isSourcedSentence(s, sources)) return [];
      used.set(src.n, { n: src.n, text: `${src.publisher}, ${src.title}`, url: src.url });
      return [`${s.text}[^${src.n}]`];
    }).join(' '),
  })).filter((b) => b.text.trim());
  return {
    kicker: 'The Bottom Line', title: draft.headline, hook: '', caveat: '',
    body: { blocks }, evidence: { sources: [], footnotes: [...used.values()].sort((a, b) => a.n - b.n) },
  };
}

/** Figures in the data-only text: none means there is nothing for the stored-data checks to check. */
export function dataFigures(draft: BottomLineDraft, sources: SourceRef[]): number[] {
  const story = toCheckable(draft, sources, { dataOnly: true });
  return [story.title, ...story.body.blocks.map((b) => ('text' in b ? b.text : ''))].flatMap((t) => numbersIn(t));
}

/** Figures in a sourced sentence that its document does not contain (signs and rounding as the figure check). */
export function figuresMissingFrom(sentence: string, documentText: string): number[] {
  const doc = numbersIn(documentText);
  const near = (a: number, n: number) => Math.abs(a - n) < 0.051 || Math.round(a) === n;
  const scaled = doc.flatMap((n) => [n, n / 1e3, n / 1e6, n / 1e9]);
  return numbersIn(sentence).filter((n) => !scaled.some((a) => near(a, n)));
}

// ---------------------------------------------------------------------------------------------------- links

export type KnownPaths = { stories: Set<string> };

/** Each stored series on the economy dashboard, with the page that charts it (/indices/economy/<section>/<key>). */
export const CHART_PATHS: Map<string, { path: string; label: string }> = new Map(
  SECTIONS.flatMap((s) => indicatorsOf(s).filter((i) => !i.minus).map((i) => [i.metric_id, { path: `${IX.economy}/${s.id}/${i.key}`, label: i.short ?? i.label }] as const)),
);

/** The Caveat page that charts a stored series, if one does. */
export const chartPathFor = (metricId: string | null | undefined) => (metricId ? CHART_PATHS.get(metricId) ?? null : null);

const FIXED_PATHS = new Set<string>([IX.home, IX.economy, IX.qol, IX.sentiment, IX.polls, IX.population, IX.pnl, IX.visuals, '/australia-inc',
  ...ECONOMY_SECTION_IDS.map((s) => `${IX.economy}/${s}`), ...[...CHART_PATHS.values()].map((c) => c.path)]);

/** Caveat pages a Bottom Line may link to: the indices and their charts, a published story or its evidence. */
export function internalPathOk(path: string, known: KnownPaths): boolean {
  const p = path.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  if (FIXED_PATHS.has(p)) return true;
  const s = /^\/(?:stories|evidence)\/([^/]+)$/.exec(p);
  if (s) return known.stories.has(decodeURIComponent(s[1]));
  return false;
}

/** The internal pages the writer may choose from, for its prompt. */
export const linkablePaths = () => [...FIXED_PATHS];

/** Keep the links that resolve: internal paths against the known pages, external ones by their HTTP check. */
export function filterLinks(links: IncLink[], known: KnownPaths, external: Map<string, boolean>): { kept: IncLink[]; dropped: IncLink[] } {
  const kept: IncLink[] = [];
  const dropped: IncLink[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    const ok = l.url.startsWith('/') ? internalPathOk(l.url, known) : external.get(l.url) === true;
    (ok ? kept : dropped).push(l);
  }
  return { kept, dropped };
}

/** A paragraph's text with its links: a link whose label appears in the text becomes an inline anchor; the rest follow. */
export function linkify(text: string, links: IncLink[]): { parts: Array<{ text: string; link?: IncLink }>; extra: IncLink[] } {
  const spans: Array<{ start: number; end: number; link: IncLink }> = [];
  const extra: IncLink[] = [];
  for (const l of links) {
    const at = text.indexOf(l.label);
    const clash = at < 0 || spans.some((s) => at < s.end && at + l.label.length > s.start);
    if (clash) extra.push(l);
    else spans.push({ start: at, end: at + l.label.length, link: l });
  }
  spans.sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; link?: IncLink }> = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) parts.push({ text: text.slice(pos, s.start) });
    parts.push({ text: text.slice(s.start, s.end), link: s.link });
    pos = s.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return { parts, extra };
}

/** "Friday 16 October 2026" for a Sydney day (YYYY-MM-DD). */
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------------------------------------------------------------------------------------------------- the decision

/**
 * Fail closed: published only when the strict part ran in full (claim audit and source check, with an API key) and
 * nothing at all was flagged. Anything else is held for the newsdesk.
 */
export function decide(check: { issues: string[]; audited: boolean }): { ok: boolean; status: 'published' | 'held' } {
  const ok = check.audited === true && Array.isArray(check.issues) && check.issues.length === 0;
  return { ok, status: ok ? 'published' : 'held' };
}

/** Never replace a live Bottom Line with one that failed: a failed re-run leaves the published one in place. */
export function shouldWrite(existing: { status: string } | null, next: { status: 'published' | 'held' }): boolean {
  return !(existing?.status === 'published' && next.status !== 'published');
}

/** An item summary is published only if it names its source and its figures appear in the source's own text. */
export function itemIssues(summary: string, publisher: string, sourceText: string): string[] {
  const out: string[] = [];
  if (!summary.trim()) out.push('no summary');
  if (EM_DASH.test(summary)) out.push('em dash');
  const us = US_SPELLING.exec(summary);
  if (us) out.push(`"${us[0]}" is not Australian English`);
  if (!attributed(summary, { n: 0, title: '', url: '', publisher, official: true })) out.push('summary is not attributed');
  const missing = figuresMissingFrom(summary, sourceText);
  if (missing.length) out.push(`figures not in the source: ${missing.join(', ')}`);
  return out;
}

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'is', 'as']);
const wordsOf = (t: string) => t.toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * The link on an official listing page that is this item: the anchor whose text is the title, or whose last path
 * segment is the title's opening words (some sites shorten addresses and drop small words). Feeds from
 * ministers.treasury.gov.au carry addresses the site no longer answers (capitals, full titles), so the item is found on
 * the page that lists it instead.
 */
export function findListedLink(html: string, title: string, base: string): string | null {
  const want = wordsOf(title);
  const wantKey = want.join(' ');
  const content = want.filter((w) => !STOP.has(w));
  let best: { href: string; score: number } | null = null;
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const text = wordsOf(m[2].replace(/<[^>]+>/g, ' ')).join(' ');
    const slug = wordsOf(decodeURIComponent(href.split('?')[0].replace(/\/$/, '').split('/').pop() ?? ''));
    let score = 0;
    if (text && text === wantKey) score = 3;
    else if (slug.length >= 3 && slug.every((w) => content.includes(w) || want.includes(w))
      && slug.filter((w) => !STOP.has(w)).join(' ') === content.slice(0, slug.filter((w) => !STOP.has(w)).length).join(' ')) score = 2;
    if (score && (!best || score > best.score)) best = { href, score };
  }
  if (!best) return null;
  try { return new URL(best.href, base).toString(); } catch { return null; }
}

