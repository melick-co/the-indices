import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalUrl, fetchDocument, publisherOf } from '../../agent/scripts/lib/html-text.mjs';
import { storeDocument } from '../../agent/scripts/lib/source-docs.mjs';
import { pdfText } from '@/lib/pdf-text';

/**
 * Reading an official page for the scorecard, robustly. Government sites sometimes refuse cloud runners or go down for
 * maintenance (treasury.gov.au answered 503 "Site under maintenance" on 21 Oct 2026). So:
 *   1. a fresh fetch with browser-like headers, retried with backoff on 429, 5xx and network errors;
 *   2. if that fails, the copy already stored in source_documents (the cache the story source checks share), recorded
 *      as such with the date it was fetched;
 *   3. otherwise nothing: the caller holds the commitment with the reason.
 * Only official publishers (publisherOf: .gov.au and the listed official bodies). Never a mirror or archive copy.
 */

export const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8',
  'accept-language': 'en-AU,en;q=0.9',
};

/** Waits before each retry: 3 retries after the first try. */
export const BACKOFF_MS = [2000, 6000, 15000];

export type Doc = { url: string; title: string | null; body: string };
export type Fetched = { body?: string; title?: string | null; error?: string };
export type Cached = { body: string; title: string | null; fetched_at: string } | null;
export type OfficialDoc =
  | { ok: true; doc: Doc; via: 'live' | 'cache'; fetched_at: string; note: string }
  | { ok: false; error: string };

/** A failure worth retrying: rate limiting, server errors, timeouts and network failures. Not 404s or wrong types. */
export function retryable(error: string | undefined): boolean {
  if (!error) return false;
  const http = /^HTTP (\d{3})/.exec(error);
  if (http) return http[1] === '429' || http[1] === '408' || +http[1] >= 500;
  return /timeout|timed out|abort|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket|TLS/i.test(error);
}

/**
 * Which copy to use: the live page when it was read; else the stored copy, saying so and when it was fetched; else the
 * reason both failed. Pure, so the decision is tested.
 */
export function chooseDocument(url: string, live: Fetched, cached: Cached): OfficialDoc {
  if (!publisherOf(url)) return { ok: false, error: `not an official publisher (${url})` };
  if (live.body && !live.error) {
    return { ok: true, doc: { url, title: live.title ?? null, body: live.body }, via: 'live', fetched_at: new Date().toISOString(), note: 'checked against the live page' };
  }
  if (cached?.body) {
    const day = cached.fetched_at.slice(0, 10);
    return { ok: true, doc: { url, title: cached.title, body: cached.body }, via: 'cache', fetched_at: cached.fetched_at,
      note: `the live page could not be read (${live.error ?? 'empty'}); checked against the copy stored on ${day}` };
  }
  return { ok: false, error: `source could not be read: ${live.error ?? 'empty'}, and no stored copy` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fresh fetch with browser-like headers and backoff. */
export async function fetchLive(url: string, opts: { backoff?: number[]; wait?: (ms: number) => Promise<unknown>; fetcher?: (url: string) => Promise<Fetched> } = {}): Promise<Fetched> {
  const backoff = opts.backoff ?? BACKOFF_MS;
  const wait = opts.wait ?? sleep;
  let last: Fetched = { error: 'not tried' };
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) await wait(backoff[attempt - 1]);
    last = opts.fetcher ? await opts.fetcher(url) : await fetchDocument(url, { pdfText, headers: BROWSER_HEADERS }) as Fetched;
    if (!last.error || !retryable(last.error)) return last;
  }
  return last;
}

/** The stored copy in source_documents, if any (null before migration 33 or when never stored). */
export async function cachedDocument(db: SupabaseClient | null, url: string): Promise<Cached> {
  if (!db) return null;
  try {
    const { data } = await db.from('source_documents').select('title, body, fetched_at').eq('url', canonicalUrl(url)).maybeSingle();
    return data?.body ? { body: data.body as string, title: (data.title as string) ?? null, fetched_at: String(data.fetched_at) } : null;
  } catch { return null; }
}

/**
 * The official document, live or from the stored copy. A live read refreshes the stored copy unless `store` is false
 * (dry runs).
 */
export async function readOfficial(db: SupabaseClient | null, url: string, opts: { store?: boolean; backoff?: number[] } = {}): Promise<OfficialDoc> {
  if (!publisherOf(url)) return { ok: false, error: `not an official publisher (${url})` };
  const live = await fetchLive(url, { backoff: opts.backoff });
  const cached = live.body && !live.error ? null : await cachedDocument(db, url);
  const res = chooseDocument(url, live, cached);
  if (res.ok && res.via === 'live' && opts.store && db) {
    await storeDocument(db, { url, title: res.doc.title, body: res.doc.body }).catch(() => {});
  }
  return res;
}
