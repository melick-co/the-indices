import { createClient } from '@/lib/supabase-server';
import {
  buildInputPrompt,
  extractAngleText,
  parseMonitoring,
  parseVerdict,
  SessionInput,
  SessionMessage,
} from '@/lib/research-shared';

export const MODEL = 'claude-sonnet-4-6';
export const MAX_TURNS = 8;

export const CHARTER = `
You are the research agent for Caveat, a data journalism publication.
Caveat's method: read the same data as everyone else, find the detail that changes
the story, and print the caveat rather than burying it.

ARCHETYPES you hunt, ranked:
1. Denominator flips — the ranking reverses when the base changes
2. Two-truths gaps — two related measures of the same thing disagree
3. Step changes dressed as trends — the "rise" is one jump
4. Rank surprises — especially about Australia
5. Viral claim checks — a shared figure collapses under a basis check
6. Divergence — two series that tracked for years split

SOURCE TIERS. Tier 1: OECD, World Bank, IMF, Eurostat, ABS, RBA, national
statistical offices. Tier 2: sector bodies, exchanges, central bank tables.
Tier 3: commercial and crowd-sourced aggregators, news outlets.
A headline claim MUST rest on tier 1 or 2. Tier 3 may colour, never carry.

HARD RULES:
- Never present an estimate as a published figure. Say which is which.
- Correlation is not insight without a mechanism a lay reader would accept.
- Mixed-basis arithmetic (PPP vs market rates, different reference years) is
  directional only, and you must say so.
- If the data does not support the question's premise, say that plainly. A
  question answered "no, and here is why" is a good outcome.
- Australian English. No em dashes.

You have two tools: query_data reads Caveat's own store; web_search finds
external sources. Prefer Caveat's own data where it covers the question, and use
the web to check currency, find newer vintages, or source what we lack.
`;

export const ASK_INSTRUCTIONS = `
Research the question. Then answer in this shape:

**Short answer** — two sentences, no hedging.

**What the data shows** — the specific figures, each with its source and period.
Mark anything derived or estimated.

**The rub** — the detail that changes the reading: the denominator, the basis,
the excluded years, the thing the obvious framing misses. If there isn't one,
say so.

**Caveat** — the first objection a hostile reader would raise.

**Verdict** — one of: PUBLISHABLE (stands up, has an angle), NEEDS WORK (true but
thin, or missing a tier 1 source), or KILLED (premise fails, or unfixable basis
problem). One line of why.
`;

export const BRAINSTORM_INSTRUCTIONS = `
This is a brainstorm, not a verdict. Generate 5 to 8 candidate angles on the
topic. For each angle use this exact block shape:

### Angle N: [headline-shaped finding, not a topic label]
- **Archetype:** ...
- **Data to check:** ...
- **In our store:** yes/no and which metric_ids if yes
- **Kill condition:** what would make this a non-story

Rank angles by how checkable they are, not how exciting. End with:

**Chase first:** one paragraph on the single angle you would pursue and why.
Do not assert findings you have not checked — these are hypotheses to test.

Then include monitoring suggestions:

**Monitor**
- **Topics:** keyword phrases for news watching (comma-separated)
- **Feeds:** RSS or Atom URLs worth adding, if any
- **Data releases:** official statistical releases to watch (name the agency and series)
`;

export async function loadMetricList() {
  const supabase = createClient();
  const { data: metrics } = await supabase.from('metrics')
    .select('metric_id, name, unit, source_org, source_tier, period');
  return (metrics ?? [])
    .map((m) => `- ${m.metric_id}: ${m.name} (${m.unit}, ${m.source_org} tier ${m.source_tier}, ${m.period})`)
    .join('\n');
}

export async function callClaude(system: string, question: string, metricList: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables (Production), then redeploy.',
    );
  }

  const supabase = createClient();
  const messages: any[] = [{ role: 'user', content: question }];
  const toolsUsed: string[] = [];

  const tools = [
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
    { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },
  ];

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
      if (b.type === 'tool_use' || b.type === 'server_tool_use') toolsUsed.push(b.name);
    }

    if (body.stop_reason !== 'tool_use') {
      const text = (body.content ?? [])
        .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return { text, toolsUsed };
    }

    messages.push({ role: 'assistant', content: body.content });
    const results: any[] = [];
    for (const b of body.content ?? []) {
      if (b.type !== 'tool_use' || b.name !== 'query_data') continue;
      let out: any;
      try {
        let q = supabase.from('observations_labelled').select('*')
          .eq('metric_id', b.input.metric_id);
        if (b.input.entity) q = q.eq('entity', b.input.entity);
        const { data, error } = await q.order('period').limit(Number(b.input.limit) || 60);
        out = error ? { error: error.message } : { rows: data };
      } catch (e: any) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
    }
    if (!results.length) {
      const text = (body.content ?? [])
        .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return { text, toolsUsed };
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'Research ran out of turns without concluding.', toolsUsed };
}

export { buildInputPrompt, extractAngleText, parseMonitoring, parseVerdict };
export type { SessionInput, SessionMessage };
