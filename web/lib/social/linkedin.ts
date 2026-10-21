/**
 * LinkedIn's official Community Management API: post to The Caveat's Company Page. Never browser automation.
 *
 * Credentials (web/scripts/linkedin-auth.ts makes the token): LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
 * LINKEDIN_REFRESH_TOKEN and LINKEDIN_ORG_URN (urn:li:organization:{id}). The app needs the Community Management API
 * product and the w_organization_social and r_organization_social scopes; the member who signs in must be an
 * ADMINISTRATOR or CONTENT_ADMIN of the page. LinkedIn issues programmatic refresh tokens (365 days, fixed from the
 * first consent) only to approved apps; if the consent returned no refresh token, LINKEDIN_ACCESS_TOKEN (60 days) is
 * used instead and the helper must be run again before it lapses.
 *
 * Docs (checked 21 Oct 2026, version 202610):
 *   Posts API   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *   Images API  https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
 *   little text https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 *   Refresh     https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
 *   OAuth       https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *
 * Videos (race clips) are not uploaded: a race posts as its poster image with the link in the text. The Videos API
 * (initializeUpload, chunked PUT, finalizeUpload) can be added later.
 */

/**
 * The API version sent on every call, YYYYMM. LinkedIn supports each monthly version for about a year, then sunsets
 * it (202511 sunsets on 16 November 2026), and calls on a sunset version fail. Bump this once or twice a year, after
 * checking the migration notes: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations
 */
export const LINKEDIN_VERSION = '202610';

const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com/rest';

const env = (k: string) => process.env[k]?.trim() || '';
export const linkedinOrg = () => env('LINKEDIN_ORG_URN');
export const linkedinConfigured = () =>
  !!(env('LINKEDIN_CLIENT_ID') && env('LINKEDIN_CLIENT_SECRET') && /^urn:li:organization:\d+$/.test(linkedinOrg()) && (env('LINKEDIN_REFRESH_TOKEN') || env('LINKEDIN_ACCESS_TOKEN')));

/** An API failure, sorted so the poster knows whether to stop (token, permission, rate limit) or carry on. */
export class LinkedinError extends Error {
  constructor(message: string, readonly status: number, readonly kind: 'token' | 'permission' | 'rate' | 'gone' | 'other', readonly retryAfter?: number) {
    super(message);
  }
}

export function linkedinError(status: number, detail: string, retryAfter?: string | null): LinkedinError {
  if (status === 401) return new LinkedinError(`LinkedIn 401: the access token is missing, expired or revoked. Run scripts/linkedin-auth.ts again and update LINKEDIN_REFRESH_TOKEN. (${detail})`, status, 'token');
  if (status === 403) return new LinkedinError(`LinkedIn 403: the app lacks the Community Management API product or the w_organization_social scope, or the signed-in member is not an admin of the page. (${detail})`, status, 'permission');
  if (status === 429) {
    const s = Number(retryAfter);
    return new LinkedinError(`LinkedIn 429: rate limited; backing off until the next run. (${detail})`, status, 'rate', Number.isFinite(s) ? s : undefined);
  }
  if (status === 404) return new LinkedinError(`LinkedIn 404: not found. (${detail})`, status, 'gone');
  return new LinkedinError(`LinkedIn ${status}: ${detail}`, status, 'other');
}

/** Swap the refresh token for an access token (or use a stored 60-day access token). */
export async function linkedinToken(f: typeof fetch = fetch): Promise<string> {
  const refresh = env('LINKEDIN_REFRESH_TOKEN');
  if (!refresh) {
    const access = env('LINKEDIN_ACCESS_TOKEN');
    if (!access) throw new LinkedinError('LinkedIn: no LINKEDIN_REFRESH_TOKEN or LINKEDIN_ACCESS_TOKEN.', 401, 'token');
    return access;
  }
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: env('LINKEDIN_CLIENT_ID'), client_secret: env('LINKEDIN_CLIENT_SECRET') }),
  });
  const body = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new LinkedinError(`LinkedIn sign-in failed (${res.status}): ${body.error_description ?? body.error ?? 'no access token'}. The refresh token lasts 365 days from the first consent; run scripts/linkedin-auth.ts again.`, 401, 'token');
  }
  return body.access_token;
}

export const linkedinHeaders = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  'Linkedin-Version': LINKEDIN_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
  ...extra,
});

async function call(token: string, path: string, init: RequestInit, f: typeof fetch): Promise<Response> {
  const res = await f(`${API}${path}`, { ...init, headers: linkedinHeaders(token, (init.headers ?? {}) as Record<string, string>) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 300);
    try { detail = (JSON.parse(text) as { message?: string }).message ?? detail; } catch { /* keep text */ }
    throw linkedinError(res.status, detail || res.statusText, res.headers.get('retry-after'));
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------- bodies (pure)

/**
 * Escape commentary for LinkedIn's "little" text format: every reserved character is escaped with a backslash, or
 * the post fails or renders wrong. A # that starts a word stays a hashtag.
 */
export function escapeLittle(text: string): string {
  return text
    .replace(/[\\|{}@[\]()<>*_~]/g, (c) => `\\${c}`)
    .replace(/#/g, (c, i: number, s: string) => ((i === 0 || /\s/.test(s[i - 1])) && /[\p{L}\p{N}_]/u.test(s[i + 1] ?? '') ? c : `\\${c}`));
}

type Base = { author: string; commentary: string };
const base = (b: Base) => ({
  author: b.author,
  commentary: escapeLittle(b.commentary),
  visibility: 'PUBLIC',
  distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [] as unknown[], thirdPartyDistributionChannels: [] as unknown[] },
  lifecycleState: 'PUBLISHED',
  isReshareDisabledByAuthor: false,
});

/** A post with an article card. The API does not scrape the page: title, description and thumbnail are set here. */
export function buildArticlePost(b: Base & { url: string; title: string; description?: string | null; thumbnail?: string | null }) {
  return {
    ...base(b),
    content: {
      article: {
        source: b.url,
        title: b.title.slice(0, 200),
        ...(b.description ? { description: b.description.slice(0, 300) } : {}),
        ...(b.thumbnail ? { thumbnail: b.thumbnail } : {}),
      },
    },
  };
}

/** A single-image post (the image is an urn:li:image from uploadImage). */
export function buildImagePost(b: Base & { image: string; altText?: string | null }) {
  return { ...base(b), content: { media: { id: b.image, ...(b.altText ? { altText: b.altText.slice(0, 4000) } : {}) } } };
}

export const postUrl = (urn: string) => `https://www.linkedin.com/feed/update/${urn}`;
export const urnFromUrl = (url: string) => url.match(/urn:li:(?:share|ugcPost):\d+/)?.[0] ?? null;

// ---------------------------------------------------------------------------------------------------- calls

/** Upload an image (JPG, PNG or GIF) from a URL; returns its urn:li:image. */
export async function uploadImage(token: string, owner: string, imageUrl: string, f: typeof fetch = fetch): Promise<string> {
  const file = await f(imageUrl);
  if (!file.ok) throw new Error(`Could not fetch the image (${file.status}).`);
  const type = (file.headers.get('content-type') ?? '').split(';')[0].trim();
  if (type && !/^image\/(jpeg|png|gif)$/.test(type)) throw new Error(`LinkedIn takes JPG, PNG or GIF, not ${type}.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const init = await call(token, '/images?action=initializeUpload', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initializeUploadRequest: { owner } }),
  }, f);
  const { value } = await init.json() as { value?: { uploadUrl?: string; image?: string } };
  if (!value?.uploadUrl || !value.image) throw new Error('LinkedIn image upload: no upload URL returned.');
  const put = await f(value.uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: bytes });
  if (!put.ok) throw linkedinError(put.status, `image upload ${(await put.text().catch(() => '')).slice(0, 200)}`, put.headers.get('retry-after'));
  return value.image;
}

/** Create a post; returns its URN (from the x-restli-id header). */
export async function createPost(token: string, body: object, f: typeof fetch = fetch): Promise<string> {
  const res = await call(token, '/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, f);
  const urn = res.headers.get('x-restli-id');
  if (!urn) throw new Error('LinkedIn created the post but returned no x-restli-id.');
  return urn;
}

/** Delete a post (for a piece held or removed after it went out). Deleting twice is fine; a missing post is gone. */
export async function deletePost(token: string, urn: string, f: typeof fetch = fetch): Promise<void> {
  try {
    await call(token, `/posts/${encodeURIComponent(urn)}`, { method: 'DELETE', headers: { 'X-RestLi-Method': 'DELETE' } }, f);
  } catch (e) {
    if (e instanceof LinkedinError && e.kind === 'gone') return;
    throw e;
  }
}
