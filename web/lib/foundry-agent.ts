import { cpiId, cpiMeta, cpiObservations, isCpiId } from '../../agent/scripts/lib/cpi-components.mjs';
import { createClient } from '@/lib/supabase-server';
import { sydneyTime } from '@/lib/events';
import { publisherOf } from '../../agent/scripts/lib/html-text.mjs';
import {
  ASK_INSTRUCTIONS,
  BRAINSTORM_INSTRUCTIONS,
  CHARTER,
  loadMetricList,
  MODEL,
  MAX_TURNS,
} from '@/lib/research-agent';
import type { FoundryMessage, FoundryScore, FoundryIntent } from '@/lib/research-shared';
import { cachedSystem, readUsage, withCachedPrefix } from '@/lib/prompt-cache';

export type FoundryEvent =
  // `id` pairs a result with its call. Coarse pipeline steps elsewhere omit it and key on `name`.
  | { type: 'tool_start'; id?: string; name: string; label: string; detail?: string; at: string }
  | { type: 'tool_result'; id?: string; name: string; label: string; detail?: string; at: string; ms?: number }
  | {
      type: 'usage';
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
    }
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
    case 'add_watch_item':
      return `Adding to the watch list: ${String(input.title ?? '').slice(0, 50)}`;
    case 'cpi_components':
      return `Reading CPI components${input.query ? ` (${String(input.query).slice(0, 30)})` : ''}`;
    default:
      return name;
  }
}

/** One-line summary of a tool result, for the run transcript. */
function resultDetail(name: string, out: unknown): string | undefined {
  const o = (out ?? {}) as Record<string, unknown>;
  if (typeof o.error === 'string') return `error · ${o.error.slice(0, 80)}`;
  switch (name) {
    case 'query_data':
      return `${(o.rows as unknown[] | undefined)?.length ?? 0} observations`;
    case 'search_metrics':
      return `${(o.metrics as unknown[] | undefined)?.length ?? 0} metrics`;
    case 'cpi_components':
      return `${(o.items as unknown[] | undefined)?.length ?? 0} items, ${String(o.period ?? '')}`;
    case 'lookup_sources':
      return `${(o.sources as unknown[] | undefined)?.length ?? 0} sources`;
    case 'fetch_url': {
      const words = String(o.text ?? '').split(/\s+/).filter(Boolean).length;
      const cached = o.cached ? ' · cached' : '';
      return `${o.title ? `${String(o.title).slice(0, 50)} · ` : ''}${words} words${cached}`;
    }
    default:
      return undefined;
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

/**
 * Research found a scheduled release, decision or recurring report that will move a story's numbers: put it
 * on the newsroom watch list (events, or watch_rules for recurring items). Whether it is official is decided
 * by its source domain, not the model: private sources are reminders, never citable figures.
 */
async function addWatchItem(input: Record<string, unknown>) {
  const supabase = createClient();
  const title = String(input.title ?? '').trim();
  const institution = String(input.institution ?? '').trim();
  if (!title || !institution) return { error: 'title and institution are required' };
  const sourceUrl = input.source_url ? String(input.source_url) : null;
  const official = Boolean(sourceUrl && publisherOf(sourceUrl));
  const series = `foundry:${`${institution} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
  const metricIds = Array.isArray(input.metric_ids) ? (input.metric_ids as unknown[]).map(String) : [];
  const notes = input.reason ? String(input.reason).slice(0, 500) : null;
  const recurrence = input.recurrence ? String(input.recurrence) : '';
  if (recurrence) {
    if (!['weekly', 'fortnightly', 'monthly', 'quarterly'].includes(recurrence)) return { error: 'recurrence must be weekly, fortnightly, monthly or quarterly' };
    const { error } = await supabase.from('watch_rules').upsert({
      institution, title, series, cadence: recurrence,
      weekday: input.weekday != null ? Number(input.weekday) : null,
      day_of_month: input.day_of_month != null ? Number(input.day_of_month) : null,
      time_local: String(input.time_local ?? '10:00'), official, source_url: sourceUrl, metric_ids: metricIds,
      notes, origin: 'foundry',
    }, { onConflict: 'series', ignoreDuplicates: true });
    return error ? { error: error.message } : { added: 'recurring rule', series, official };
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.date ?? ''));
  if (!date) return { error: 'give a date (YYYY-MM-DD) or a recurrence' };
  const [hh, mm] = String(input.time_local ?? '11:30').split(':').map(Number);
  const at = sydneyTime(Number(date[1]), Number(date[2]), Number(date[3]), hh || 0, mm || 0);
  if (at.getTime() < Date.now()) return { error: 'that date has passed' };
  const { error } = await supabase.from('events').upsert({
    event_key: `${series}:${date[0]}`, kind: 'announcement', institution, series, title,
    scheduled_at: at.toISOString(), status: 'scheduled', metric_ids: metricIds, source_url: sourceUrl,
    official, origin: 'foundry', notes,
  }, { onConflict: 'event_key', ignoreDuplicates: true });
  return error ? { error: error.message } : { added: 'event', event_key: `${series}:${date[0]}`, official };
}

async function executeTool(name: string, input: Record<string, unknown>) {
  const supabase = createClient();
  if (name === 'query_data') {
    if (isCpiId(String(input.metric_id))) {
      const entity = String(input.entity ?? 'AUS').toUpperCase();
      const obs = (await cpiObservations(supabase, String(input.metric_id))).filter((o) => o.entity === entity);
      const meta = await cpiMeta(supabase, String(input.metric_id));
      return { metric: meta, rows: obs.slice(-(Number(input.limit) || 60)) };
    }
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
  if (name === 'add_watch_item') {
    return addWatchItem(input);
  }
  if (name === 'cpi_components') {
    return cpiComponents(input);
  }
  return { error: `Unknown tool: ${name}` };
}

/**
 * The CPI broken into the items it is measured against (cpi_items / cpi_observations): one period's readings
 * for the children of an item (default: the 11 groups), or items matching a name. Each comes with the cpi: ids
 * that query_data, charts and the fact checks accept.
 */
async function cpiComponents(input: Record<string, unknown>) {
  const supabase = createClient();
  const frequency = String(input.frequency ?? 'M').toUpperCase() === 'Q' ? 'Q' : 'M';
  const entity = String(input.entity ?? 'AUS').toUpperCase();
  let items = supabase.from('cpi_items').select('index_code, name, level, series_type, sort_order, parent_code');
  if (input.query) items = items.ilike('name', `%${String(input.query).trim()}%`);
  else items = items.eq('parent_code', String(input.parent ?? '10001'));
  const { data: list, error } = await items.order('sort_order').limit(60);
  if (error) return { error: error.message };
  if (!list?.length) return { error: 'No CPI items match. Try a broader name, or parent 10001 for the groups.' };
  const codes = list.map((i) => i.index_code);
  let period = input.period ? String(input.period) : null;
  if (!period) {
    const { data: latest } = await supabase.from('cpi_observations').select('period')
      .eq('index_code', '10001').eq('entity', entity).eq('frequency', frequency)
      .order('period', { ascending: false }).limit(1);
    period = latest?.[0]?.period ?? null;
  }
  if (!period) return { error: 'No CPI readings stored yet.' };
  const [{ data: obs }, { data: weights }] = await Promise.all([
    supabase.from('cpi_observations')
      .select('index_code, adjustment, index_value, change_period, change_annual, contribution_period_pts, contribution_annual_pts')
      .in('index_code', codes).eq('entity', entity).eq('frequency', frequency).eq('period', period),
    supabase.from('cpi_weights').select('index_code, period, weight_pct')
      .in('index_code', codes).eq('entity', entity).order('period', { ascending: false }),
  ]);
  const q = frequency === 'Q';
  return {
    period, frequency, entity,
    note: 'Cite a figure by calling query_data with its id first (ids are checkable like any stored metric). '
      + "When reporting CPI, give headline and trimmed mean (999902) together; the trimmed mean is the RBA's preferred measure of underlying inflation.",
    items: list.map((i) => {
      const rows = (obs ?? []).filter((o) => o.index_code === i.index_code);
      const r = rows.find((o) => o.adjustment === 'original') ?? rows[0];
      const sa = !rows.some((o) => o.adjustment === 'original');
      return {
        index_code: i.index_code, name: i.name, level: i.level, series_type: i.series_type,
        weight_pct: weights?.find((w) => w.index_code === i.index_code)?.weight_pct ?? null,
        index: r?.index_value ?? null, change_period: r?.change_period ?? null, change_annual: r?.change_annual ?? null,
        contribution_annual_pts: r?.contribution_annual_pts ?? null,
        ids: {
          annual: cpiId(i.index_code, 'annual', { quarterly: q, sa }),
          period: cpiId(i.index_code, 'period', { quarterly: q, sa }),
          contrib_annual: cpiId(i.index_code, 'contrib_annual', { quarterly: q, sa }),
        },
      };
    }),
  };
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
    {
      name: 'add_watch_item',
      description:
        'Put an upcoming release, decision, announcement or recurring report on the newsroom watch list when your ' +
        'research finds one that will move the numbers in this story (e.g. "ABS releases the September CPI on ' +
        '28 October", "Cotality publishes clearance rates every Tuesday", "the Fair Work annual wage review ' +
        'decision is due in June"). Give a date for one-off items or a recurrence for regular ones, and the ' +
        'official URL where it will appear. Items from non-official sources are kept as reminders only.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What will be released or decided' },
          institution: { type: 'string', description: 'Who publishes it, e.g. ABS, RBA, Treasury, Cotality' },
          date: { type: 'string', description: 'YYYY-MM-DD for a one-off item' },
          time_local: { type: 'string', description: 'Sydney time HH:MM if known (ABS 11:30, RBA decisions 14:30)' },
          recurrence: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly', 'quarterly'] },
          weekday: { type: 'number', description: 'For weekly/fortnightly: 0 = Sunday … 6 = Saturday' },
          day_of_month: { type: 'number', description: 'For monthly/quarterly' },
          source_url: { type: 'string', description: 'Where it will be published' },
          metric_ids: { type: 'array', items: { type: 'string' }, description: 'Stored series it will move, if any' },
          reason: { type: 'string', description: 'Why it matters to this story' },
        },
        required: ['title', 'institution'],
      },
    },
    {
      name: 'cpi_components',
      description:
        'The CPI broken into everything it is measured against (ABS: 11 groups, subgroups, expenditure classes such ' +
        'as electricity, rents, insurance, plus analytical series like the trimmed mean, code 999902). Returns one ' +
        "period's index, change and annual change, contribution to annual inflation and basket weight per item, " +
        'monthly or quarterly, for Australia or a capital city, with ids (cpi:<code>:<measure>) that query_data ' +
        'reads for history and that charts and the fact checks accept.',
      input_schema: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Item code whose children to list (default 10001 = All groups → the 11 groups)' },
          query: { type: 'string', description: 'Or find items by name, e.g. electricity, rents, trimmed mean' },
          period: { type: 'string', description: 'YYYY-MM (monthly) or YYYY-Qn (quarterly); default latest' },
          frequency: { type: 'string', enum: ['M', 'Q'] },
          entity: { type: 'string', description: 'AUS (default), SYD, MEL, BNE, ADL, PER, HOB, DRW or CBR' },
        },
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
  /** Abort mid-loop when the editor interrupts the run. */
  signal?: AbortSignal;
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

  // Tool calls the model has opened but not yet closed. Anything still open when a
  // model turn ends is reported as finished so the transcript never stalls.
  const openTools = new Map<string, { name: string; label: string; startedAt: number }>();
  const closeTool = (id: string, detail?: string) => {
    const open = openTools.get(id);
    if (!open) return;
    openTools.delete(id);
    options.onEvent({
      type: 'tool_result',
      id,
      name: open.name,
      label: open.label,
      detail,
      at: new Date().toISOString(),
      ms: Date.now() - open.startedAt,
    });
  };
  const closeAllTools = () => {
    for (const id of [...openTools.keys()]) closeTool(id);
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (options.signal?.aborted) {
      closeAllTools();
      throw new DOMException('Run interrupted', 'AbortError');
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
        max_tokens: 4000,
        system: cachedSystem(system),
        tools,
        messages: withCachedPrefix(messages),
      }),
      signal: options.signal,
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
    if (body.usage) {
      options.onEvent({ type: 'usage', ...readUsage(body.usage) });
    }

    for (const b of body.content ?? []) {
      if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        const id = String(b.id ?? crypto.randomUUID());
        const label = toolLabel(b.name, b.input ?? {});
        toolsUsed.push(b.name);
        openTools.set(id, { name: b.name, label, startedAt: Date.now() });
        options.onEvent({
          type: 'tool_start',
          id,
          name: b.name,
          label,
          detail: b.name === 'query_data' ? String(b.input?.metric_id ?? '') : undefined,
          at: new Date().toISOString(),
        });
      }
      // Server-side web search returns its results inline in the same response.
      if (b.type === 'web_search_tool_result') {
        const hits = Array.isArray(b.content) ? b.content.length : 0;
        closeTool(String(b.tool_use_id ?? ''), hits ? `${hits} results` : undefined);
      }
    }

    if (body.stop_reason !== 'tool_use') {
      closeAllTools();
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
      const out = await executeTool(b.name, b.input ?? {});
      closeTool(String(b.id), resultDetail(b.name, out));
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
    }
    closeAllTools();
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
  "source_suggestions": [{ "action": "register_data_source|register_rss_feed", "summary": "...", "payload": { "url": "...", "name": "...", "org": "...", "tier": 1, "cadence": "monthly", "series": "the specific recurring statistic, e.g. 'ABS CPI rents, annual change, Australia'", "why": "..." } }]
}
Give 2-4 follow_ups. branches only if genuinely surprising. source_suggestions only for tier 1/2 sources explicitly worth farming.
For register_data_source, suggest one when the research cites a credible recurring statistic that Caveat's store does not hold, and name it in payload.series; the source scout will try to load it.`,
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
