import { createClient } from '@/lib/supabase-server';
import {
  ASK_INSTRUCTIONS,
  BRAINSTORM_INSTRUCTIONS,
  CHARTER,
  loadMetricList,
  MODEL,
  MAX_TURNS,
} from '@/lib/research-agent';
import type { FoundryMessage, FoundryScore, FoundryIntent } from '@/lib/research-shared';

export type FoundryEvent =
  | { type: 'tool_start'; name: string; label: string; detail?: string; at: string }
  | { type: 'tool_result'; name: string; label: string; detail?: string; at: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'follow_ups'; items: { id: string; prompt: string; intent?: string }[] }
  | { type: 'score'; score: FoundryScore; verdict?: string; rank_value?: number }
  | { type: 'source_suggestions'; items: { id: string; action: string; summary: string }[] }
  | { type: 'branches'; items: { id: string; label: string }[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

const UA = 'Caveat-Foundry/0.1 (+https://the-indices.vercel.app)';

export const INTENT_INSTRUCTIONS: Record<FoundryIntent, string> = {
  investigate: ASK_INSTRUCTIONS,
  brainstorm: BRAINSTORM_INSTRUCTIONS,
  refine: `
Continue this thread. Build on prior messages without repeating yourself.
Answer the editor's follow-up directly. Keep the same voice rules as investigate mode
when the question calls for a verdict; use angle blocks when exploring new directions.
`,
  precedents: `
Research cross-market and cross-sector precedents for the topic at hand.
For each precedent section use:

### Precedent: [market or sector] — [headline-shaped finding]
- **Comparable:** what matches the Australian case
- **Difference:** what does not transfer
- **Source:** tier 1/2 only, with URL or agency name
- **Checkability:** can we verify with our store or a fetch?

Use web_search and fetch_url heavily. Prefer OECD, World Bank, national statistical
offices, and peer central banks. End with **Chase first:** on the single precedent
most likely to sharpen the Australian story.
`,
};

const SCORE_WEIGHTS = {
  surprise: 0.25,
  checkability: 0.25,
  mechanism: 0.2,
  visual: 0.15,
  timing: 0.15,
};

function rankFromScore(score: FoundryScore): number {
  return (
    score.surprise * SCORE_WEIGHTS.surprise +
    score.checkability * SCORE_WEIGHTS.checkability +
    score.mechanism * SCORE_WEIGHTS.mechanism +
    score.visual * SCORE_WEIGHTS.visual +
    score.timing * SCORE_WEIGHTS.timing
  );
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'query_data':
      return `Reading ${String(input.metric_id ?? 'series')}${input.entity ? ` (${input.entity})` : ''}`;
    case 'web_search':
      return 'Searching the web';
    case 'fetch_url':
      return `Fetching ${String(input.url ?? 'page').slice(0, 60)}`;
    case 'lookup_sources':
      return 'Looking up data sources';
    case 'search_metrics':
      return `Searching metrics for "${String(input.query ?? '').slice(0, 40)}"`;
    default:
      return name;
  }
}

async function fetchUrlCached(url: string) {
  const supabase = createClient();
  const { data: cached } = await supabase.from('research_cache')
    .select('title, text, fetched_at').eq('url', url).maybeSingle();
  if (cached?.text) {
    return { ok: true as const, title: cached.title, text: cached.text, url, cached: true };
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false as const, error: 'Only http(s) links are supported.' };
    }
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false as const, error: `Fetch failed (${res.status})` };
    const raw = await res.text();
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? parsed.hostname;
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
    await supabase.from('research_cache').upsert({ url, title, text, fetched_at: new Date().toISOString() });
    return { ok: true as const, title, text, url, cached: false };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not fetch link';
    return { ok: false as const, error: msg };
  }
}

async function lookupSources(query?: string) {
  const supabase = createClient();
  let q = supabase.from('data_sources').select('source_id, name, org, tier, cadence, active, access_url');
  if (query?.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`name.ilike.${term},org.ilike.${term},source_id.ilike.${term}`);
  }
  const { data, error } = await q.order('tier').order('name').limit(40);
  if (error) return { error: error.message };
  return { sources: data ?? [] };
}

async function searchMetrics(query: string) {
  const supabase = createClient();
  const term = `%${query.trim()}%`;
  const { data, error } = await supabase.from('metrics')
    .select('metric_id, name, unit, source_org, source_tier, period')
    .or(`metric_id.ilike.${term},name.ilike.${term},source_org.ilike.${term}`)
    .limit(30);
  if (error) return { error: error.message };
  return { metrics: data ?? [] };
}

async function executeTool(name: string, input: Record<string, unknown>) {
  const supabase = createClient();
  if (name === 'query_data') {
    let q = supabase.from('observations_labelled').select('*')
      .eq('metric_id', String(input.metric_id));
    if (input.entity) q = q.eq('entity', String(input.entity));
    const { data, error } = await q.order('period').limit(Number(input.limit) || 60);
    return error ? { error: error.message } : { rows: data };
  }
  if (name === 'fetch_url') {
    return fetchUrlCached(String(input.url ?? ''));
  }
  if (name === 'lookup_sources') {
    return lookupSources(input.query ? String(input.query) : undefined);
  }
  if (name === 'search_metrics') {
    return searchMetrics(String(input.query ?? ''));
  }
  return { error: `Unknown tool: ${name}` };
}

function buildTools(metricList: string, intent: FoundryIntent) {
  const webMaxUses = intent === 'precedents' ? 10 : 6;
  return [
    {
      name: 'query_data',
      description:
        'Query the Caveat data store. Returns observations with their source and tier. ' +
        `Available metric_ids:\n${metricList}`,
      input_schema: {
        type: 'object',
        properties: {
          metric_id: { type: 'string', description: 'Which series to read' },
          entity: { type: 'string', description: 'Optional ISO-3166 alpha-3 code, e.g. AUS' },
          limit: { type: 'number', description: 'Max rows, default 60' },
        },
        required: ['metric_id'],
      },
    },
    {
      name: 'search_metrics',
      description: 'Keyword search over metric_ids and names in the Caveat store.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords, e.g. CPI, household debt' },
        },
        required: ['query'],
      },
    },
    {
      name: 'lookup_sources',
      description: 'Read the tier 1/2 data source registry (release calendars, agencies).',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional filter by name or org' },
        },
      },
    },
    {
      name: 'fetch_url',
      description: 'Fetch and extract text from a public URL (tier 1/2 pages, reports).',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL to fetch' },
        },
        required: ['url'],
      },
    },
    { type: 'web_search_20250305', name: 'web_search', max_uses: webMaxUses },
  ];
}

export async function runFoundryTurn(options: {
  intent: FoundryIntent;
  userPrompt: string;
  priorMessages: FoundryMessage[];
  onEvent: (event: FoundryEvent) => void;
}): Promise<{ text: string; toolsUsed: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables (Production), then redeploy.',
    );
  }

  const metricList = await loadMetricList();
  const system = CHARTER + INTENT_INSTRUCTIONS[options.intent];
  const tools = buildTools(metricList, options.intent);
  const toolsUsed: string[] = [];

  const history = options.priorMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const messages: { role: string; content: unknown }[] = [
    ...history,
    { role: 'user', content: options.userPrompt },
  ];

  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, tools, messages }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      if (res.status === 401) {
        throw new Error(
          'Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in Vercel Production and redeploy.',
        );
      }
      throw new Error(`Anthropic ${res.status}: ${detail}`);
    }
    const body = await res.json();

    for (const b of body.content ?? []) {
      if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        toolsUsed.push(b.name);
        options.onEvent({
          type: 'tool_start',
          name: b.name,
          label: toolLabel(b.name, b.input ?? {}),
          detail: b.name === 'query_data' ? String(b.input?.metric_id ?? '') : undefined,
          at: new Date().toISOString(),
        });
      }
    }

    if (body.stop_reason !== 'tool_use') {
      finalText = (body.content ?? [])
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text: string }) => c.text)
        .join('\n');
      // Stream final text in chunks for responsive UI.
      const chunkSize = 48;
      for (let i = 0; i < finalText.length; i += chunkSize) {
        options.onEvent({ type: 'text_delta', delta: finalText.slice(i, i + chunkSize) });
      }
      return { text: finalText, toolsUsed: [...new Set(toolsUsed)] };
    }

    messages.push({ role: 'assistant', content: body.content });
    const results: { type: string; tool_use_id: string; content: string }[] = [];
    for (const b of body.content ?? []) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'web_search') {
        options.onEvent({
          type: 'tool_result',
          name: b.name,
          label: 'Web search complete',
          at: new Date().toISOString(),
        });
        continue;
      }
      const out = await executeTool(b.name, b.input ?? {});
      const detail = b.name === 'query_data' && 'rows' in out
        ? `${(out.rows as unknown[])?.length ?? 0} rows`
        : b.name === 'fetch_url' && 'text' in out
          ? `${String((out as { text?: string }).text ?? '').slice(0, 80)}…`
          : undefined;
      options.onEvent({
        type: 'tool_result',
        name: b.name,
        label: toolLabel(b.name, b.input ?? {}),
        detail,
        at: new Date().toISOString(),
      });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
    }
    if (!results.length) {
      finalText = (body.content ?? [])
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text: string }) => c.text)
        .join('\n');
      for (let i = 0; i < finalText.length; i += 48) {
        options.onEvent({ type: 'text_delta', delta: finalText.slice(i, i + 48) });
      }
      return { text: finalText, toolsUsed: [...new Set(toolsUsed)] };
    }
    messages.push({ role: 'user', content: results });
  }

  finalText = 'Research ran out of turns without concluding.';
  options.onEvent({ type: 'text_delta', delta: finalText });
  return { text: finalText, toolsUsed: [...new Set(toolsUsed)] };
}

type TurnMeta = {
  score: FoundryScore;
  rank_value: number;
  verdict?: string;
  follow_ups: { id: string; prompt: string; intent?: string }[];
  branches: { id: string; label: string }[];
  source_suggestions: { action: string; summary: string; payload: Record<string, unknown> }[];
};

export async function scoreFoundryTurn(
  intent: FoundryIntent,
  userPrompt: string,
  assistantText: string,
): Promise<TurnMeta> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    const score = { surprise: 2, checkability: 2, mechanism: 2, visual: 2, timing: 2 };
    return {
      score,
      rank_value: rankFromScore(score),
      follow_ups: [],
      branches: [],
      source_suggestions: [],
    };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: `You score editor research turns for a data journalism desk. Respond ONLY with JSON.`,
      messages: [{
        role: 'user',
        content: `Intent: ${intent}
Editor prompt: ${userPrompt.slice(0, 800)}
Assistant answer: ${assistantText.slice(0, 3000)}

Return JSON:
{
  "score": { "surprise": 0-5, "checkability": 0-5, "mechanism": 0-5, "visual": 0-5, "timing": 0-5 },
  "verdict": "publishable" | "needs_work" | "killed" | null,
  "follow_ups": [{ "prompt": "actionable next step", "intent": "investigate|brainstorm|refine|precedents" }],
  "branches": [{ "label": "unexpected insight worth forking" }],
  "source_suggestions": [{ "action": "register_data_source|register_rss_feed", "summary": "...", "payload": { "url": "...", "name": "...", "org": "...", "tier": 1, "cadence": "monthly", "why": "..." } }]
}
Give 2-4 follow_ups. branches only if genuinely surprising. source_suggestions only for tier 1/2 sources explicitly worth farming.`,
      }],
    }),
  });

  if (!res.ok) {
    const score = { surprise: 2, checkability: 2, mechanism: 2, visual: 2, timing: 2 };
    return { score, rank_value: rankFromScore(score), follow_ups: [], branches: [], source_suggestions: [] };
  }

  const body = await res.json();
  const raw = (body.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const score = { surprise: 2, checkability: 2, mechanism: 2, visual: 2, timing: 2 };
    return { score, rank_value: rankFromScore(score), follow_ups: [], branches: [], source_suggestions: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as TurnMeta;
    const score = parsed.score ?? { surprise: 2, checkability: 2, mechanism: 2, visual: 2, timing: 2 };
    return {
      score,
      rank_value: rankFromScore(score),
      verdict: parsed.verdict ?? undefined,
      follow_ups: (parsed.follow_ups ?? []).slice(0, 4).map((f, i) => ({
        id: crypto.randomUUID(),
        prompt: f.prompt,
        intent: f.intent,
      })),
      branches: (parsed.branches ?? []).slice(0, 3).map((b) => ({
        id: crypto.randomUUID(),
        label: b.label,
      })),
      source_suggestions: parsed.source_suggestions ?? [],
    };
  } catch {
    const score = { surprise: 2, checkability: 2, mechanism: 2, visual: 2, timing: 2 };
    return { score, rank_value: rankFromScore(score), follow_ups: [], branches: [], source_suggestions: [] };
  }
}

export { rankFromScore };
