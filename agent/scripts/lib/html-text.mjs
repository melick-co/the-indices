/**
 * Readable text from an official web page (RBA, ABS and similar), for storing
 * source documents and checking articles against them. Plain HTML pages need no
 * OCR; scanned PDFs are out of scope.
 */
import { createHash } from 'node:crypto';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', middot: '·', deg: '°',
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Windows-1252 code points some pages still emit (e.g. &#146; for an apostrophe).
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      const cp1252 = { 145: '‘', 146: '’', 147: '“', 148: '”', 150: '–', 151: '—', 133: '…' };
      return cp1252[n] ?? String.fromCodePoint(n);
    })
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** The page's <title>, without the site suffix ("… | Media Releases | RBA"). */
export function titleOf(html) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return decodeEntities(t).split('|')[0].replace(/\s+/g, ' ').trim() || null;
}

/** Main text of a page: navigation, scripts and chrome removed; paragraphs kept on their own lines. */
export function htmlToText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  // Prefer the main content region when the page marks one.
  const main = /<main\b[\s\S]*?<\/main>/i.exec(h)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(h)?.[0];
  if (main) h = main;
  // Source newlines (pages wrap sentences mid-paragraph) and <br> are spaces; only block ends break lines.
  h = h.replace(/\s+/g, ' ').replace(/<br\b[^>]*>/gi, ' ');
  h = h.replace(/<(\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/blockquote)\b[^>]*>/gi, '\n');
  h = h.replace(/<li\b[^>]*>/gi, '\n• ');
  h = h.replace(/<[^>]+>/g, ' ');
  return decodeEntities(h)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const contentHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);

/** Official publishers whose pages may be stored and cited (tier 1/2 sources). */
const PUBLISHERS = [
  [/(^|\.)rba\.gov\.au$/, 'RBA'],
  [/(^|\.)abs\.gov\.au$/, 'ABS'],
  [/(^|\.)treasury\.gov\.au$/, 'Treasury'],
  [/(^|\.)apra\.gov\.au$/, 'APRA'],
  [/(^|\.)budget\.gov\.au$/, 'Treasury'],
  [/(^|\.)pc\.gov\.au$/, 'Productivity Commission'],
  [/(^|\.)fairwork\.gov\.au$/, 'Fair Work Commission'],
  [/(^|\.)oecd\.org$/, 'OECD'],
  [/(^|\.)imf\.org$/, 'IMF'],
  [/(^|\.)bis\.org$/, 'BIS'],
  [/(^|\.)worldbank\.org$/, 'World Bank'],
  // Peer official bodies, for comparisons (e.g. Canada's migration modelling).
  [/(^|\.)pbo-dpb\.ca$/, 'Parliamentary Budget Officer (Canada)'],
  [/(^|\.)statcan\.gc\.ca$/, 'Statistics Canada'],
  [/(^|\.)stats\.govt\.nz$/, 'Stats NZ'],
  [/(^|\.)rbnz\.govt\.nz$/, 'RBNZ'],
  [/(^|\.)ons\.gov\.uk$/, 'ONS'],
];

/** The official publisher of a URL, or null when it is not on the list. */
export function publisherOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PUBLISHERS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Canonical form used as the document key: https, no fragment, no trailing slash. */
export function canonicalUrl(url) {
  const u = new URL(url);
  u.protocol = 'https:';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** First "29 September 2026" or "19/08/2026" style date in the text, as YYYY-MM-DD. */
export function firstDate(text) {
  const long = /\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/.exec(text);
  if (long) return `${long[3]}-${String(MONTHS[long[2].toLowerCase()]).padStart(2, '0')}-${long[1].padStart(2, '0')}`;
  const short = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text);
  return short ? `${short[3]}-${short[2]}-${short[1]}` : null;
}

/** Fetch a page and return its text, or { error }. */
export async function fetchDocument(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; caveat-sources/0.1)' },
      signal: AbortSignal.timeout(25000),
      redirect: 'follow',
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!/html|text\/plain/i.test(type)) return { error: `not an HTML page (${type || 'unknown type'})` };
    const html = await res.text();
    const body = /text\/plain/i.test(type) ? html : htmlToText(html);
    if (body.length < 200) return { error: 'page has almost no text' };
    return { url: canonicalUrl(url), title: titleOf(html), body };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
