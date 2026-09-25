/**
 * YouTube captions via @hallelx/youtube-transcript, the TypeScript port of
 * jdepoix/youtube-transcript-api. Same youtubei/v1/player path as the Python tool.
 * Vercel datacentre IPs are often blocked; set WEBSHARE_PROXY_* or YOUTUBE_PROXY_* .
 * https://github.com/jdepoix/youtube-transcript-api
 * https://github.com/hallelx2/youtube-transcript-ts
 */

import {
  AgeRestricted,
  GenericProxyConfig,
  NoTranscriptFound,
  PoTokenRequired,
  RequestBlocked,
  TextFormatter,
  TranscriptsDisabled,
  VideoUnavailable,
  VideoUnplayable,
  WebshareProxyConfig,
  YouTubeTranscriptApi,
  type ProxyConfig,
} from '@hallelx/youtube-transcript';

const WATCH_URL = 'https://www.youtube.com/watch?v=';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const LANGS = ['en-AU', 'en-GB', 'en', 'en-US'];

export type YoutubeTranscript = {
  videoId: string;
  title: string;
  language: string;
  generated: boolean;
  text: string;
};

export type YoutubeLoad =
  | { ok: true; videoId: string; url: string; title: string; text: string; language: string; generated: boolean }
  | { ok: false; videoId: string; url: string; title: string; error: string };

export function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(normalizeHttpUrl(raw));
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

export function youtubeProxyConfig(env: Record<string, string | undefined> = process.env): ProxyConfig | undefined {
  const user = env.WEBSHARE_PROXY_USERNAME?.trim();
  const pass = env.WEBSHARE_PROXY_PASSWORD?.trim();
  if (user && pass) {
    return new WebshareProxyConfig({ proxyUsername: user, proxyPassword: pass });
  }

  const httpsUrl = env.YOUTUBE_PROXY_HTTPS?.trim();
  const httpUrl = env.YOUTUBE_PROXY_HTTP?.trim() || httpsUrl;
  if (httpUrl || httpsUrl) {
    return new GenericProxyConfig({
      httpUrl: httpUrl || httpsUrl,
      httpsUrl: httpsUrl || httpUrl,
    });
  }
  return undefined;
}

export function mapTranscriptError(error: unknown): string {
  if (error instanceof RequestBlocked || error instanceof PoTokenRequired) {
    return 'YouTube blocked the transcript request from this host.';
  }
  if (error instanceof AgeRestricted) {
    return 'This video is age-restricted, so captions cannot be fetched here.';
  }
  if (error instanceof TranscriptsDisabled || error instanceof NoTranscriptFound) {
    return 'This video has no captions to transcribe.';
  }
  if (error instanceof VideoUnavailable) {
    return 'This YouTube video is unavailable.';
  }
  if (error instanceof VideoUnplayable) {
    const reason = error.reason?.trim();
    if (reason?.includes('not a bot')) {
      return 'YouTube blocked the transcript request from this host.';
    }
    return reason
      ? `YouTube would not play this video (${reason}).`
      : 'YouTube would not play this video.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not transcribe this YouTube video.';
}

export async function loadYoutube(url: string): Promise<YoutubeLoad> {
  const clean = normalizeHttpUrl(url);
  const videoId = youtubeVideoId(clean);
  if (!videoId) return { ok: false, videoId: '', url: clean, title: clean, error: 'That does not look like a YouTube link.' };
  const canonical = `${WATCH_URL}${videoId}`;
  try {
    const transcript = await fetchYoutubeTranscript(canonical);
    return {
      ok: true,
      videoId,
      url: canonical,
      title: transcript.title,
      text: transcript.text,
      language: transcript.language,
      generated: transcript.generated,
    };
  } catch (e: unknown) {
    const title = await lookupYoutubeTitle(videoId, canonical) || `YouTube ${videoId}`;
    return { ok: false, videoId, url: canonical, title, error: mapTranscriptError(e) };
  }
}

export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscript> {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('That does not look like a YouTube link.');

  const api = new YouTubeTranscriptApi({ proxyConfig: youtubeProxyConfig() });
  const [fetched, title] = await Promise.all([
    api.fetch(videoId, { languages: LANGS }),
    lookupYoutubeTitle(videoId, `${WATCH_URL}${videoId}`),
  ]);

  const text = new TextFormatter().formatTranscript(fetched).replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('The caption track was empty.');

  return {
    videoId,
    title: title || `YouTube ${videoId}`,
    language: fetched.languageCode || 'en',
    generated: fetched.isGenerated,
    text,
  };
}

async function lookupYoutubeTitle(videoId: string, canonical: string): Promise<string | null> {
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
      { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    if (oembed.ok) {
      const body = await oembed.json() as { title?: string };
      if (body.title?.trim()) return body.title.trim();
    }
  } catch { /* fall through */ }
  try {
    const html = await fetchText(`${WATCH_URL}${videoId}`);
    return titleFromHtml(html);
  } catch {
    return null;
  }
}

function titleFromHtml(html: string): string | null {
  const raw = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!raw) return null;
  const title = decodeEntities(raw.replace(/\s*-\s*YouTube\s*$/i, '').trim());
  return title || null;
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
