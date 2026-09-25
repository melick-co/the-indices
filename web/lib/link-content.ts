import { formatYoutubeTakeaways } from './context-takeaways';
import { fetchYoutubeTranscript, youtubeVideoId } from './youtube-transcript';

export { appendContextTakeaways, formatYoutubeTakeaways } from './context-takeaways';

const PAGE_UA = 'Caveat-Foundry/0.1 (+https://the-indices.vercel.app)';
const TRANSCRIPT_LIMIT = 16000;
const PAGE_LIMIT = 12000;

export type FetchedLink = {
  title: string;
  text: string;
  url: string;
  kind: 'youtube' | 'page';
  takeaways?: string;
};

export async function fetchLinkContent(url: string): Promise<
  { ok: true } & FetchedLink | { ok: false; error: string }
> {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Only http(s) links are supported.' };
    }

    if (youtubeVideoId(url)) {
      const transcript = await fetchYoutubeTranscript(url);
      const text = transcript.text.slice(0, TRANSCRIPT_LIMIT);
      const takeaways = await summariseTranscript(transcript.title, text);
      return {
        ok: true,
        title: transcript.title,
        text,
        url,
        kind: 'youtube',
        takeaways,
      };
    }

    const res = await fetch(url, {
      headers: { 'user-agent': PAGE_UA, accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `Fetch failed (${res.status})` };
    const raw = await res.text();
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? parsed.hostname;
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PAGE_LIMIT);
    return { ok: true, title, text, url, kind: 'page' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not fetch link';
    return { ok: false, error: msg };
  }
}

async function summariseTranscript(title: string, transcript: string): Promise<string | undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return `YouTube: ${title}. Transcript attached. Key takeaways could not be written because ANTHROPIC_API_KEY is not set.`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [
        'You summarise YouTube transcripts for a Caveat research session.',
        'Write 5 to 8 key takeaways as short bullets.',
        'Australian English. No em dashes.',
        'Facts, figures, claims and caveats only. No colour and no invented numbers.',
        'If a figure is unverified, say so.',
        'Return only the bullets, each on its own line starting with "- ".',
      ].join(' '),
      messages: [{
        role: 'user',
        content: `Title: ${title}\n\nTranscript:\n${transcript.slice(0, TRANSCRIPT_LIMIT)}`,
      }],
    }),
  });

  if (!res.ok) {
    return `YouTube: ${title}. Transcript attached. The summariser failed (${res.status}).`;
  }

  const body = await res.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const bullets = text.split('\n').map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
  return formatYoutubeTakeaways(title, bullets) || `YouTube: ${title}. Transcript attached.`;
}
