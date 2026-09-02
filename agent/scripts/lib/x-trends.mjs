/**
 * Fetch top trending topics from X (Twitter) for Australia and worldwide.
 * Requires OAuth 1.0a user context (v1.1 trends/place).
 *
 * Env: TWITTER_API_KEY, TWITTER_API_SECRET,
 *      TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
 */
import crypto from 'node:crypto';

const WOEID = { au: 23424748, global: 1 };
const TRENDS_URL = 'https://api.twitter.com/1.1/trends/place.json';

function pctEncode(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method, url, queryParams, creds) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const params = { ...queryParams, ...oauth };
  const base = Object.keys(params).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(params[k])}`)
    .join('&');
  const baseString = `${method}&${pctEncode(url)}&${pctEncode(base)}`;
  const signingKey = `${pctEncode(creds.apiSecret)}&${pctEncode(creds.accessSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauth.oauth_signature = signature;
  const header = Object.keys(oauth).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function credentialsFromEnv() {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  if ([apiKey, apiSecret, accessToken, accessSecret].some((v) => v.includes('your-'))) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/** @returns {Promise<{ configured: boolean, topics: Array<{rank, topic, mention_count, tweet_volume, url}> }>} */
export async function fetchXTrends(region) {
  const creds = credentialsFromEnv();
  if (!creds) {
    return { configured: false, topics: [] };
  }

  const id = WOEID[region];
  const query = { id: String(id) };
  const qs = new URLSearchParams(query).toString();
  const url = `${TRENDS_URL}?${qs}`;

  const res = await fetch(url, {
    headers: {
      authorization: oauthHeader('GET', TRENDS_URL, query, creds),
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X trends ${region} ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const trends = data?.[0]?.trends ?? [];
  const topics = trends.slice(0, 10).map((t, i) => ({
    rank: i + 1,
    topic: t.name,
    mention_count: t.tweet_volume ?? null,
    tweet_volume: t.tweet_volume ?? null,
    url: t.url ?? null,
  }));

  return { configured: true, topics };
}

/** Aggregate daily X snapshots into a 7-day top-10 by appearance + volume. */
export function aggregateXTopics(dailySnapshots) {
  const scores = new Map();
  for (const snap of dailySnapshots) {
    for (const t of snap.topics ?? []) {
      const key = (t.topic ?? '').toLowerCase();
      if (!key) continue;
      const prev = scores.get(key) ?? {
        topic: t.topic,
        appearances: 0,
        total_volume: 0,
        volume_samples: 0,
        url: t.url ?? null,
      };
      prev.appearances += 1;
      if (t.tweet_volume != null) {
        prev.total_volume += t.tweet_volume;
        prev.volume_samples += 1;
      }
      scores.set(key, prev);
    }
  }

  return [...scores.values()]
    .map((s) => ({
      topic: s.topic,
      score: s.appearances * 10 + (s.volume_samples ? s.total_volume / s.volume_samples / 1000 : 0),
      mention_count: s.appearances,
      tweet_volume: s.volume_samples ? Math.round(s.total_volume / s.volume_samples) : null,
      url: s.url,
    }))
    .sort((a, b) => b.score - a.score || b.mention_count - a.mention_count)
    .slice(0, 10)
    .map((t, i) => ({ rank: i + 1, ...t }));
}

export function xConfigured() {
  return credentialsFromEnv() != null;
}
