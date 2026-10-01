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

const HISTORY = 40;

export type ClaimVerdict = { claim: string; verdict: 'supported' | 'unsupported'; evidence: string };
export type ClaimAudit = { ok: boolean; claims: ClaimVerdict[]; unsupported: ClaimVerdict[] };

function articleText(story: CheckableStory) {
  const parts = [`HEADLINE: ${story.title}`, `STANDFIRST: ${story.hook}`];
  if (story.one_number) parts.push(`ONE NUMBER: ${story.one_number.value} (${story.one_number.label})`);
  for (const b of story.body.blocks) {
    if (b.type === 'layers') parts.push(...b.items.map((t) => `- ${t}`));
    else if (b.type === 'chart') parts.push(`[CHART: ${b.title ?? ''}]`);
    else if ('text' in b) parts.push(b.text);
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
  Streaks and "highest since" need the listed readings to cover the whole span.
- "unsupported": anything else, including claims about series that are not in the reference,
  claims whose span is longer than the listed history, and figures attributed to other sources.

Dates, release names and plain descriptions without quantities are not claims to audit.

Respond ONLY with JSON:
{"claims":[{"claim":"short quote","verdict":"supported|unsupported","evidence":"metric_id, period and value used, or why unsupported"}]}`;

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
  db: SupabaseClient, story: StructuredStory, issues: string[], metricIds: string[],
): Promise<StructuredStory> {
  const reference = await buildReference(db, metricIds, { history: HISTORY });
  const prompt = `A data-journalism article failed its fact check. Rewrite it so it passes.

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
- Keep the news structure (lede, nut graf, layers, chart, context, pull, what to watch), the chart
  block's "data" spec (metric_id from the reference), and a headline that leads with the strongest
  finding the reference supports. No em dashes.
- List in metric_ids_used every metric_id whose values the copy quotes.

Return ONLY the full article JSON in the same schema as article_json.`;
  return await callClaudeJson(prompt, { label: 'article revision' }) as StructuredStory;
}
