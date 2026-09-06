import { createClient } from '@/lib/supabase-server';
import { runFoundryTurn, type FoundryEvent } from '@/lib/foundry-agent';
import { CHARTER, MODEL } from '@/lib/research-agent';
import type { StoryBody, StoryEvidence, StoryOneNumber } from '@/lib/story-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type PublishResult = {
  slug: string;
  title: string;
  storyUrl: string;
  generation_note: string;
};

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

Write up findings in prose with explicit source citations. Be specific with numbers.`;
}

type StructuredStory = {
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  one_number: StoryOneNumber;
  evidence: StoryEvidence;
  body: StoryBody;
  slug_hint: string;
  generation_note: string;
};

async function structureStory(
  pitch: Record<string, unknown>,
  researchText: string,
): Promise<StructuredStory> {
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
      max_tokens: 8000,
      system: 'Convert research into a publishable Caveat story. Respond ONLY with valid JSON.',
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

Research notes:
${researchText.slice(0, 12000)}

Return JSON matching this schema exactly:
{
  "kicker": "Topic · Frame check (short label)",
  "title": "finding not topic, AU English, under 120 chars",
  "hook": "one-line why-now for the card",
  "caveat": "hostile reader objection, specific",
  "one_number": { "value": "the headline number", "label": "what it measures" },
  "evidence": {
    "table": { "head": ["col1", ...], "rows": [["cell", ...], ...] } or omit if no table,
    "sources": [{ "metric": "...", "org": "...", "tier": 1|2, "url": "https://...", "period": "...", "basis": "..." }]
  },
  "body": {
    "blocks": [
      { "type": "paragraph", "text": "opening frame" },
      { "type": "layers", "items": ["layer 1 shift", "layer 2 shift", "layer 3 shift"] },
      { "type": "heading", "text": "optional section heading" },
      { "type": "paragraph", "text": "..." },
      { "type": "pull", "text": "pull quote with the corrected frame" },
      { "type": "paragraph", "text": "closing" }
    ]
  },
  "slug_hint": "3-5 word slug from topic",
  "generation_note": "one line on what the story does"
}

Rules:
- All sources must be tier 1 or 2. No tier 3 headline claims.
- body.blocks must follow the layered story structure from EDITORIAL.md.
- Use only block types: paragraph, layers, heading, pull.`,
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

export async function publishStoryFromPitch(
  pitchId: string,
  onEvent: (event: FoundryEvent) => void,
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
  const charter = loadEditorialCharter();
  const researchPrompt = buildResearchPrompt(pitch, metrics, charter);

  onEvent({ type: 'tool_start', name: 'research', label: 'Researching story data', at: new Date().toISOString() });

  const { text: researchText } = await runFoundryTurn({
    intent: 'investigate',
    userPrompt: researchPrompt,
    priorMessages: [],
    onEvent,
  });

  onEvent({ type: 'tool_start', name: 'structure', label: 'Drafting story', at: new Date().toISOString() });

  const story = await structureStory(pitch, researchText);
  const slug = await uniqueSlug(story.slug_hint || story.title);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if (existing?.slug) {
    await supabase.from('stories').update({
      slug,
      status: 'published',
      kicker: story.kicker,
      title: story.title,
      hook: story.hook,
      caveat: story.caveat,
      published: today,
      one_number: story.one_number,
      evidence: story.evidence,
      body: story.body,
      updated_at: now,
    }).eq('pitch_id', pitchId);
  } else {
    const { error: insertErr } = await supabase.from('stories').insert({
      pitch_id: pitchId,
      slug,
      status: 'published',
      kicker: story.kicker,
      title: story.title,
      hook: story.hook,
      caveat: story.caveat,
      published: today,
      one_number: story.one_number,
      evidence: story.evidence,
      body: story.body,
    });
    if (insertErr) throw new Error(insertErr.message);
  }

  await supabase.rpc('set_actor', { who: 'editor' }).then(() => {}, () => {});
  await supabase.from('pitches').update({
    state: 'published',
    state_changed: now,
    last_evaluated: now,
  }).eq('id', pitchId);

  await supabase.from('pitch_feedback').insert({
    pitch_id: pitchId,
    action: 'comment',
    comment: `Published story: /stories/${slug} — ${story.generation_note}`,
  });

  onEvent({
    type: 'tool_result',
    name: 'done',
    label: 'Story published',
    detail: story.generation_note,
    at: now,
  });

  return {
    slug,
    title: story.title,
    storyUrl: `/stories/${slug}`,
    generation_note: story.generation_note,
  };
}
