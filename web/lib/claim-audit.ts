import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { buildReference } from '../../agent/scripts/lib/revise-pitches.mjs';
import type { CheckableStory } from '@/lib/fact-check';

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
