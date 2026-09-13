export type SessionInput = {
  id: string;
  type: 'text' | 'link' | 'file';
  label?: string;
  content?: string;
  url?: string;
  fileName?: string;
};

export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: string;
};

export type FoundryIntent = 'investigate' | 'brainstorm' | 'refine' | 'precedents';

export type FoundryScore = {
  surprise: number;
  checkability: number;
  mechanism: number;
  visual: number;
  timing: number;
};

/** One tool call in a run, from request through to result. */
export type FoundryToolStep = {
  id?: string;
  name: string;
  label: string;
  detail?: string;
  at: string;
  status?: 'running' | 'done';
  result?: string;
  ms?: number;
};

export type FoundryMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
  intent?: FoundryIntent;
  tool_steps?: FoundryToolStep[];
  follow_ups?: { id: string; prompt: string; intent?: string }[];
  score?: FoundryScore & { rank_value?: number };
  verdict?: 'publishable' | 'needs_work' | 'killed';
  branches?: { id: string; label: string; fork_session_id?: string }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    /** Prefix tokens served from the prompt cache, billed at a tenth of a fresh read. */
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
};

export function normalizeMessages(raw: unknown): FoundryMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m: Record<string, unknown>) => ({
    id: String(m.id ?? crypto.randomUUID()),
    role: (m.role as FoundryMessage['role']) ?? 'user',
    content: String(m.content ?? ''),
    at: String(m.at ?? new Date().toISOString()),
    intent: m.intent as FoundryIntent | undefined,
    tool_steps: m.tool_steps as FoundryMessage['tool_steps'],
    follow_ups: m.follow_ups as FoundryMessage['follow_ups'],
    score: m.score as FoundryMessage['score'],
    verdict: m.verdict as FoundryMessage['verdict'],
    branches: m.branches as FoundryMessage['branches'],
    usage: m.usage as FoundryMessage['usage'],
  }));
}

export function newMessage(
  role: FoundryMessage['role'],
  content: string,
  extra?: Partial<FoundryMessage>,
): FoundryMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    at: new Date().toISOString(),
    ...extra,
  };
}

export type MonitoringSuggestion = {
  topics: { label: string; keywords: string[] }[];
  feeds: { url: string; name: string }[];
  dataSources: string[];
};

export function parseMonitoring(text: string): MonitoringSuggestion {
  const block = text.split(/\*\*Monitor\*\*/i)[1] ?? '';
  const topicsLine = /Topics:\s*(.+)/i.exec(block)?.[1] ?? '';
  const feedsBlock = block.match(/Feeds:([\s\S]*?)(?:\n-\s*\*\*|$)/i)?.[1] ?? '';
  const releasesLine = /Data releases:\s*(.+)/i.exec(block)?.[1] ?? '';

  const topics = topicsLine.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((label) => ({
    label,
    keywords: label.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
  }));

  const feeds: { url: string; name: string }[] = [];
  for (const m of feedsBlock.matchAll(/https?:\/\/[^\s,)]+/g)) {
    try {
      feeds.push({ url: m[0], name: new URL(m[0]).hostname });
    } catch { feeds.push({ url: m[0], name: m[0] }); }
  }

  const dataSources = releasesLine.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return { topics, feeds, dataSources };
}

export function parseAngles(text: string) {
  const matches = [...text.matchAll(/### Angle \d+:\s*(.+?)(?=\n|$)/gi)];
  return matches.map((m, i) => ({
    index: i,
    headline: m[1].trim(),
    block: m[0],
  }));
}

export function extractAngleText(text: string, headline: string) {
  const re = new RegExp(
    `### Angle \\d+:\\s*${headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=### Angle|\\*\\*Chase first|\\*\\*Monitor|$)`,
    'i',
  );
  const match = re.exec(text);
  return (match?.[0] ?? text).slice(0, 1200);
}

export function buildInputPrompt(prompt: string, inputs: SessionInput[]) {
  const parts = [prompt.trim()].filter(Boolean);
  for (const input of inputs) {
    if (input.type === 'text' && input.content?.trim()) parts.push(`[Note]\n${input.content.trim()}`);
    if (input.type === 'link' && input.content?.trim()) {
      parts.push(`[Link: ${input.url ?? input.label ?? 'source'}]\n${input.content.trim()}`);
    }
    if (input.type === 'file' && input.content?.trim()) {
      parts.push(`[File: ${input.fileName ?? 'upload'}]\n${input.content.trim().slice(0, 12000)}`);
    }
  }
  return parts.join('\n\n');
}

export function parseVerdict(text: string) {
  const v = /VERDICT[^A-Z]*(PUBLISHABLE|NEEDS WORK|KILLED)/i.exec(text)?.[1]
    ?.toLowerCase().replace(' ', '_') ?? null;
  return v === 'needs_work' ? 'needs_work' : v;
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'and', 'but', 'if', 'or', 'not', 'what', 'which',
  'who', 'how', 'when', 'where', 'why', 'this', 'that', 'these', 'those', 'be', 'been', 'being',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'any', 'all', 'each', 'few', 'more', 'most', 'some', 'such',
  'than', 'too', 'very', 'just', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'because', 'until', 'while', 'although', 'though', 'am', 'does', 'did', 'doing', 'done',
]);

/** Derive a tracked-topic label and RSS keywords from session text. */
export function deriveTopicFromText(text: string) {
  const trimmed = text.trim();
  const label = trimmed.slice(0, 80) || 'Untitled topic';
  const words = trimmed
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const keywords = [...new Set(words)].slice(0, 8);
  return {
    label,
    keywords: keywords.length ? keywords : label.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 5),
  };
}
