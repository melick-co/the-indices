/** Prompt templates when routing a curated feed item into Ask or Brainstorm. */

export type FeedItemPromptSource = {
  title: string;
  link?: string | null;
  summary?: string | null;
};

export function feedSessionTitle(item: FeedItemPromptSource): string {
  const t = item.title.trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

export function buildAskPrompt(item: FeedItemPromptSource): string {
  const parts = [
    `What's the claim in "${item.title}" and does our data support or contradict it?`,
  ];
  if (item.summary?.trim()) parts.push(`\n\nContext: ${item.summary.trim().slice(0, 400)}`);
  if (item.link) parts.push(`\n\nSource: ${item.link}`);
  return parts.join('');
}

export function buildBrainstormPrompt(item: FeedItemPromptSource): string {
  const parts = [`Brainstorm Caveat angles on: ${item.title}`];
  if (item.summary?.trim()) parts.push(`\n\n${item.summary.trim().slice(0, 600)}`);
  if (item.link) parts.push(`\n\nSource: ${item.link}`);
  return parts.join('');
}
