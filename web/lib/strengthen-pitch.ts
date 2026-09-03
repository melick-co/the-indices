import { createClient } from '@/lib/supabase-server';
import { runFoundryTurn, type FoundryEvent } from '@/lib/foundry-agent';
import { CHARTER, MODEL } from '@/lib/research-agent';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type StrengthenResult = {
  strengthened: boolean;
  headline: string;
  new_findings: string;
  strengthening_note: string;
  metrics_added: string[];
};

const STRENGTHEN_SYSTEM = `${CHARTER}

You are strengthening an EXISTING pitch — not starting from scratch. Your job is to
hunt for additional tier 1/2 data that makes the story sharper, more checkable, or
reveals a stronger angle (denominator flip, two-truths gap, rank surprise, divergence).

Use tools aggressively before writing:
- search_metrics — find related series not yet linked to the pitch
- query_data — AUS latest + OECD peer context for linked and newly found metrics
- lookup_sources — what official releases might add a "why now"
- web_search — recent ABS/RBA/OECD/IMF releases ONLY when our store is stale
- fetch_url — tier 1/2 pages when a search hit looks authoritative

Do not weaken the pitch to chase noise. If nothing material emerges, say so plainly.
Australian English. No em dashes.`;

function loadEditorialCharter() {
  const candidates = [
    path.join(process.cwd(), '..', 'agent', 'EDITORIAL.md'),
    path.join(process.cwd(), 'agent', 'EDITORIAL.md'),
    path.join(process.cwd(), '.agent', 'EDITORIAL.md'),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '';
}

async function refreshPitchMetrics(metricIds: string[], onEvent: (e: FoundryEvent) => void) {
  if (!metricIds.length) return [];
  try {
    const modPath = [
      path.join(process.cwd(), '..', 'agent', 'scripts', 'lib', 'hot-sources.mjs'),
      path.join(process.cwd(), 'agent', 'scripts', 'lib', 'hot-sources.mjs'),
    ];
    for (const p of modPath) {
      try {
        const { pathToFileURL } = await import('node:url');
        const { loadHotSources } = await import(pathToFileURL(p).href);
        onEvent({ type: 'tool_start', name: 'refresh', label: 'Refreshing hot sources', at: new Date().toISOString() });
        const result = await loadHotSources();
        onEvent({ type: 'tool_result', name: 'refresh', label: 'Hot sources loaded', at: new Date().toISOString() });
        return result.changedMetrics ?? [];
      } catch {
        /* try next path */
      }
    }
  } catch {
    onEvent({ type: 'tool_result', name: 'refresh', label: 'Source refresh skipped', at: new Date().toISOString() });
  }
  return [];
}

function buildResearchPrompt(pitch: Record<string, unknown>, charter: string) {
  return `${STRENGTHEN_SYSTEM}

<editorial_charter>
${charter.slice(0, 8000)}
</editorial_charter>

<pitch_to_strengthen>
${JSON.stringify({
  id: pitch.id,
  state: pitch.state,
  detector: pitch.detector,
  headline: pitch.headline,
  hook: pitch.hook,
  mechanism: pitch.mechanism,
  caveat: pitch.caveat,
  chart_hint: pitch.chart_hint,
  metric_ids: pitch.metric_ids,
  resurface_metrics: pitch.resurface_metrics,
  trigger_rows: pitch.trigger_rows,
  score: pitch.score,
}, null, 2)}
</pitch_to_strengthen>

Research task:
1. Refresh readings on linked metrics; search the store for complementary series.
2. Look for a stronger hook, sharper comparison, or new "why now" peg from tier 1/2 data.
3. Write up findings in prose:

**New data found** — bullet list with source, period, tier for each new fact
**Stronger angle** — how the pitch could be improved (or "unchanged")
**Recommended metrics** — metric_ids to add, if any
**Risk** — what still does not check out

Be specific with numbers. Mark derived/estimated figures.`;
}

async function structurePitchUpdate(
  pitch: Record<string, unknown>,
  researchText: string,
): Promise<{
  strengthened: boolean;
  headline: string;
  hook: string;
  mechanism: string;
  caveat: string;
  chart_hint: string;
  metric_ids: string[];
  score: Record<string, number> | null;
  new_findings: string;
  strengthening_note: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: 'Convert research into a strengthened pitch brief. Respond ONLY with valid JSON.',
      messages: [{
        role: 'user',
        content: `Original pitch:
${JSON.stringify({
  headline: pitch.headline,
  hook: pitch.hook,
  mechanism: pitch.mechanism,
  caveat: pitch.caveat,
  chart_hint: pitch.chart_hint,
  metric_ids: pitch.metric_ids,
  score: pitch.score,
})}

Research notes:
${researchText.slice(0, 6000)}

Return JSON:
{
  "strengthened": true if copy or metrics materially improved else false,
  "headline": "finding not topic, AU English",
  "hook": "why now",
  "mechanism": "one lay sentence",
  "caveat": "hostile reader objection",
  "chart_hint": "best visual",
  "metric_ids": ["include original plus any new tier 1/2 series found"],
  "score": { "surprise": 0-5, "checkability": 0-5, "mechanism": 0-5, "visual": 0-5, "timing": 0-5 } or null to keep prior,
  "new_findings": "2-4 bullet summary of additional data",
  "strengthening_note": "one line on what changed"
}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const raw = (body.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

export async function strengthenPitch(
  pitchId: string,
  onEvent: (event: FoundryEvent) => void,
): Promise<StrengthenResult> {
  const supabase = createClient();
  const { data: pitch, error } = await supabase.from('pitches').select('*').eq('id', pitchId).single();
  if (error || !pitch) throw new Error('Pitch not found');

  const linkedMetrics = [
    ...new Set([...(pitch.metric_ids ?? []), ...(pitch.resurface_metrics ?? [])]),
  ] as string[];

  onEvent({ type: 'tool_start', name: 'load', label: 'Loading pitch context', at: new Date().toISOString() });
  await refreshPitchMetrics(linkedMetrics, onEvent);

  const charter = loadEditorialCharter();
  const researchPrompt = buildResearchPrompt(pitch, charter);

  onEvent({ type: 'tool_start', name: 'research', label: 'Searching for additional data', at: new Date().toISOString() });

  const { text: researchText } = await runFoundryTurn({
    intent: 'investigate',
    userPrompt: researchPrompt,
    priorMessages: [],
    onEvent,
  });

  onEvent({ type: 'tool_start', name: 'structure', label: 'Drafting strengthened pitch', at: new Date().toISOString() });

  const update = await structurePitchUpdate(pitch, researchText);
  const now = new Date().toISOString();
  const priorMetrics = new Set(pitch.metric_ids ?? []);
  const metricsAdded = (update.metric_ids ?? []).filter((m) => !priorMetrics.has(m));

  const patch: Record<string, unknown> = {
    last_evaluated: now,
    updated_at: now,
  };

  if (update.strengthened) {
    patch.headline = update.headline;
    patch.hook = update.hook;
    patch.mechanism = update.mechanism;
    patch.caveat = update.caveat;
    patch.chart_hint = update.chart_hint;
    patch.metric_ids = update.metric_ids;
    if (update.score) patch.score = update.score;
    patch.trigger_rows = {
      ...(pitch.trigger_rows as Record<string, unknown> ?? {}),
      strengthened_at: now,
      new_findings: update.new_findings,
      strengthening_note: update.strengthening_note,
      research_excerpt: researchText.slice(0, 4000),
    };
  }

  await supabase.from('pitches').update(patch).eq('id', pitchId);

  onEvent({
    type: 'tool_result',
    name: 'done',
    label: update.strengthened ? 'Pitch strengthened' : 'No material improvement',
    detail: update.strengthening_note,
    at: now,
  });

  return {
    strengthened: update.strengthened,
    headline: update.headline,
    new_findings: update.new_findings,
    strengthening_note: update.strengthening_note,
    metrics_added: metricsAdded,
  };
}
