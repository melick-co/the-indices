import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { ensureDocument } from '../../agent/scripts/lib/source-docs.mjs';
import { pdfText } from '@/lib/pdf-text';
import { ATTRIBUTION, rawSentences } from '@/lib/style-check';
import type { StoryBlock, StoryEvidence } from '@/lib/story-types';

/**
 * Third publish gate, for what stored data cannot show. A sentence that reports what a source said,
 * published or scheduled (and every footnoted timeline event) is checked against the stored text of the
 * document its footnote links to (source_documents, agent/scripts/lib/source-docs.mjs). The model must
 * quote the passage that supports the claim, and the quote must appear in the document; otherwise the
 * story is held.
 */

type Checkable = { hook?: string | null; evidence?: StoryEvidence | null; body: { blocks: StoryBlock[] } };
type Claim = { id: number; text: string; footnotes: number[] };
type Doc = { url: string; title?: string | null; body: string };

const MARKER = /\[\^(\d+)\]/g;
const STOP = new Set('the a an and or of to in on for by with as at from that this its it is are was were be has have had will would its their there which into than over after before since about more most also been not but per cent'.split(' '));
const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
// Words worth matching on: content words, plus numbers and dates ("4.60", "18/11/2026").
// Hyphens and slashes split too, so "2025-01-23" and "23/10/2026" share their parts with written dates.
const terms = (t: string) => new Set(norm(t).replace(/[^a-z0-9'. ]/g, ' ').replace(/[.,](?!\d)/g, ' ').split(' ')
  .filter((w) => (/\d/.test(w) ? w.length >= 2 : w.length > 3 && !STOP.has(w))));

/**
 * True when the quoted evidence is really in the source: each fragment of 3+ words is found. Evidence is split
 * at ellipses and between sentences, since models often join passages from different parts of a page.
 */
export function inSource(evidence: string, bodies: string[]): boolean {
  const fragments = evidence.split(/\.\.\.|…|\[\.\.\.\]|(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((f) => norm(f).replace(/^["'“‘\s]+|["'”’\s.,;:]+$/g, ''))
    // Fragments need words, not just a date or figures ("19 August 2026" where the page has "19/08/2026").
    // ...but a table row ("Dec-23 636,375 105,755 530,620") is evidence: four or more tokens with one word.
    .filter((f) => {
      const tokens = f.split(' ').length;
      const wordCount = (f.match(/[a-z]{2,}/g) ?? []).length;
      return (tokens >= 3 && wordCount >= 2) || (tokens >= 4 && wordCount >= 1);
    });
  // Compare on words and figures only, so punctuation and spacing differences ("Released: 19/08/2026" for
  // "Released 19/08/2026") do not reject words that are really there.
  // A full stop between a word and digits is a sentence end with a footnote number glued on by PDF extraction
  // ("percentage point.30"), not a decimal point.
  const bare = (t: string) => ` ${t.replace(/[^a-z0-9%./ ]/g, ' ').replace(/(?<=[a-z])\.(?=\d)/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const docs = bodies.map(bare);
  // A fragment may end where the document has a full stop with a footnote number glued on ("quarter 2026.1").
  return fragments.length > 0 && fragments.every((f) => {
    const core = bare(f).trimEnd();
    return docs.some((b) => b.includes(`${core} `) || b.includes(`${core}.`));
  });
}

// Statistical tables and data APIs: their figures are checked against stored data by the claim audit, and
// the pages themselves are lists of files, not text to check statements against.
export const DATA_TABLE = /rba\.gov\.au\/statistics\/tables|data\.api\.abs\.gov\.au|explore\.data\.abs\.gov\.au|data-explorer\.oecd\.org|sdmx\.oecd\.org|data\.imf\.org|stats\.bis\.org|data\.worldbank\.org/i;

/** What a decision or report did, beyond what someone said: "the 2024 decision estimated…", "the Commission found…". */
const DOCUMENT_VERBS = /\b(?:estimated|estimates|measured|found|finds|awarded|decided|determined|calculated|concluded|cited|states|set)\b/i;

/** Statistical release pages: their figures are in the store, so data sentences citing them are audited there. */
const STATS_RELEASE = /abs\.gov\.au\/statistics\//i;

const urlsOf = (story: Checkable) => new Map((story.evidence?.footnotes ?? []).map((f) => [f.n, f.url ?? '']));

/** Sourced statements and dated events in the article, with the footnotes they cite. */
function claimsOf(story: Checkable): Claim[] {
  const out: Claim[] = [];
  const add = (text: string, footnotes: number[]) => {
    const clean = text.replace(MARKER, '').trim();
    if (clean && footnotes.length) out.push({ id: out.length + 1, text: clean, footnotes: [...new Set(footnotes)] });
  };
  for (const s of rawSentences(story.hook ?? '')) if (ATTRIBUTION.test(s) || isDocumentSourced(s, urlsOf(story))) add(s, [...s.matchAll(MARKER)].map((m) => Number(m[1])));
  for (const b of story.body.blocks) {
    const texts = b.type === 'paragraph' ? [b.text] : b.type === 'layers' ? b.items : [];
    for (const t of texts) {
      for (const s of rawSentences(t)) {
        if (ATTRIBUTION.test(s) || isDocumentSourced(s, urlsOf(story))) add(s, [...s.matchAll(MARKER)].map((m) => Number(m[1])));
      }
    }
    if (b.type === 'timeline') {
      for (const ev of b.events) if (ev.footnote) add(`${ev.date}: ${ev.label}`, [ev.footnote]);
    }
  }
  return out;
}

/** The document's paragraphs most relevant to a claim, in document order, within a size budget. */
function excerpt(doc: Doc, claim: string, budget = 2400): string {
  const want = terms(claim);
  // PDF text is hard-wrapped mid-sentence: rejoin wrapped lines into paragraphs, and cut long paragraphs into
  // runs of whole sentences, so the passages (and the words quoted from them) are contiguous text.
  // (HTML pages and tables keep their lines: a table row is a unit of its own.)
  const pdf = /\.pdf(?:$|[?#])/i.test(doc.url);
  const units = (pdf ? doc.body.replace(/([^\n])\n(?!\n)/g, '$1 ') : doc.body).split(/\n+/).flatMap((para) => {
    if (!pdf) return [para];
    if (para.length <= 600) return [para];
    const out: string[] = [];
    let cur = '';
    for (const sentence of para.split(/(?<=[.!?])\s+(?=[A-Z\[(“"])/)) {
      if (cur && cur.length + sentence.length > 450) { out.push(cur); cur = ''; }
      cur = cur ? `${cur} ${sentence}` : sentence;
    }
    if (cur) out.push(cur);
    return out;
  });
  const lines = units.map((line, i) => ({ line, i, score: [...terms(line)].filter((w) => want.has(w)).length }));
  const picked: typeof lines = [];
  let size = 0;
  for (const l of [...lines].sort((a, b) => b.score - a.score)) {
    if (!l.score || size + l.line.length > budget) continue;
    picked.push(l);
    size += l.line.length;
  }
  // Always lead with the document's opening (title, number, date: covers and release headers carry them).
  const head = doc.body.slice(0, 500);
  return [head, ...picked.sort((a, b) => a.i - b.i).map((l) => l.line)].join('\n');
}

export async function verifySourcedStatements(
  db: SupabaseClient,
  story: Checkable,
): Promise<{ issues: string[]; checked: number }> {
  const claims = claimsOf(story);
  if (!claims.length) return { issues: [], checked: 0 };
  const urlOf = new Map((story.evidence?.footnotes ?? []).map((f) => [f.n, f.url ?? '']));
  const issues: string[] = [];

  // Load each cited document once.
  const docs = new Map<string, Doc | { error: string }>();
  for (const url of new Set(claims.flatMap((c) => c.footnotes.map((n) => urlOf.get(n) ?? '')))) {
    if (url && !DATA_TABLE.test(url)) docs.set(url, await ensureDocument(db, url, { pdfText }) as Doc | { error: string });
  }
  const unreadable = new Set<string>();
  for (const [url, d] of docs) {
    if ('error' in d) { unreadable.add(url); issues.push(`source: ${url} could not be read to check the statements citing it (${d.error})`); }
  }

  const checkable = claims
    .map((c) => ({ ...c, docs: c.footnotes.map((n) => urlOf.get(n) ?? '').filter((u) => u && !unreadable.has(u) && !DATA_TABLE.test(u)) }))
    .filter((c) => c.docs.length);
  if (!checkable.length) return { issues, checked: 0 };

  const sections = checkable.map((c) => {
    const passages = c.docs.map((u) => {
      const d = docs.get(u) as Doc;
      return `<source url="${u}" title="${(d.title ?? '').replace(/"/g, "'")}">\n${excerpt(d, c.text)}\n</source>`;
    }).join('\n');
    return `<claim id="${c.id}">\n${c.text}\n${passages}\n</claim>`;
  }).join('\n\n');

  const prompt = `You check a news article's sourced statements against the documents they cite. Each claim
below comes with passages from its cited source(s). They are the only admissible evidence.

${sections}

Judge only what each claim attributes to its source: what the source said, decided, published or
scheduled. Figures and comparisons that come from the story's own stored data ("its highest since 2010")
are checked elsewhere; ignore them unless the source gives a different value for the same measure, which
makes the claim unsupported. A rounded figure is the same value ("A$12,689 billion" for 12,688.9), and a date
written another way is the same date ("23 January 2025" for 2025-01-23).

For each claim, first copy the passage words that bear on it, exactly as written in the passage (a
sentence or two; mark a gap with "..."), then decide:
- "supported": the source says it, or plainly implies it. Paraphrase is fine.
- "unsupported": the source does not say it, says something different, or the claim attributes detail to the
  source that it lacks (a date, number, characterisation, cause, or who said it).
If nothing in the passages bears on the claim, the evidence is "" and the verdict is "unsupported".

Respond ONLY with JSON:
{"results":[{"id":1,"evidence":"verbatim words from the source","verdict":"supported|unsupported","reason":"short reason if unsupported"}]}`;

  const reply = await callClaudeJson(prompt, { label: 'source check' }) as {
    results?: Array<{ id: number; evidence?: string; verdict?: string; reason?: string }>;
  };
  const byId = new Map((reply.results ?? []).map((r) => [Number(r.id), r]));
  for (const c of checkable) {
    const r = byId.get(c.id);
    const bodies = c.docs.map((u) => norm((docs.get(u) as Doc).body));
    // The supporting words must really be in the source, not a model's paraphrase of it.
    const quoted = r?.evidence?.trim() ? inSource(r.evidence, bodies) : false;
    if (r?.verdict === 'supported' && quoted) continue;
    const why = !r ? 'not assessed'
      : r.verdict === 'supported' ? `the supporting words given are not in the source: "${(r.evidence ?? '').slice(0, 300)}"`
        : r.reason || 'the source does not say this';
    issues.push(`source: "${c.text.slice(0, 120)}" is not supported by ${c.docs.join(', ')} (${why})`);
  }
  return { issues, checked: checkable.length };
}

/** Latest RBA monetary policy statement and minutes, as context for the writer. */
export async function latestOfficialDocuments(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.from('source_documents')
    .select('url, title, published, kind, body')
    .eq('publisher', 'RBA').in('kind', ['statement', 'minutes'])
    .order('published', { ascending: false }).limit(4);
  if (error || !data?.length) return '';
  const latest = ['statement', 'minutes'].map((k) => data.find((d) => d.kind === k)).filter(Boolean) as typeof data;
  return latest.map((d) => `<document url="${d.url}" title="${d.title ?? ''}" published="${d.published ?? ''}">\n${d.body.slice(0, 3500)}\n</document>`).join('\n');
}

/**
 * True for a sentence the source check verifies against a cited document (it reports what a source said,
 * published or scheduled, and its footnote links to a page rather than a data table). The claim audit leaves
 * these to the source check: their figures belong to the document, not to stored data.
 */
export function isDocumentSourced(sentence: string, footnoteUrls: Map<number, string>): boolean {
  const urls = [...sentence.matchAll(MARKER)].map((m) => footnoteUrls.get(Number(m[1])) ?? '');
  if (!urls.length || !urls.every((u) => u && !DATA_TABLE.test(u))) return false;
  if (ATTRIBUTION.test(sentence)) return true;
  // "measured", "estimated" … describe what a decision or report did, but also ordinary data sentences ("the
  // measured annual rate is minus 0.2 per cent"): those cite a statistical release whose figures are stored.
  return DOCUMENT_VERBS.test(sentence) && !urls.some((u) => STATS_RELEASE.test(u));
}

/**
 * Each footnote's link must go to the document the footnote describes. For every official document a footnote
 * links to (data tables and APIs excepted), the document's own title and date are compared with the footnote's
 * description: a release number pointing at an unrelated release ("Statement by the Governor, 29 September 2026"
 * linking to "Designation of Linfox Armaguard …") is an issue. Unreadable pages are left to the source check.
 */
export async function verifyFootnoteLinks(db: SupabaseClient, story: Checkable): Promise<string[]> {
  const notes = (story.evidence?.footnotes ?? []).filter((f) => f.url && !DATA_TABLE.test(f.url) && /^https?:/.test(f.url));
  const pairs: Array<{ n: number; footnote: string; title: string; published: string | null }> = [];
  for (const f of notes) {
    const doc = await ensureDocument(db, f.url!, { pdfText }) as { title?: string | null; published?: string | null; body?: string; error?: string };
    if (doc.error || !doc.title) continue;
    pairs.push({ n: f.n, footnote: f.text, title: doc.title, published: doc.published ?? null });
  }
  if (!pairs.length) return [];
  const reply = await callClaudeJson(`Each footnote below describes a source; the title and date are those of the document its link
actually opens. Decide whether the link goes to the document the footnote describes. A different naming of the
same document ("Statement by the Governor" for a "Statement by the Monetary Policy Board: Monetary Policy Decision"
of the same date, or a landing page for the publication named, such as the RBA's "In Brief: Financial Stability Review –
October 2026" page for the October 2026 Financial Stability Review) is the same document. A different document (another
release, another subject, another date's decision) is a mismatch.

${pairs.map((p) => `[${p.n}] FOOTNOTE: ${p.footnote}\n    LINKED DOCUMENT: ${p.title}${p.published ? ` (${p.published})` : ''}`).join('\n')}

Respond ONLY with JSON: {"mismatches":[{"n":1,"reason":"short reason"}]}`, { label: 'footnote links' }) as { mismatches?: Array<{ n: number; reason?: string }> };
  return (reply.mismatches ?? []).map((m) => {
    const p = pairs.find((x) => x.n === Number(m.n));
    return `footnote ${m.n} links to "${p?.title ?? '?'}", which is not the source it describes${m.reason ? ` (${m.reason})` : ''}`;
  });
}
