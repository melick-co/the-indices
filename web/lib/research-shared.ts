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
