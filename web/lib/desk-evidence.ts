import type { SourceRow, StoryEvidence } from '@/lib/story-types';

/**
 * A desk save's evidence: the sources and table the editor edits, cleaned. Footnotes and the quoted metric ids are
 * not edited on the desk: they come from the payload when it carries them, otherwise from the stored row, so a
 * desk save never drops them.
 */
export function sanitiseEvidence(evidence: StoryEvidence, stored?: Partial<StoryEvidence> | null): StoryEvidence {
  const sources: SourceRow[] = (evidence.sources ?? [])
    .filter((s) => s.metric?.trim() && s.org?.trim())
    .map((s) => ({
      metric: s.metric.trim(),
      org: s.org.trim(),
      tier: s.tier === 2 || s.tier === 3 ? s.tier : 1,
      url: (s.url ?? '').trim(),
      period: (s.period ?? '').trim(),
      basis: (s.basis ?? '').trim(),
    }));
  const table = evidence.table
    ? {
      head: evidence.table.head.map((h) => h.trim()).filter(Boolean),
      rows: evidence.table.rows.map((r) => r.map((c) => c ?? '')),
    }
    : undefined;
  const footnotes = evidence.footnotes ?? stored?.footnotes;
  const metricIds = evidence.metric_ids?.length ? evidence.metric_ids : stored?.metric_ids;
  const kept = {
    ...(footnotes ? { footnotes } : {}),
    ...(metricIds?.length ? { metric_ids: metricIds } : {}),
  };
  if (table && !table.head.length) return { sources, ...kept };
  return { table, sources, ...kept };
}
