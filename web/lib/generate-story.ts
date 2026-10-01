import { createClient } from '@/lib/supabase-server';
import { runFoundryTurn, type FoundryEvent } from '@/lib/foundry-agent';
import { CHARTER, MODEL } from '@/lib/research-agent';
import { articleFromApprovedPitch, type StructuredStory } from '@/lib/article-from-pitch';
import { bindStoryCharts } from '@/lib/chart-from-data';
import { factCheckStory, type FactCheck } from '@/lib/fact-check';
import { auditClaims, reviseForChecks } from '@/lib/claim-audit';
import { METRIC_ALIASES, loadKnownMetrics, normaliseMetricIds } from '../../agent/scripts/lib/metric-ids.mjs';
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

function loadEditorialCharter() {
  for (const p of [
    path.join(process.cwd(), '..', 'agent', 'EDITORIAL.md'),
    path.join(process.cwd(), 'agent', 'EDITORIAL.md'),
    path.join(process.cwd(), '.agent', 'EDITORIAL.md'),
  ]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '';
}

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
1. Verify every claim against tier 1/2 data. Pull exact numbers with periods and sources.
2. Build the evidence table rows the story rests on.
3. Draft the layered narrative prose (opening frame → shifts → corrected frame).
4. Identify the one number that carries the story.

5. Design a chart from the evidence that matches chart_hint when possible
   (rank_swap for denominator flips, timeline for sequences, bars otherwise).

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

Return JSON matching this schema exactly:
{
  "kicker": "Topic · Frame check (short label)",
  "title": "news headline: the finding, with its number when it lands; active verb; under 90 chars; AU English",
  "hook": "one-line standfirst for the card: why this matters now",
  "caveat": "hostile reader objection, specific",
  "one_number": { "value": "the headline number", "label": "what it measures" },
  "evidence": {
    "table": { "head": ["col1", ...], "rows": [["cell", ...], ...] } or omit if no table,
    "sources": [{ "metric": "...", "org": "...", "tier": 1|2, "url": "https://...", "period": "...", "basis": "..." }]
  },
  "body": {
    "blocks": [
      { "type": "paragraph", "text": "..." },
      { "type": "paragraph", "text": "..." },
      { "type": "layers", "items": ["...", "...", "..."] },
      { "type": "chart", "kind": "bars|rank_swap|timeline", "title": "what the chart shows",
        "data": { "metric_id": "one of the stored metric_ids", "mode": "latest_by_entity|timeline",
                  "entities": ["AUS","NZL","CAN"], "entity": "AUS", "last": 12, "alt_metric_id": "for rank_swap only" } },
      { "type": "heading", "text": "..." },
      { "type": "paragraph", "text": "..." },
      { "type": "pull", "text": "..." },
      { "type": "paragraph", "text": "..." }
    ]
  },
  "metric_ids_used": ["every stored metric_id whose values the copy quotes"],
  "slug_hint": "3-5 word slug from topic",
  "generation_note": "one line on what the story does",
  "frame_check": true if this corrects a widely shared frame (denominator flip, viral claim check, rank surprise, two-truths gap) else false
}

Rules:
- Standard news structure, in the block order shown: paragraph 1 is the lede (who, what, when, and the newsworthy finding with its number, in one or two sentences); paragraph 2 is the nut graf (why it matters now and what it changes for readers); the layers are the data that shifts the picture, in the sequence from EDITORIAL.md; then a section heading, context and supporting data, a pull line with the corrected frame, and a closing paragraph on the caveat and what to watch next (next release, next decision). Write the copy itself, never labels like "Lede:". Short paragraphs. No em dashes.
- Headline: attention-grabbing because the finding is surprising, never because it withholds it. No questions, no "you won't believe", no puns that hide the number.
- Every number in the copy must be a stored value (or a change between stored periods, a gap to a peer, or a rank) for a metric in metric_ids_used. Do not quote figures that exist only in web search results: name the claim without its number instead. Unsupported numbers stop the article from publishing.
- Charts: give "data" with a stored metric_id and leave out "series"; values are filled from the store. latest_by_entity compares countries at Australia's latest period; timeline shows one entity over time. For rank_swap give alt_metric_id (for example absolute vs per person).
- Include exactly one chart block.
- All sources must be tier 1 or 2.
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

  onEvent({ type: 'tool_start', name: 'load', label: 'Loading pitch and metrics', at: new Date().toISOString() });

  const metricIds = [
    ...new Set([...(pitch.metric_ids ?? []), ...(pitch.resurface_metrics ?? [])]),
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
    const researchPrompt = buildResearchPrompt(pitch, metrics, charter);

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
  const known = await loadKnownMetrics(supabase);
  const canonical = (id?: string) => (id ? (METRIC_ALIASES as Record<string, string>)[id] ?? id : id);
  const unlabel = (t: string) => t.replace(/^\s*(?:lede|nut graf|layer \d+|context|closing)\s*:\s*/i, '');

  /** Normalise ids, build charts from the store, then check figures and audit claims. */
  const checkStory = async (draft: StructuredStory) => {
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
    const bound = await bindStoryCharts(supabase, draft.body.blocks);
    draft.body = { blocks: bound.blocks };
    const ids = new Set(metricIds);
    for (const id of draft.metric_ids_used ?? []) ids.add(id);
    for (const id of normaliseMetricIds([...queried], known).linked) ids.add(id);
    for (const id of bound.chartMetricIds) ids.add(id);
    const result = await factCheckStory(supabase, draft, [...ids]);
    result.issues.unshift(...bound.issues);
    result.ok = result.ok && bound.issues.length === 0;

    // Figures exist in the data; now check each claim uses them truthfully.
    if (result.ok && apiKey && opts.audit) {
      onEvent({ type: 'tool_start', name: 'audit', label: 'Auditing every claim against stored data', at: new Date().toISOString() });
      try {
        const audit = await auditClaims(supabase, draft, [...ids]);
        result.claims = audit.claims;
        for (const c of audit.unsupported) result.issues.push(`claim not supported by stored data: "${c.claim}" (${c.evidence})`);
        result.ok = audit.ok;
      } catch (e) {
        result.ok = false;
        result.issues.push(`claim audit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { check: result, ids };
  };

  let { check, ids: checkedIds } = await checkStory(story);

  // Up to MAX_REVISIONS rounds: correct or drop what the checks could not support, then check again.
  const rounds = opts.audit ? MAX_REVISIONS : 0;
  for (let round = 1; !check.ok && apiKey && story.body.blocks.length && round <= rounds; round++) {
    onEvent({ type: 'tool_start', name: 'revise', label: `Revision ${round}: ${check.issues.length} unsupported item(s)`, at: new Date().toISOString() });
    try {
      const revised = await reviseForChecks(supabase, story, check.issues, [...checkedIds]);
      const next = await checkStory(revised);
      story = revised;
      check = next.check;
      checkedIds = next.ids;
    } catch (e) {
      check.issues.push(`revision ${round} failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  if (!check.ok && rounds) check.issues.unshift(`unsupported after ${rounds} revision round(s):`);

  const slug = existing?.slug ?? await uniqueSlug(story.slug_hint || story.title);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

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
      evidence: story.evidence,
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
      evidence: story.evidence,
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
  const today = now.slice(0, 10);
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
