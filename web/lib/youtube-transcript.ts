/**
 * TypeScript port of jdepoix/youtube-transcript-api's fetch path:
 * watch HTML → Innertube player (ANDROID client) → caption track XML.
 * https://github.com/jdepoix/youtube-transcript-api
 */

const WATCH_URL = 'https://www.youtube.com/watch?v=';
const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?key=';
const INNERTUBE_CONTEXT = { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } };
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const LANGS = ['en-AU', 'en-GB', 'en', 'en-US'];

export type YoutubeTranscript = {
  videoId: string;
  title: string;
  language: string;
  generated: boolean;
  text: string;
};

export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    return validId(url.pathname.split('/').filter(Boolean)[0]);
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com'
    && host !== 'youtube-nocookie.com') {
    return null;
  }
  const fromQuery = url.searchParams.get('v');
  if (fromQuery) return validId(fromQuery);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') {
    return validId(parts[1]);
  }
  return null;
}

function validId(id?: string | null): string | null {
  if (!id) return null;
  return /^[\w-]{11}$/.test(id) ? id : null;
}

export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscript> {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('That does not look like a YouTube link.');

  const html = await fetchWatchHtml(videoId);
  if (html.includes('g-recaptcha') && !html.includes('ytInitialPlayerResponse')) {
    throw new Error('YouTube blocked the transcript request from this host.');
  }

  const player = extractPlayerResponse(html) ?? await fetchInnertubePlayerFromHtml(html, videoId);
  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = String(player?.playabilityStatus?.reason ?? 'unplayable');
    if (reason.includes('not a bot')) {
      throw new Error('YouTube blocked the transcript request from this host.');
    }
    if (reason.toLowerCase().includes('inappropriate')) {
      throw new Error('This video is age-restricted, so captions cannot be fetched here.');
    }
    throw new Error(`YouTube would not play this video (${reason}).`);
  }

  const captions = player?.captions?.playerCaptionsTracklistRenderer;
  const tracks = (captions?.captionTracks ?? []) as Array<{
    baseUrl?: string;
    languageCode?: string;
    kind?: string;
    name?: { runs?: { text?: string }[] };
  }>;
  if (!tracks.length) {
    throw new Error('This video has no captions to transcribe.');
  }

  const track = pickTrack(tracks);
  if (!track?.baseUrl) throw new Error('This video has no captions to transcribe.');

  const captionUrl = track.baseUrl.replace('&fmt=srv3', '');
  const xml = await fetchText(captionUrl);
  const text = parseCaptionXml(xml);
  if (!text) throw new Error('The caption track was empty.');

  const title = decodeEntities(
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s*-\s*YouTube\s*$/i, '').trim()
    ?? `YouTube ${videoId}`,
  );

  return {
    videoId,
    title,
    language: track.languageCode ?? 'en',
    generated: track.kind === 'asr',
    text,
  };
}

function pickTrack(tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>) {
  const manual = tracks.filter((t) => t.kind !== 'asr');
  const generated = tracks.filter((t) => t.kind === 'asr');
  for (const lang of LANGS) {
    const hit = manual.find((t) => t.languageCode === lang) ?? generated.find((t) => t.languageCode === lang);
    if (hit) return hit;
  }
  return manual[0] ?? generated[0] ?? tracks[0];
}

async function fetchWatchHtml(videoId: string): Promise<string> {
  const first = await fetchText(`${WATCH_URL}${videoId}`);
  if (!first.includes('action="https://consent.youtube.com/s"')) return first;
  const token = first.match(/name="v" value="([^"]+)"/)?.[1];
  if (!token) throw new Error('Could not accept YouTube consent.');
  return fetchText(`${WATCH_URL}${videoId}`, { cookie: `CONSENT=YES+${token}` });
}

function extractPlayerResponse(html: string): any | null {
  const assign = html.indexOf('ytInitialPlayerResponse = {');
  const idx = assign >= 0 ? assign : html.indexOf('ytInitialPlayerResponse={');
  if (idx < 0) return null;
  const start = html.indexOf('{', idx);
  if (start < 0) return null;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = start; i < html.length && i < start + 2_500_000; i++) {
    const ch = html[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function fetchInnertubePlayerFromHtml(html: string, videoId: string) {
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1];
  if (!apiKey) throw new Error('Could not read this YouTube page.');
  const res = await fetch(`${INNERTUBE_API_URL}${apiKey}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      'accept-language': 'en-AU,en;q=0.9',
    },
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, videoId }),
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (res.status === 429) throw new Error('YouTube blocked the transcript request from this host.');
  if (!res.ok) throw new Error(`YouTube player request failed (${res.status}).`);
  return res.json() as Promise<any>;
}

async function fetchText(url: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'en-AU,en;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (res.status === 429) throw new Error('YouTube blocked the transcript request from this host.');
  if (!res.ok) throw new Error(`YouTube request failed (${res.status}).`);
  return res.text();
}

export function parseCaptionXml(xml: string): string {
  const snippets = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return snippets.join(' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
