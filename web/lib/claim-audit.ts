import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import type { CheckableStory } from '@/lib/fact-check';
import type { StructuredStory } from '@/lib/article-from-pitch';

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
  const parts = [`HEADLINE: ${story.title}`, `STANDFIRST: ${story.hook.replace(/\[\^\d+\]/g, '')}`];
  if (story.one_number) parts.push(`ONE NUMBER: ${story.one_number.value} (${story.one_number.label})`);
  for (const b of story.body.blocks) {
    if (b.type === 'layers') parts.push(...b.items.map((t) => `- ${t}`));
    else if (b.type === 'chart') parts.push(`[CHART: ${b.title ?? ''}]`);
    else if (b.type === 'timeline') parts.push(...b.events.map((e) => `- ${e.date}: ${e.label}`));
    // Quotes are verified word for word against their source; their content is the speaker's, not a data claim.
    else if (b.type === 'quote') parts.push(`[QUOTE from ${b.speaker}, verified against source; do not audit]`);
    else if ('text' in b) parts.push(b.text.replace(/\[\^\d+\]/g, ''));
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

Dates, release names and plain descriptions without quantities are not claims to audit.

For each claim, write the evidence first, then decide the verdict from it: if the evidence shows the
claim holds, the verdict is "supported". Wording or framing you would prefer is not grounds for
"unsupported"; only a figure, comparison or span the reference does not bear out.

Respond ONLY with JSON:
{"claims":[{"claim":"short quote","evidence":"metric_id, period and value used, or why unsupported","verdict":"supported|unsupported"}]}`;

  const result = await callClaudeJson(prompt, { label: 'claim audit' }) as { claims?: ClaimVerdict[] };
  const claims = (result.claims ?? []).filter((c) => c && typeof c.claim === 'string');
  const unsupported = claims.filter((c) => c.verdict !== 'supported');
  return { ok: unsupported.length === 0, claims, unsupported };
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
  evidence.footnotes; every chart with title, subtitle, alt and footnote; a timeline when 3+ dated events.
- Keep each paragraph's "role", every chart's "data" spec (metric_id from the reference), one_number's
  metric_id, footnote numbering, and any quote block exactly as it is (quotes are verified separately).
  Lead the headline with the strongest finding the reference supports. No em dashes.
- List in metric_ids_used every metric_id whose values the copy quotes.

Return ONLY the full article JSON in the same schema as article_json.`;
  return await callClaudeJson(prompt, { label: 'article revision' }) as StructuredStory;
}
