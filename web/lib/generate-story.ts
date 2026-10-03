import { mergeDuplicateFootnotes } from '@/lib/footnotes';
import { sydneyDay } from '@/lib/dates';
import { createClient } from '@/lib/supabase-server';
import { runFoundryTurn, type FoundryEvent } from '@/lib/foundry-agent';
import { CHARTER, MODEL } from '@/lib/research-agent';
import { articleFromApprovedPitch, type StructuredStory } from '@/lib/article-from-pitch';
import { bindOneNumber, bindStoryCharts } from '@/lib/chart-from-data';
import { checkStyle, splitLongParagraphs, verifyQuotes } from '@/lib/style-check';
import { factCheckStory, type FactCheck } from '@/lib/fact-check';
import { auditClaims, reviseForChecks } from '@/lib/claim-audit';
import { latestOfficialDocuments, verifySourcedStatements } from '@/lib/source-check';
import { eventsContext } from '@/lib/events';
import { canonicalMetricId, loadKnownMetrics, normaliseMetricIds } from '../../agent/scripts/lib/metric-ids.mjs';
import type { StoryChartBlock } from '@/lib/story-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type PublishResult = {
  slug: string;
  title: string;
  storyUrl: string;
  previewUrl: string;
  status: 'draft' | 'published';
  generation_note: string;
  /** Publish gate: every figure traces to stored data and every chart was built from it. */
  check: FactCheck;
};

export type GoLiveResult = {
  slug: string;
  title: string;
  storyUrl: string;
  status: 'published';
};

/** Revision rounds a held article gets before it is left for the editor. */
const MAX_REVISIONS = 2;

const PUBLISH_SYSTEM = `${CHARTER}

You are writing a PUBLISHABLE Caveat story from an approved pitch brief. This is not a pitch
anymore — it is the finished article readers will see on the home page.

Use tools aggressively before writing:
- query_data — AUS latest + OECD peer context for every linked metric
- search_metrics — find complementary tier 1/2 series
- lookup_sources — official release metadata
- web_search / fetch_url — only for tier 1/2 pages when our store is stale

Follow EDITORIAL story structure:
1. Open with the familiar frame (what the reader thinks they know).
2. Add data in layers — each layer shifts the picture. The sequence IS the story.
3. Close on the corrected frame and the one number that carries it.

Voice: Australian English. No em dashes. Headlines state the finding, not the topic.
Every number must trace to tier 1/2 sources in the evidence table.`;

/** A document from agent/ (EDITORIAL.md, NEWS-STYLE.md), wherever the app runs from. */
function loadAgentDoc(file: string) {
  for (const p of [
    path.join(process.cwd(), '..', 'agent', file),
    path.join(process.cwd(), 'agent', file),
    path.join(process.cwd(), '.agent', file),
  ]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '';
}

const loadEditorialCharter = () => loadAgentDoc('EDITORIAL.md');
/** The house news style (WSJ/AFR structure); every article follows it. */
export const loadNewsStyle = () => loadAgentDoc('NEWS-STYLE.md');

export { articleFromApprovedPitch };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/-$/, '');
}

async function uniqueSlug(base: string): Promise<string> {
  const supabase = createClient();
  let slug = slugify(base) || 'story';
  let n = 0;
  while (true) {
    const candidate = n ? `${slug}-${n}` : slug;
    const { data } = await supabase.from('stories').select('slug').eq('slug', candidate).maybeSingle();
    if (!data?.slug) return candidate;
    n += 1;
  }
}

function buildResearchPrompt(pitch: Record<string, unknown>, metrics: unknown[], charter: string) {
  return `${PUBLISH_SYSTEM}

<editorial_charter>
${charter.slice(0, 8000)}
</editorial_charter>

<approved_pitch>
${JSON.stringify({
  headline: pitch.headline,
  hook: pitch.hook,
  mechanism: pitch.mechanism,
  caveat: pitch.caveat,
  chart_hint: pitch.chart_hint,
  metric_ids: pitch.metric_ids,
  trigger_rows: pitch.trigger_rows,
  score: pitch.score,
}, null, 2)}
</approved_pitch>

<linked_metrics>
${JSON.stringify(metrics, null, 2)}
</linked_metrics>

Research task:
0. Find direct quotes from named principals (RBA statements, ministers' releases, company filings,
   official speeches) that bear on the story. Use fetch_url on the primary page and copy each quote
   VERBATIM with the speaker, their title, where and when it was said, and the exact URL. Never
   paraphrase inside quotation marks. Also list the dated events (date and what happened) the story
   relies on.
1. Verify every claim against tier 1/2 data. Pull exact numbers with periods and sources.
2. Build the evidence table rows the story rests on.
3. Draft the layered narrative prose (opening frame → shifts → corrected frame).
4. Identify the one number that carries the story.

5. Design a chart from the evidence that matches chart_hint when possible
   (rank_swap for denominator flips, timeline for sequences, bars otherwise).

6. If you find a scheduled release, decision or recurring report that will move this story's numbers (a date
   the data updates, a decision due, a weekly industry report), put it on the watch list with add_watch_item.

7. If the story touches prices or inflation, use cpi_components to see what drove the CPI (groups, then the
   items under them: electricity, rents, insurance …), and read any component you will quote with query_data
   on its cpi: id. Report headline CPI and the trimmed mean together, with the guard that the trimmed mean is the
   RBA's preferred measure of underlying inflation.

Write up findings in prose with explicit source citations. Be specific with numbers.`;
}

async function structureStory(
  pitch: Record<string, unknown>,
  researchText: string,
  metrics: Array<{ metric_id: string; name?: string; unit?: string | null }>,
  catalogue: Array<{ metric_id: string; name?: string; unit?: string | null }>,
): Promise<StructuredStory> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const line = (m: { metric_id: string; name?: string; unit?: string | null }) =>
    `- ${m.metric_id}: ${m.name ?? ''}${m.unit ? ` (${m.unit})` : ''}`;
  const linkedIds = new Set(metrics.map((m) => m.metric_id));
  const available = [
    ...metrics.map(line),
    ...(catalogue.some((m) => !linkedIds.has(m.metric_id)) ? ['Other stored metrics:'] : []),
    ...catalogue.filter((m) => !linkedIds.has(m.metric_id)).map(line),
    'CPI components: any cpi:<index_code>:<measure>[:q][:sa] id the research read (e.g. cpi:999902:annual is the monthly trimmed mean); usable in metric_ids_used, charts and one_number like a stored metric.',
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: 'Convert research into a publishable Caveat news article. Respond ONLY with valid JSON.',
      messages: [{
        role: 'user',
        content: `Approved pitch brief:
${JSON.stringify({
  headline: pitch.headline,
  hook: pitch.hook,
  mechanism: pitch.mechanism,
  caveat: pitch.caveat,
  chart_hint: pitch.chart_hint,
  metric_ids: pitch.metric_ids,
})}

Stored metrics you can chart and quote (metric_id: name). Linked to this pitch first, then everything else in the store. Use these exact ids:
${available || '(none linked; use search_metrics findings from the research notes)'}

Research notes:
${researchText.slice(0, 12000)}

<house_news_style>
${loadNewsStyle()}
</house_news_style>

Write the article to the house news style above: every MUST rule applies. Return JSON matching this schema exactly:
{
  "kicker": "Topic · short section label",
  "title": "HEADLINE: 6-12 words, a claim in active voice and present tense, strong verb, a number or named actor; no question, no colon",
  "hook": "DECK: 20-35 words, the so-what or second-most-important fact; headline + deck must tell the whole story; footnote markers like [^2] after figures",
  "caveat": "the sceptic's strongest objection in one sentence (also shown in the Caveat box)",
  "one_number": { "value": "the headline number", "label": "what it measures, with period", "metric_id": "stored metric_id behind the number (value and year-on-year comparison are filled from the store)", "footnote": 1 },
  "evidence": {
    "table": { "head": ["col1", ...], "rows": [["cell", ...], ...] } or omit,
    "sources": [{ "metric": "...", "org": "...", "tier": 1|2, "url": "https://...", "period": "...", "basis": "..." }],
    "footnotes": [{ "n": 1, "text": "Organisation, Title or dataset, date, page/section", "url": "https://..." }]
  },
  "body": {
    "blocks": [
      { "type": "paragraph", "role": "lede", "text": "..." },
      { "type": "paragraph", "role": "nut", "text": "..." },
      { "type": "paragraph", "role": "evidence", "text": "...[^1]" },
      { "type": "chart", "kind": "line|bars|rank_swap", "title": "takeaway headline", "subtitle": "what is measured, units, timeframe", "alt": "the takeaway for screen readers", "footnote": 1,
        "data": { "metric_id": "a stored metric_id", "mode": "timeline|latest_by_entity", "entities": ["AUS","NZL"], "entity": "AUS", "last": 12, "alt_metric_id": "rank_swap only" } },
      { "type": "quote", "text": "verbatim words", "speaker": "Full Name", "title": "Title, Organisation", "said": "where and when", "source_url": "https://exact page", "footnote": 3 },
      { "type": "paragraph", "role": "evidence", "text": "..." },
      { "type": "paragraph", "role": "context", "text": "..." },
      { "type": "timeline", "title": "takeaway headline", "events": [{ "date": "29 September 2026", "label": "what happened", "footnote": 4 }] },
      { "type": "paragraph", "role": "to_be_sure", "text": "..." },
      { "type": "paragraph", "role": "whats_next", "text": "..." },
      { "type": "paragraph", "role": "kicker", "text": "..." }
    ]
  },
  "metric_ids_used": ["every stored metric_id whose values the copy quotes"],
  "slug_hint": "3-5 word slug",
  "generation_note": "one line on what the story does",
  "frame_check": true if this corrects a widely shared frame, else false
}

Rules (in addition to the house style):
- Block order follows the skeleton: lede, nut graf by paragraph 4, evidence ordered strongest first with a chart
  right after the paragraph it supports, quote (if any) by paragraph 6, context, timeline if 3+ dated events,
  to be sure, what's next, kicker. Every paragraph has a role. Paragraphs of 1-3 sentences; average sentence
  under 25 words; spell out one to nine; A$ on first mention of dollars; "said" for attribution; no hype words.
- One chart per major data point (most stories need 2-3). Each chart: takeaway title, subtitle, alt, footnote,
  and "data" with a stored metric_id; leave out "series" (values are filled from the store). Use "line" for
  change over time, "bars" for comparisons. Never two charts in a row without a paragraph between.
- Footnotes: put [^n] after every figure and after every attributed fact; every chart, quote and timeline event
  carries a footnote number; evidence.footnotes lists each n once, primary sources first (official data,
  filings, statements). Number footnotes in order of first appearance. Every footnote has the "url" of the exact
  page it came from. Anything stored data cannot show (what minutes, statements or speeches said; scheduled
  release or meeting dates; events) needs [^n] on its sentence pointing at that page; if you have no URL for
  it, leave the claim out. Cite figures to the statistical table or release they come from, and events (a
  rate decision, say) to the release that announced them. These statements are checked against the cited page's text, so say only what the
  page says. A footnote's text is a citation only (publisher, title, number, date), never a claim. Each timeline
  event cites the release for that event (that decision's own RBA media release, say), not a later document.
- Quotes: only text that appears word for word on source_url (from the research notes). It is checked; an
  unverifiable quote is removed. If the research found no such quote, include no quote block.
- Every number in the copy must be a stored value (or a change between stored periods, a gap to a peer, or a
  rank) for a metric in metric_ids_used. Do not quote figures that exist only in web search results: name the
  claim without its number instead. Unsupported numbers stop the article from publishing.
- All sources must be tier 1 or 2. Write the copy itself, never labels like "Lede:". No em dashes.
- Prefer frame_check true for Caveat's core archetypes.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (body.stop_reason === 'max_tokens') throw new Error('Article JSON was cut off at max_tokens');
  const raw = (body.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function loadMetricContext(metricIds: string[]) {
  if (!metricIds.length) return [];
  const supabase = createClient();
  const { data: metrics } = await supabase.from('metrics')
    .select('metric_id, name, unit, basis, source_org, source_tier, source_url, source_published, period')
    .in('metric_id', metricIds);
  const { data: obs } = await supabase.from('observations')
    .select('metric_id, entity, period, value, status')
    .in('metric_id', metricIds)
    .order('period', { ascending: false })
    .limit(200);
  return (metrics ?? []).map((m) => ({
    ...m,
    observations: (obs ?? []).filter((o) => o.metric_id === m.metric_id).slice(0, 20),
  }));
}

export type PublishOptions = {
  /**
   * Run the claim audit and revision rounds. Off by default: the Foundry's
   * "Approve and write" runs on Vercel with a 300s limit and an editor reviews
   * the draft anyway. The daily auto-articles job turns this on.
   */
  audit?: boolean;
};

type SupabaseClient = ReturnType<typeof createClient>;

const unlabel = (t: string) => t.replace(/^\s*(?:lede|nut graf|layer \d+|context|closing)\s*:\s*/i, '');

export type CheckContext = {
  /** Metrics the pitch links; the copy may quote them. */
  metricIds: string[];
  /** Metrics the research step read. */
  queried?: Set<string>;
  /** Run the claim audit (needs ANTHROPIC_API_KEY). */
  audit?: boolean;
  onEvent?: (event: FoundryEvent) => void;
};

/**
 * Every publishing check, without rewriting: normalise ids, drop unverifiable quotes, build charts and
 * the hero number from the store, check figures and house style, and audit claims. Mutates `draft`.
 */
export async function checkStory(supabase: SupabaseClient, draft: StructuredStory, ctx: CheckContext) {
  const known = await loadKnownMetrics(supabase);
  const canonical = (id?: string) => (id ? canonicalMetricId(id, known) : id);
  const onEvent = ctx.onEvent ?? (() => {});
  const metricIds = ctx.metricIds;
  const queried = ctx.queried ?? new Set<string>();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const opts = { audit: ctx.audit };
  // One source, one footnote (the writer sometimes cites the same page as two notes).
  mergeDuplicateFootnotes(draft as never);

  for (const b of draft.body?.blocks ?? []) {
    const c = b as StoryChartBlock;
    if (c.type === 'chart' && c.data) {
      c.data.metric_id = canonical(c.data.metric_id)!;
      if (c.data.alt_metric_id) c.data.alt_metric_id = canonical(c.data.alt_metric_id);
    }
  }
  draft.metric_ids_used = normaliseMetricIds(draft.metric_ids_used ?? [], known).linked;
  draft.body = {
    blocks: (draft.body?.blocks ?? []).map((b) =>
      b.type === 'layers' ? { ...b, items: b.items.map(unlabel) }
        : 'text' in b && typeof b.text === 'string' ? { ...b, text: unlabel(b.text) } : b),
  };
  // Quotes run only if found word for word on their source page; unverifiable ones are removed.
  const quotes = await verifyQuotes(draft.body.blocks);
  for (const d of quotes.dropped) onEvent({ type: 'tool_result', name: 'quotes', label: `Quote removed: ${d}`, at: new Date().toISOString() });
  const bound = await bindStoryCharts(supabase, splitLongParagraphs(quotes.blocks));
  draft.body = { blocks: bound.blocks };
  if (draft.one_number?.metric_id) draft.one_number.metric_id = canonical(draft.one_number.metric_id);
  const hero = await bindOneNumber(supabase, draft.one_number);
  if (hero.one) draft.one_number = hero.one;
  const ids = new Set(metricIds);
  if (draft.one_number?.metric_id && !hero.issue) ids.add(draft.one_number.metric_id);
  for (const id of draft.metric_ids_used ?? []) ids.add(id);
  for (const id of normaliseMetricIds([...queried], known).linked) ids.add(id);
  for (const id of bound.chartMetricIds) ids.add(id);
  const result = await factCheckStory(supabase, draft, [...ids]);
  result.issues.unshift(...bound.issues, ...(hero.issue ? [hero.issue] : []));
  // House news style (NEWS-STYLE.md): MUST items block; the rest are warnings for the editor.
  const style = checkStyle(draft);
  result.issues.push(...style.issues.map((i) => `style: ${i}`));
  result.warnings = [...(result.warnings ?? []), ...style.warnings];
  const figuresOk = result.ok && bound.issues.length === 0 && !hero.issue;
  result.ok = figuresOk && style.ok;

  // Figures exist in the data; now check each claim uses them truthfully. Runs even when only
  // style failed, so a held draft reaches the editor with its claims already audited.
  if (figuresOk && apiKey && opts.audit) {
    onEvent({ type: 'tool_start', name: 'audit', label: 'Auditing every claim against stored data', at: new Date().toISOString() });
    try {
      const audit = await auditClaims(supabase, draft, [...ids]);
      result.claims = audit.claims;
      for (const c of audit.unsupported) result.issues.push(`claim not supported by stored data: "${c.claim}" (${c.evidence})`);
      result.ok = result.ok && audit.ok;
    } catch (e) {
      result.ok = false;
      result.issues.push(`claim audit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // What sources said, published or scheduled: checked against the documents' stored text.
    onEvent({ type: 'tool_start', name: 'sources', label: 'Checking sourced statements against the source documents', at: new Date().toISOString() });
    try {
      const src = await verifySourcedStatements(supabase, draft);
      result.issues.push(...src.issues);
      if (src.issues.length) result.ok = false;
    } catch (e) {
      result.ok = false;
      result.issues.push(`source check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { check: result, ids };
}

/** A published article being refreshed: the writer keeps its finding unless newer data changes it. */
export type PriorArticle = {
  title: string; hook: string; published: string; text: string;
  /** The editor's instructions for this refresh (e.g. a correction that reverses the finding); they win. */
  brief?: string;
};

function priorArticleBrief(prior: PriorArticle) {
  return `

<published_article date="${prior.published}">
${prior.title}
${prior.hook}

${prior.text.slice(0, 8000)}
</published_article>

This is a refresh of the article above, published ${prior.published}. Rewrite it in the house news style with
the latest stored data. Keep its finding, and lead the headline with it, if the data still supports it; if newer
data changes the finding, the new copy says so plainly. Every footnote keeps a url to the exact page. Do not mention that the article was rewritten; the page carries an update note.${prior.brief ? `

<editor_brief>
${prior.brief}
</editor_brief>

Follow the editor's brief. Where it conflicts with the instructions above, the brief wins.` : ''}`;
}

/**
 * Revisions return the whole article and sometimes drop footnote and source links on the way. Put back any
 * link a revised footnote lost, from the previous version's footnote with the same number and citation (or
 * the same citation under a new number).
 */
export function keepSourceLinks(before: StructuredStory, after: StructuredStory): StructuredStory {
  const prior = before.evidence?.footnotes ?? [];
  const byText = new Map(prior.filter((f) => f.url).map((f) => [f.text.trim().toLowerCase(), f.url!]));
  const byN = new Map(prior.filter((f) => f.url).map((f) => [f.n, { url: f.url!, text: f.text.trim().toLowerCase() }]));
  for (const f of after.evidence?.footnotes ?? []) {
    if (f.url) continue;
    const text = f.text.trim().toLowerCase();
    const same = byN.get(f.n);
    f.url = byText.get(text) ?? (same && (same.text === text || text.startsWith(same.text.slice(0, 40))) ? same.url : undefined);
    if (!f.url) delete f.url;
  }
  const sources = new Map((before.evidence?.sources ?? []).filter((s) => s.url).map((s) => [`${s.org}|${s.metric}`, s.url]));
  for (const s of after.evidence?.sources ?? []) if (!s.url) s.url = sources.get(`${s.org}|${s.metric}`) ?? '';
  return after;
}

/** Research, write and check an article for a pitch, with revision rounds. Saves nothing. */
export async function draftStory(
  supabase: SupabaseClient,
  pitch: Record<string, unknown>,
  onEvent: (event: FoundryEvent) => void,
  opts: PublishOptions & { prior?: PriorArticle },
): Promise<{ story: StructuredStory; check: FactCheck; ids: Set<string> }> {
  onEvent({ type: 'tool_start', name: 'load', label: 'Loading pitch and metrics', at: new Date().toISOString() });

  const metricIds = [
    ...new Set([...((pitch.metric_ids as string[] | null) ?? []), ...((pitch.resurface_metrics as string[] | null) ?? [])]),
  ] as string[];
  const metrics = await loadMetricContext(metricIds);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  let story: StructuredStory;
  // Metrics the research step actually read; the copy may quote these.
  const queried = new Set<string>();

  if (!apiKey) {
    onEvent({
      type: 'tool_start',
      name: 'structure',
      label: 'Writing article from the approved brief',
      at: new Date().toISOString(),
    });
    story = articleFromApprovedPitch(pitch);
  } else {
    const charter = loadEditorialCharter();
    const official = await latestOfficialDocuments(supabase);
    // Decisions, releases and their factors for these series, with each one's own source (the events store).
    const events = await eventsContext(supabase, metricIds).catch(() => '');
    const researchPrompt = buildResearchPrompt(pitch, metrics, charter) + (opts.prior ? priorArticleBrief(opts.prior) : '')
      + (official ? `\n\n<official_documents>\n${official}\n</official_documents>\n\nThese are the latest RBA decision statement and minutes, stored as text. When the story reports what the RBA said, use these documents and cite their exact URLs; statements are checked against the cited document's text.` : '')
      + (events ? `\n\n<events>\n${events}\n</events>\n\nThese are recorded decisions and releases for this story's series, with the factors the institution gave (quoted from its statement). Use them for timelines and "what drove this" passages: each timeline event cites its own source URL listed here, and a factor is described only as quoted.` : '');

    onEvent({ type: 'tool_start', name: 'research', label: 'Researching story data', at: new Date().toISOString() });

    try {
      const { text: researchText } = await runFoundryTurn({
        intent: 'investigate',
        userPrompt: researchPrompt,
        priorMessages: [],
        onEvent: (e) => {
          if (e.type === 'tool_start' && e.name === 'query_data' && e.detail) queried.add(e.detail);
          onEvent(e);
        },
      });

      onEvent({ type: 'tool_start', name: 'structure', label: 'Writing the article', at: new Date().toISOString() });
      const { data: catalogue } = await supabase.from('metrics').select('metric_id, name, unit').order('metric_id');
      story = await structureStory(pitch, researchText, metrics, catalogue ?? []);
    } catch (err) {
      onEvent({
        type: 'tool_start',
        name: 'structure',
        label: 'Research write-up failed; writing article from the approved brief',
        at: new Date().toISOString(),
      });
      story = articleFromApprovedPitch(pitch);
      story.generation_note = `${story.generation_note} (${err instanceof Error ? err.message : 'research failed'})`;
    }
  }
  // Charts take their values from the store, then every figure is checked against it.
  onEvent({ type: 'tool_start', name: 'check', label: 'Building charts from stored data and checking figures', at: new Date().toISOString() });
  // Models still reach for old metric names (e.g. trimmed_mean_cpi); map them to real ids.

  const ctx: CheckContext = { metricIds, queried, audit: opts.audit, onEvent };
  let { check, ids: checkedIds } = await checkStory(supabase, story, ctx);

  // Up to MAX_REVISIONS rounds: correct or drop what the checks could not support, then check again.
  // One extra round when the draft is nearly there (only style items, or at most three items of any
  // kind): a long lede or one stray claim is cheap to fix and usually fixed in one more pass.
  const styleOnly = () => check.issues.every((i) => i.startsWith('style:')) || check.issues.length <= 3;
  let rounds = opts.audit ? MAX_REVISIONS : 0;
  for (let round = 1; !check.ok && apiKey && story.body.blocks.length && round <= rounds; round++) {
    onEvent({ type: 'tool_start', name: 'revise', label: `Revision ${round}: ${check.issues.length} item(s) to fix`, at: new Date().toISOString() });
    try {
      const revised = keepSourceLinks(story, await reviseForChecks(supabase, story, check.issues, [...checkedIds], loadNewsStyle()));
      const next = await checkStory(supabase, revised, ctx);
      story = revised;
      check = next.check;
      checkedIds = next.ids;
    } catch (e) {
      check.issues.push(`revision ${round} failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (round === rounds && rounds === MAX_REVISIONS && !check.ok && styleOnly()) rounds++;
  }
  if (!check.ok && rounds) check.issues.unshift(`not fixed after ${rounds} revision round(s):`);
  return { story, check, ids: checkedIds };
}

export async function publishStoryFromPitch(
  pitchId: string,
  onEvent: (event: FoundryEvent) => void,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const supabase = createClient();

  const { data: pitch, error } = await supabase.from('pitches').select('*').eq('id', pitchId).single();
  if (error || !pitch) throw new Error('Pitch not found');
  if (pitch.state !== 'approved') {
    throw new Error(`Pitch must be approved before publishing (current state: ${pitch.state})`);
  }

  const { data: existing } = await supabase.from('stories')
    .select('slug, status').eq('pitch_id', pitchId).maybeSingle();
  if (existing?.status === 'published') {
    throw new Error(`Story already published at /stories/${existing.slug}`);
  }

  const { story, check, ids } = await draftStory(supabase, pitch, onEvent, opts);
  const checkedIdsForSave = ids;

  const slug = existing?.slug ?? await uniqueSlug(story.slug_hint || story.title);
  const now = new Date().toISOString();
  const today = sydneyDay();

  // Save as draft — editor previews before going live.
  if (existing?.slug) {
    await supabase.from('stories').update({
      slug,
      status: 'draft',
      kicker: story.kicker,
      title: story.title,
      hook: story.hook,
      caveat: story.caveat,
      published: today,
      one_number: story.one_number,
      evidence: { ...story.evidence, metric_ids: [...checkedIdsForSave] },
      body: story.body,
      frame_check: Boolean(story.frame_check),
      updated_at: now,
    }).eq('pitch_id', pitchId);
  } else {
    const { error: insertErr } = await supabase.from('stories').insert({
      pitch_id: pitchId,
      slug,
      status: 'draft',
      kicker: story.kicker,
      title: story.title,
      hook: story.hook,
      caveat: story.caveat,
      published: today,
      one_number: story.one_number,
      evidence: { ...story.evidence, metric_ids: [...checkedIdsForSave] },
      body: story.body,
      frame_check: Boolean(story.frame_check),
    });
    if (insertErr) throw new Error(insertErr.message);
  }

  await supabase.rpc('set_actor', { who: 'editor' }).then(() => {}, () => {});
  await supabase.from('pitch_feedback').insert({
    pitch_id: pitchId,
    action: 'comment',
    comment: `Article ready to edit: /foundry/desk/${slug} — ${story.generation_note}` +
      (check.ok ? ' Fact check passed.' : ` Fact check held it: ${check.issues.slice(0, 8).join('; ')}`),
  });

  onEvent({
    type: 'tool_result',
    name: 'done',
    label: 'Article ready to edit',
    detail: story.generation_note,
    at: now,
  });

  return {
    slug,
    title: story.title,
    storyUrl: `/stories/${slug}`,
    previewUrl: `/stories/${slug}?preview=1`,
    status: 'draft',
    generation_note: story.generation_note,
    check,
  };
}

/** Promote a draft story to published and mark the pitch published. */
export async function goLiveFromPitch(pitchId: string): Promise<GoLiveResult> {
  const supabase = createClient();
  const { data: story, error } = await supabase.from('stories')
    .select('slug, title, status')
    .eq('pitch_id', pitchId)
    .maybeSingle();
  if (error || !story) throw new Error('No draft story found for this pitch — draft it first');
  if (story.status === 'published') {
    return {
      slug: story.slug,
      title: story.title,
      storyUrl: `/stories/${story.slug}`,
      status: 'published',
    };
  }

  const now = new Date().toISOString();
  const today = sydneyDay();
  const { error: updErr } = await supabase.from('stories').update({
    status: 'published',
    published: today,
    updated_at: now,
  }).eq('pitch_id', pitchId);
  if (updErr) throw new Error(updErr.message);

  await supabase.rpc('set_actor', { who: 'editor' }).then(() => {}, () => {});
  await supabase.from('pitches').update({
    state: 'published',
    state_changed: now,
    last_evaluated: now,
  }).eq('id', pitchId);

  await supabase.from('pitch_feedback').insert({
    pitch_id: pitchId,
    action: 'comment',
    comment: `Published story: /stories/${story.slug}`,
  });

  return {
    slug: story.slug,
    title: story.title,
    storyUrl: `/stories/${story.slug}`,
    status: 'published',
  };
}
