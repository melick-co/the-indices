/**
 * YouTube Data API v3: upload a race video as a Short, scheduled with YouTube's own publish time.
 *
 * Credentials are an OAuth client and a refresh token for the channel (web/scripts/youtube-auth.ts makes the token):
 * YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN. An upload costs 1,600 of the default 10,000 daily
 * quota units. Until Google audits the API project, uploads from it are locked private.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export const youtubeConfigured = () =>
  !!(process.env.YOUTUBE_CLIENT_ID?.trim() && process.env.YOUTUBE_CLIENT_SECRET?.trim() && process.env.YOUTUBE_REFRESH_TOKEN?.trim());

export async function youtubeToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID!.trim(), client_secret: process.env.YOUTUBE_CLIENT_SECRET!.trim(),
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN!.trim(), grant_type: 'refresh_token',
    }),
  });
  const body = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`YouTube sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

async function api<T>(token: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* keep text */ }
    throw new Error(`YouTube ${res.status}: ${msg}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** publishAt in the future: private now, public at that time (YouTube publishes it). Otherwise public now. */
const statusFor = (publishAt: Date | null) => ({
  privacyStatus: publishAt ? 'private' : 'public',
  ...(publishAt ? { publishAt: publishAt.toISOString() } : {}),
  selfDeclaredMadeForKids: false,
  embeddable: true,
});

export type YoutubeUpload = { title: string; description: string; tags: string[]; videoUrl: string; publishAt: Date | null };

/** Upload (resumable) and return the video id. */
export async function uploadVideo(token: string, u: YoutubeUpload): Promise<string> {
  const file = await fetch(u.videoUrl);
  if (!file.ok) throw new Error(`Could not fetch the video (${file.status}).`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const meta = {
    snippet: { title: u.title.slice(0, 100), description: u.description.slice(0, 4900), tags: u.tags, categoryId: '25', defaultLanguage: 'en-AU', defaultAudioLanguage: 'en-AU' },
    status: statusFor(u.publishAt),
  };
  const start = await fetch(UPLOAD, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(bytes.length) },
    body: JSON.stringify(meta),
  });
  const location = start.headers.get('location');
  if (!start.ok || !location) throw new Error(`YouTube upload refused (${start.status}): ${(await start.text()).slice(0, 300)}`);
  const put = await fetch(location, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) }, body: bytes });
  const done = await put.json() as { id?: string; error?: { message?: string } };
  if (!put.ok || !done.id) throw new Error(`YouTube upload failed (${put.status}): ${done.error?.message ?? 'no video id'}`);
  return done.id;
}

/** Move the scheduled publish time, publish now (null), or withdraw (private with no publish time). */
export async function setSchedule(token: string, id: string, publishAt: Date | null | 'withdraw') {
  const status = publishAt === 'withdraw' ? { privacyStatus: 'private', selfDeclaredMadeForKids: false, embeddable: true } : statusFor(publishAt);
  await api(token, `${API}/videos?part=status`, { method: 'PUT', body: JSON.stringify({ id, status }) });
}

/** The channel the credentials point at, so every run says where it is posting. */
export async function youtubeChannel(token: string): Promise<{ id: string; title: string } | null> {
  const r = await api<{ items?: { id: string; snippet: { title: string } }[] }>(token, `${API}/channels?part=snippet&mine=true`, { method: 'GET' });
  const c = r.items?.[0];
  return c ? { id: c.id, title: c.snippet.title } : null;
}

export const shortUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
export const idFromUrl = (url: string) => url.match(/(?:shorts\/|v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
