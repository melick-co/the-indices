/**
 * The source_documents store (agent/supabase/33_source_documents.sql): official pages kept as text so
 * articles' sourced statements can be checked against them. Shared by the nightly loader and the web
 * app's publishing checks.
 */
import { canonicalUrl, contentHash, fetchDocument, firstDate, publisherOf } from './html-text.mjs';

/** Guess a document's kind from its publisher, URL and title. */
export function kindOf(url, title = '') {
  if (/rba\.gov\.au\/monetary-policy\/rba-board-minutes\//.test(url)) return 'minutes';
  if (/rba\.gov\.au\/speeches\//.test(url)) return 'speech';
  if (/rba\.gov\.au\/media-releases\//.test(url)) return /monetary policy decision/i.test(title) ? 'statement' : 'media_release';
  if (/abs\.gov\.au\/statistics\//.test(url)) return 'release';
  return 'page';
}

/** Insert or refresh a document; unchanged text is left alone. Returns 'new' | 'updated' | 'same'. */
export async function storeDocument(db, doc) {
  // Postgres text cannot hold NUL, and PDF extraction sometimes yields control characters.
  doc = { ...doc, body: String(doc.body ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') };
  const url = canonicalUrl(doc.url);
  const hash = contentHash(doc.body);
  const { data: existing } = await db.from('source_documents').select('content_hash').eq('url', url).maybeSingle();
  if (existing?.content_hash === hash) return 'same';
  const row = {
    url,
    publisher: doc.publisher ?? publisherOf(url) ?? 'Other',
    kind: doc.kind ?? kindOf(url, doc.title ?? ''),
    title: doc.title ?? null,
    published: doc.published ?? firstDate(doc.body.slice(0, 1500)),
    body: doc.body,
    content_hash: hash,
    fetched_at: new Date().toISOString(),
  };
  const { error } = await db.from('source_documents').upsert(row, { onConflict: 'url' });
  if (error) throw new Error(`storing ${url}: ${error.message}`);
  return existing ? 'updated' : 'new';
}

/**
 * The stored text of an official page, fetching and storing it first if needed.
 * Returns { url, title, body, published } or { error } (not an official publisher, page missing, etc.).
 * `opts.pdfText` lets the caller read PDFs (see fetchDocument).
 */
export async function ensureDocument(db, rawUrl, opts = {}) {
  let url;
  try { url = canonicalUrl(rawUrl); } catch { return { error: 'not a valid URL' }; }
  const { data: stored, error } = await db.from('source_documents')
    .select('url, title, body, published').eq('url', url).maybeSingle();
  if (stored) return stored;
  // Store missing (migration not yet run) or unreadable: still check against the live page.
  const storeUp = !error;
  if (!publisherOf(url)) return { error: 'not an official publisher on the source list' };
  const fetched = await fetchDocument(url, opts);
  if (fetched.error) return { error: fetched.error };
  if (storeUp) await storeDocument(db, fetched).catch(() => {});
  return { url, title: fetched.title, body: fetched.body, published: firstDate(fetched.body.slice(0, 1500)) };
}
