export function appendContextTakeaways(context: string, takeaways: string): string {
  const block = takeaways.trim();
  if (!block) return context;
  if (!context.trim()) return block;
  return `${context.trim()}\n\n${block}`;
}

export function formatYoutubeTakeaways(title: string, bullets: string[]): string {
  const lines = bullets.map((b) => `- ${b.replace(/^[-*]\s+/, '').trim()}`).filter((b) => b.length > 2);
  if (!lines.length) return '';
  return `Key takeaways from ${title}:\n${lines.join('\n')}`;
}

export function formatYoutubeUnavailable(title: string, url: string, reason: string): string {
  return [
    `YouTube: ${title}`,
    url,
    '',
    `Could not transcribe captions. ${reason}`,
    'The link is attached to this session. Add notes from the video here, or try fetch again.',
  ].join('\n');
}
