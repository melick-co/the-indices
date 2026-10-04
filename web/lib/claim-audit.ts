import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import type { CheckableStory } from '@/lib/fact-check';
import type { StructuredStory } from '@/lib/article-from-pitch';
import { DATA_TABLE, isDocumentSourced } from '@/lib/source-check';
import { canonicalUrl } from '../../agent/scripts/lib/html-text.mjs';
import { rawSentences } from '@/lib/style-check';

/**
 * Second publish gate. The figure check proves each number exists in the
 * story's data; it cannot tell whether the sentence uses it truthfully
 * ("19-year low" can pass because 19 happens to be a stored value). This asks
 * a separate Claude call, which sees only the article and the stored
 * reference data (no research notes, no web), to audit every quantitative
 * claim. Any claim it cannot support from the reference holds the story.
 */

// Long enough for "highest since" and streak claims on monthly and decision-date series.
const HISTORY = 120;

export type ClaimVerdict = { claim: string; verdict: 'supported' | 'unsupported'; evidence: string };
export type ClaimAudit = { ok: boolean; claims: ClaimVerdict[]; unsupported: ClaimVerdict[] };

function articleText(story: CheckableStory) {
  const footnoteUrls = new Map((story.evidence?.footnotes ?? []).map((f) => [f.n, f.url ?? '']));
  // The deck is audited like a paragraph: a sentence sourced to a document is checked against that document.
  const deck = rawSentences(story.hook).map((s) => (isDocumentSourced(s, footnoteUrls)
    ? '[SOURCED STATEMENT, checked against its cited document; do not audit]' : s)).join(' ');
  // A headline cannot carry a footnote. When every figure in it is stated in a sentence that is checked against
  // its cited document (the deck or the body), its figures are that document's, not the store's.
  const sourcedText = [story.hook, ...story.body.blocks.flatMap((b) => ('text' in b && typeof b.text === 'string' ? [b.text] : []))]
    .flatMap((t) => rawSentences(t)).filter((s) => isDocumentSourced(s, footnoteUrls)).join(' ');
  const headFigures = story.title.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const headSourced = headFigures.length > 0 && headFigures.every((f) => sourcedText.includes(f));
  const parts = [
    headSourced ? `HEADLINE: ${story.title} [its figures restate sourced statements below, checked against their cited documents; do not audit the figures]` : `HEADLINE: ${story.title}`,
    `STANDFIRST: ${deck.replace(/\[\^\d+\]/g, '')}`,
  ];
  if (story.one_number) parts.push(`ONE NUMBER: ${story.one_number.value} (${story.one_number.label})`);
  for (const b of story.body.blocks) {
    if (b.type === 'layers') parts.push(...b.items.map((t) => `- ${t}`));
    else if (b.type === 'chart') {
      // What the chart actually plots (from the store), so its title can be checked against it.
      const s = b.series ?? [];
      const a = b.alt_series ?? [];
      const ends = (xs: typeof s) => (xs.length ? `${xs[0].label} ${xs[0].value} … ${xs[xs.length - 1].label} ${xs[xs.length - 1].value}` : '');
      const plots = b.kind === 'line' || b.kind === 'timeline'
        ? [`${b.primary_label ?? b.bound?.metric_id ?? ''}: ${ends(s)}`, ...(a.length ? [`${b.alt_label ?? b.bound?.alt_metric_id ?? ''}: ${ends(a)}`] : [])].join('; ')
        // No bar count: a chart may show a selection of countries, and the count is not part of its claim.
        : `bars, highest first (${s.slice(0, 3).map((p) => `${p.label} ${p.value}`).join(', ')}…)${a.length ? ` beside ${b.alt_label ?? b.bound?.alt_metric_id}` : ''}`;
      parts.push(`[CHART TITLE: ${b.title ?? ''} | SUBTITLE: ${b.subtitle ?? ''} | PLOTS: ${plots}]`);
    }
    else if (b.type === 'timeline') {
      // The title is a claim about the entries listed under it (checked here); the entries themselves, when cited
      // to a document, are checked against it by the source check.
      parts.push(`[TIMELINE TITLE: ${b.title ?? ''} | ENTRIES: ${b.events.map((e) => `${e.date}: ${e.label.replace(/\[\^\d+\]/g, '')}`).join('; ')}]`);
      const urls = new Map((story.evidence?.footnotes ?? []).map((f) => [f.n, f.url ?? '']));
      for (const e of b.events) {
        const url = e.footnote ? urls.get(e.footnote) ?? '' : '';
        parts.push(url && !DATA_TABLE.test(url) ? `- ${e.date}: [SOURCED EVENT, checked against its cited document; do not audit]` : `- ${e.date}: ${e.label}`);
      }
    }
    // Quotes are verified word for word against their source; their content is the speaker's, not a data claim.
    else if (b.type === 'quote') parts.push(`[QUOTE from ${b.speaker}, verified against source; do not audit]`);
    else if ('text' in b) {
      // Sentences sourced to a document are checked against that document (source-check.ts), not stored data.
      const urls = new Map((story.evidence?.footnotes ?? []).map((f) => [f.n, f.url ?? '']));
      const kept = rawSentences(b.text).map((s) => (isDocumentSourced(s, urls)
        ? '[SOURCED STATEMENT, checked against its cited document; do not audit]' : s));
      parts.push(kept.join(' ').replace(/\[\^\d+\]/g, ''));
    }
  }
  parts.push(`CAVEAT: ${story.caveat}`);
  for (const row of story.evidence?.table?.rows ?? []) parts.push(`TABLE: ${row.join(' | ')}`);
  return parts.join('\n');
}

export async function auditClaims(
  db: SupabaseClient, story: CheckableStory, metricIds: string[],
): Promise<ClaimAudit> {
  const reference = await buildReference(db, metricIds, { history: HISTORY });
  const prompt = `You are the fact-checker for a data-journalism desk. The article below may only make
quantitative claims that the REFERENCE data supports. Audit it strictly.

<reference>
${JSON.stringify(reference)}
</reference>

<article>
${articleText(story)}
</article>

The reference holds, per metric_id: Australia's latest reading, earlier readings ("earlier", newest
first), and for cross-country series the full ranking at that period. It is the only admissible evidence.

List every claim in the article that states or implies a quantity: a figure, a change, a rank, a
record or "highest/lowest since", a streak ("for 30 straight months"), a duration, or a comparison
between things. For each, decide:
- "supported": the reference shows it, directly or by simple arithmetic on listed values (a change
  between two listed readings, a gap between two listed entities, a position in a listed ranking).
  Streaks and "highest since" need the listed readings to cover the whole span. "Highest since X"
  means no reading after X is as high as the current one; the reading at X itself is normally higher
  (that is why the run ends there), so a higher value at X supports the claim rather than refuting it.
  Likewise "lowest since X".
  Policy-rate series are dated by the day a change takes effect, usually the day after it is
  announced; an announcement date one day before the stored period is supported.
- "unsupported": anything else, including claims about series that are not in the reference,
  claims whose span is longer than the listed history, and figures attributed to other sources.

A CHART TITLE is a claim about the data its chart plots (listed after PLOTS). List it as "unsupported" if it
names a measure the chart does not plot, or states a trend, comparison or finding that the plotted series do not
show. Judge it against PLOTS and the reference, not against the article's prose. A title that names its own
starting point ("from its 2025 trough", "since 2023") is judged from that point, not from the chart's first value.

A TIMELINE TITLE is a claim about the entries listed under it. List it as "unsupported" if it states a count,
sequence or finding that its entries do not show (for example "tightened four times" over entries that show one
rate rise).

A CONTRAST or PAIRING ("X rose while Y fell", "even as", "X re-accelerated as Y eased", "both", "unlike") is
one claim: every part must hold over the SAME period. Take the period from the claim, or from the comparison it
leans on (a change "in a year" or "from its trough" sets the window for the other half too). If one half is true
only over a different window (for example headline CPI fell in the latest quarter while the trimmed mean is
compared over a year, during which headline CPI rose), the claim is "unsupported": say which half fails over
which period. A CHANGE OVER A STATED RUN ("fell for six consecutive quarters, dropping A$X", "down 1.2 points over four
quarters") is measured from the reading just before the run begins to its last reading. Count it this way: a run of
falls "from June 2023" begins with the fall INTO June 2023 (March to June), so its total change runs from the March
2023 reading. A total measured from the June 2023 reading itself leaves out the first fall: it is "unsupported",
whatever the arithmetic between the two quoted readings; give the run's actual change. A named peak ("the June 2023
peak") must be higher than the reading before it and every reading in the run; a named trough the reverse. A direction or trend stated without a number ("disinflation", "is falling", "kept easing") implies
a quantity and is audited the same way, over the period the article is discussing. This is a factual error, not
a matter of framing.

Dates (including scheduled release and meeting dates), release names, plain descriptions without
quantities, and reports of what an institution said or published (minutes, statements, speeches) are
not claims to audit: they are sourced by the article's footnotes, not by the reference. Only list a
claim if it states or implies a quantity.

For each claim, write the evidence first, then decide the verdict from it: if the evidence shows the
claim holds, the verdict is "supported". Wording or framing you would prefer is not grounds for
"unsupported"; only a figure, comparison or span the reference does not bear out.

Respond ONLY with JSON:
{"claims":[{"claim":"short quote","evidence":"metric_id, period and value used, or why unsupported","verdict":"supported|unsupported"}]}`;

  const result = await callClaudeJson(prompt, { label: 'claim audit' }) as { claims?: ClaimVerdict[] };
  const claims = (result.claims ?? []).filter((c) => c && typeof c.claim === 'string');
  const docFigures = await citedDocumentFigures(db, story);
  // Figures from an official document the article cites (a wage decision's 5.75 per cent, a release's rate) are
  // not in the store, so the audit cannot see them; they are the document's, and are cleared when every figure in
  // the claim is in a cited document. Years and one- or two-character numbers never clear a claim.
  const unsupported = claims.filter((c) => {
    if (c.verdict === 'supported') return false;
    const figures = (c.claim.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((f) => f.replace(/,/g, ''))
      .filter((f) => !/^(19|20)\d\d$/.test(f));
    const cleared = figures.length > 0 && figures.every((f) => f.length >= 3 && docFigures.has(f));
    if (cleared) c.verdict = 'supported';
    return !cleared;
  });
  return { ok: unsupported.length === 0, claims, unsupported };
}

/** Every figure in the official documents the article cites (stored as text in source_documents). */
async function citedDocumentFigures(db: SupabaseClient, story: CheckableStory): Promise<Set<string>> {
  const urls = [...new Set((story.evidence?.footnotes ?? []).map((f) => f.url ?? '').filter((u) => u && !DATA_TABLE.test(u)))]
    .map((u) => { try { return canonicalUrl(u); } catch { return null; } }).filter(Boolean) as string[];
  if (!urls.length) return new Set();
  const { data } = await db.from('source_documents').select('body').in('url', urls);
  const out = new Set<string>();
  for (const d of data ?? []) for (const f of String(d.body).match(/\d[\d,]*(?:\.\d+)?/g) ?? []) out.add(f.replace(/,/g, '').replace(/\.$/, ''));
  return out;
}

/**
 * Rewrite a held article so every claim rests on the stored reference:
 * correct wrong figures, drop or de-number claims about series we do not
 * hold, keep the structure and the strength of the headline. The result is
 * checked again from scratch by the caller.
 */
export async function reviseForChecks(
  db: SupabaseClient, story: StructuredStory, issues: string[], metricIds: string[], newsStyle = '',
): Promise<StructuredStory> {
  const reference = await buildReference(db, metricIds, { history: HISTORY });
  const prompt = `A data-journalism article failed its pre-publish checks (fact check and house news style). Rewrite it so it passes.
${newsStyle ? `\n<house_news_style>\n${newsStyle}\n</house_news_style>\n` : ''}
<reference>
${JSON.stringify(reference)}
</reference>

<fact_check_findings>
${issues.map((i) => `- ${i}`).join('\n')}
</fact_check_findings>

<article_json>
${JSON.stringify(story)}
</article_json>

Rules:
- The reference is the only admissible data. Every figure, change, rank, record, streak or comparison
  in the rewritten article must be shown by it (simple arithmetic on listed values is fine).
- Correct wrong figures to the reference value. Drop claims about series not in the reference, or
  state them without a number and attribute them in words. Do not add new figures from memory.
- Fix every "style:" finding to the house news style: headline 6-12 words as an active, present-tense
  claim; deck 20-35 words; lede 35 words or fewer; nut graf by paragraph 4; "to_be_sure" and
  "whats_next" paragraphs; 1-3 sentences per paragraph; [^n] after every figure with each n listed in
  evidence.footnotes; [^n] on every sentence reporting what a source said, published or scheduled, pointing
  at a footnote with that page's url (cite an existing footnote that covers it, or cut the claim);
  for "source:" findings, say only what the cited page says (or cut the claim); footnote text is a citation only; every chart with title, subtitle, alt and footnote; a timeline when 3+ dated events.
- Keep each paragraph's "role", every chart's "data" spec (metric_id from the reference), one_number's
  metric_id, footnote numbering, and any quote block exactly as it is (quotes are verified separately).
  Lead the headline with the strongest finding the reference supports. No em dashes.
- List in metric_ids_used every metric_id whose values the copy quotes.

Return ONLY the full article JSON in the same schema as article_json.`;
  // Long articles (a dozen footnotes, a timeline) run past the default reply length.
  return await callClaudeJson(prompt, { label: 'article revision', maxTokens: 32000 }) as StructuredStory;
}
