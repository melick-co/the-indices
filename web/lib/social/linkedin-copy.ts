/**
 * LinkedIn copy for The Caveat's Company Page: the prompt that drafts a post from a piece, and the check (lint) every
 * post must pass before it can be approved or go out.
 *
 * Adapted from linkedin-agent-skill by Jake Schincariol, MIT licence, https://github.com/Jakeschincariol/linkedin-agent-skill
 * (skills/li-human/slop.json for the invisible characters, banned words, phrases and structural tells; skills/li-post
 * for the shape: a first line that survives truncation at about 140 characters, short paragraphs, no more than three
 * hashtags at the end, no engagement bait; skills/li-carousel for "one idea per post"). Those parts are
 * Copyright (c) 2026 Jake Schincariol, used under the MIT licence (full text in that repository's LICENSE file).
 *
 * Choices made for a data newsroom rather than a personal feed:
 * - Words are rejected, never auto-replaced: a swapped word can change what a sentence claims. The editor (or one
 *   model rewrite) fixes the sentence.
 * - The banned list keeps the hype words only. Words with a plain economic meaning are left out on purpose:
 *   "landscape", "leverage" (debt), "robust", "elevate(d)" (the RBA's "elevated inflation"), "utilise" (capacity
 *   utilisation), "comprehensive" (income), "journey" (journey to work), "foster" (foster care), "vital"
 *   (statistics), and the plain connectives ("moreover", "thus", "hence").
 * - The rule-of-three check uses the skill's narrow pattern (three single words with a serial comma, ending a
 *   sentence). Australian English rarely uses the serial comma, so ordinary lists ("rents, insurance and
 *   electricity") pass; the model's rhythm ("faster, cheaper, and better.") does not.
 * - The skill puts links in the first comment; The Caveat posts the link as the post's article card instead, so the
 *   copy itself carries no URL.
 * - No first person: the Company Page speaks as the publication, in the NEWS-STYLE register (agent/NEWS-STYLE.md).
 */
import { captionNumbersOk } from '../content-queue';

export const LINKEDIN_LIMITS = { firstLine: 140, minChars: 600, maxChars: 1300, hashtags: 3, minParagraphs: 2, maxParagraphs: 3 } as const;

/** Hype words (from slop.json, trimmed for economic writing; see above). Matched as whole words, any case. */
export const BANNED_WORDS = [
  'delve', 'delves', 'delving', 'deep dive', 'dive deep', 'harness', 'harnessing', 'embark', 'showcase', 'showcases',
  'unlock', 'unlocks', 'unlocking', 'streamline', 'spearhead', 'underscore', 'underscores', 'underscoring', 'cultivate',
  'amplify', 'curated', 'empower', 'empowers', 'revolutionise', 'revolutionize', 'revolutionary', 'transformative',
  'seamless', 'seamlessly', 'pivotal', 'crucial', 'cutting-edge', 'game-changing', 'game-changer', 'game changer',
  'groundbreaking', 'unparalleled', 'unprecedented', 'invaluable', 'meticulous', 'meticulously', 'myriad', 'multifaceted',
  'holistic', 'bespoke', 'innovative', 'profound', 'remarkable', 'compelling', 'tapestry', 'realm', 'testament',
  'cornerstone', 'beacon', 'paradigm', 'synergy', 'ecosystem', 'treasure trove', 'plethora', 'arsenal', 'north star',
  'skyrocket', 'skyrocketed', 'skyrocketing', 'staggering', 'jaw-dropping', 'mind-blowing', 'shocking', 'stunning',
] as const;

/** Openers and closers that mark a post as written to a formula (slop.json "phrases"), plus engagement bait. */
export const BANNED_PHRASES = [
  "in today's fast-paced world", "in today's digital age", 'in the ever-evolving', 'in the ever-changing', "let's face it",
  "here's the thing", 'picture this', 'imagine a world', "it's no secret", "we've all been there", 'let that sink in',
  'the choice is yours', 'food for thought', 'the future is here', 'what are your thoughts', 'drop a comment',
  'comment below', 'at the end of the day', 'move the needle', 'needle-moving', 'without further ado', 'buckle up',
  'the harsh truth', 'spoiler alert', 'read that again', 'save this for later', "who's with me", 'like and share',
  'follow for more', 'repost if', 'tag someone', 'excited to announce', 'thrilled to share', 'humbled to',
  "here's what we learned", "here's what i learned", 'what do you think', 'in conclusion', 'in summary', 'to summarise', 'to summarize',
] as const;

export type LintIssue = { code: string; message: string };
export type LintResult = { ok: boolean; text: string; issues: LintIssue[] };

// Invisible and odd-space characters (slop.json "invisible"): deleted, or turned into a plain space.
const INVISIBLE_DELETE = /[​‌‍⁠﻿­᠎؜‎‏]|[\u{E0000}-\u{E007F}]/gu;
const ODD_SPACES = /[      ]/g;

/** Strip invisible characters and odd spaces. Returns the clean text and how many characters changed. */
export function cleanInvisible(text: string): { text: string; changed: number } {
  let changed = 0;
  const out = text.replace(INVISIBLE_DELETE, () => { changed++; return ''; }).replace(ODD_SPACES, () => { changed++; return ' '; });
  return { text: out, changed };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string) => new RegExp(`(?<![\\w-])${escapeRe(w).replace(/ /g, '\\s+')}(?![\\w-])`, 'i');
/** Straight and curly apostrophes compare the same. */
const flat = (s: string) => s.replace(/[‘’′]/g, "'").replace(/[“”]/g, '"');

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI = /\p{Extended_Pictographic}/u;
const FIRST_PERSON = /\b(?:I|I'm|I've|I'd|I'll|me|my|mine|myself|we|We|we're|We're|we've|We've|our|Our|ours|us|ourselves)\b/;

/** The blocks of a post (split on blank lines), with the trailing hashtag block set apart. */
export function postParts(text: string) {
  const blocks = text.trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const isTags = (b: string) => b.split(/\s+/).every((w) => /^#[\p{L}\p{N}_]+$/u.test(w));
  const tags = blocks.length && isTags(blocks[blocks.length - 1]) ? blocks.pop()! : '';
  const firstLine = (blocks[0] ?? '').split('\n')[0].trim();
  // The first line may stand alone as its own block; the paragraphs are what follows it.
  const paragraphs = blocks[0] && blocks[0].trim() === firstLine ? blocks.slice(1) : blocks;
  return { firstLine, paragraphs, tags, body: blocks.join('\n\n') };
}

/** Quoted passages of three words or more. */
function quotes(text: string): string[] {
  const out: string[] = [];
  for (const m of flat(text).matchAll(/"([^"\n]{3,})"/g)) if (m[1].trim().split(/\s+/).length >= 3) out.push(m[1].trim());
  return out;
}

/**
 * Check a LinkedIn post against the house rules. `source` is the piece's own words (title, standfirst, body, data
 * notes): every figure in the post and every quoted passage must appear in it. Invisible characters are stripped
 * (the cleaned text is returned); everything else is reported, never rewritten.
 */
export function lintLinkedin(raw: string, source: string): LintResult {
  const issues: LintIssue[] = [];
  const add = (code: string, message: string) => { if (!issues.some((i) => i.code === code && i.message === message)) issues.push({ code, message }); };
  const { text } = cleanInvisible(raw.replace(/\r\n/g, '\n'));
  const lower = flat(text).toLowerCase();
  const { firstLine, paragraphs, tags, body } = postParts(text);

  if (!text.trim()) return { ok: false, text, issues: [{ code: 'empty', message: 'No copy.' }] };

  // Length and shape.
  const n = text.trim().length;
  if (n < LINKEDIN_LIMITS.minChars) add('length', `Too short: ${n} characters (at least ${LINKEDIN_LIMITS.minChars}).`);
  if (n > LINKEDIN_LIMITS.maxChars) add('length', `Too long: ${n} characters (at most ${LINKEDIN_LIMITS.maxChars}).`);
  if (firstLine.length > LINKEDIN_LIMITS.firstLine) add('first-line', `First line is ${firstLine.length} characters; it must fit in ${LINKEDIN_LIMITS.firstLine} so it survives "see more".`);
  if (!/\d/.test(firstLine)) add('first-line-figure', 'The first line must state the finding with its figure.');
  if (paragraphs.length < LINKEDIN_LIMITS.minParagraphs || paragraphs.length > LINKEDIN_LIMITS.maxParagraphs) {
    add('paragraphs', `After the first line, write ${LINKEDIN_LIMITS.minParagraphs} or ${LINKEDIN_LIMITS.maxParagraphs} short paragraphs (found ${paragraphs.length}).`);
  }

  // Characters.
  if (/[—―]/.test(text)) add('em-dash', 'Em dash: use a comma, a colon or a full stop.');
  if (EMOJI.test(text)) add('emoji', 'Emoji: none in house copy.');
  if (/https?:\/\/|www\./i.test(text)) add('link', 'A link in the text: the link goes in the article card, not the copy.');

  // Hashtags: three at most, all at the end.
  const allTags = [...text.matchAll(HASHTAG)].length;
  const endTags = [...tags.matchAll(HASHTAG)].length;
  if (allTags > LINKEDIN_LIMITS.hashtags) add('hashtags', `${allTags} hashtags: three at most.`);
  if (allTags > endTags) add('hashtags-placement', 'Hashtags go on the last line only.');

  // Words and phrases.
  for (const w of BANNED_WORDS) if (wordRe(w).test(text)) add('banned-word', `Hype word: "${w}".`);
  for (const p of BANNED_PHRASES) if (lower.includes(p)) add('banned-phrase', `Formula phrase: "${p}".`);

  // Structural tells (slop.json "structures").
  const prose = flat(body);
  if (/\bit'?s not (?:just|only) [^.!?\n]{2,60}[,.;] it'?s\b/i.test(prose)) add('not-just', '"It\'s not just X, it\'s Y": say the one thing meant.');
  if (/\bnot only\b[^.!?\n]{2,80}\bbut also\b/i.test(prose)) add('not-only', '"Not only X but also Y": split it, or drop the weaker half.');
  if (/\b(?:this|it) is(?:n'?t| not) about [^.!?\n]{2,60}[.!] it'?s about\b/i.test(prose)) add('isnt-about', '"It isn\'t about X. It\'s about Y": lead with Y.');
  if (/\b[\p{L}-]+, [\p{L}-]+, and [\p{L}-]+\./u.test(prose)) add('triad', 'Rule-of-three list: two items or four, or write it as a sentence.');
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (l.endsWith('?') && l.split(/\s+/).length <= 4) add('rhetorical-question', `Rhetorical question line: "${l}". Answer it in the sentence instead.`);
  }
  if (/(?:^|\n)\s*(?:agree|thoughts|who else|am i wrong)\??\s*$/im.test(flat(text)) || /\b(?:agree|thoughts)\?/i.test(text)) add('engagement-bait', 'Engagement bait ("Thoughts?", "Agree?"): end on the last useful fact.');
  if (/\bas an ai\b|\bas a language model\b/i.test(text)) add('self-reference', 'Model self-reference.');

  // House rules.
  if (FIRST_PERSON.test(body)) add('first-person', 'First person: the page speaks as the publication, not "I" or "we".');
  if (!captionNumbersOk(body.replace(HASHTAG, ' '), source)) {
    const nums = (s: string) => (s.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []);
    const have = new Set(nums(source));
    const missing = [...new Set(nums(body.replace(HASHTAG, ' ')).filter((x) => !have.has(x)))];
    add('figures', `Figures not in the piece: ${missing.join(', ')}. Use only the piece's own numbers.`);
  }
  if (/\b(?:inflation|CPI|consumer price)/i.test(body) && /\d(?:\.\d+)?\s*(?:%|per cent)/i.test(body)) {
    // The pair: some sentence gives the trimmed mean with its figure (a sentence that only names it is the guard).
    const pair = body.split(/(?<=[.!?])\s+/).some((x) => /trimmed mean/i.test(x) && /\d/.test(x));
    if (!pair) add('cpi-pair', 'Inflation is quoted: give headline CPI and the trimmed mean (with its figure) together.');
    if (!/preferred/i.test(body) || !/\bRBA\b|Reserve Bank/.test(body)) add('cpi-guard', 'Inflation is quoted: say the trimmed mean is the RBA\'s preferred measure of underlying inflation.');
  }
  const src = flat(source).toLowerCase().replace(/\s+/g, ' ');
  for (const q of quotes(text)) if (!src.includes(q.toLowerCase().replace(/\s+/g, ' '))) add('quote', `Quote not found word for word in the piece: "${q.slice(0, 60)}".`);

  return { ok: issues.length === 0, text, issues };
}

// ---------------------------------------------------------------------------------------------------- prompt

export type CopyPiece = {
  kind: string; title: string; summary: string | null;
  /** The piece's own words: every figure and quote in the post must come from here. */
  source: string;
  /** Who published the data (ABS, RBA, Treasury...), for attribution. */
  sources: string[];
};

/** The system prompt for a LinkedIn post. */
export function linkedinPrompt(): string {
  return [
    'You write LinkedIn posts for the Company Page of The Caveat (caveat.news), an Australian data journalism site.',
    'Register: news, as in the house style brief (Wall Street Journal and Australian Financial Review structure): lead with the finding, numbers over adjectives, neutral and non-partisan, no opinion.',
    'Australian English (per cent, labour, organisation). No em dashes. No hype words, no emoji, no exclamation marks. No first person: never "I", "we", "our" or "us"; the page speaks as the publication.',
    'Every figure must come from the piece supplied, written exactly as the piece writes it, and attributed to whoever published it (for example: the ABS, the RBA, Treasury). Name what each number measures exactly as the piece does. Never round, convert or add a figure.',
    'If inflation is quoted, give headline CPI and the trimmed mean together, for the same period, and say in one sentence that the trimmed mean is the RBA\'s preferred measure of underlying inflation.',
    'No quotation marks unless the quoted words appear word for word in the piece. No quote is needed.',
    'Shape: the first line is at most 140 characters and states the finding with its figure. Then a blank line and two or three short paragraphs (one to three sentences each, a blank line between them): the context, then what to watch or the caveat. Then, on the last line, up to three hashtags that are real topics people follow (for example #AusEcon #Inflation).',
    'Length: 600 to 1,300 characters in all. One idea per post.',
    'No engagement bait: no "Thoughts?", "Agree?", questions to the reader or calls to comment, like or share. No rhetorical questions. No "It\'s not just X, it\'s Y". No lists of three single words. Do not include a link (the article card carries it).',
    'Reply with the post text only.',
  ].join(' ');
}

function userMessage(p: CopyPiece, retry?: { draft: string; issues: LintIssue[] }) {
  const piece = `Piece (${p.kind}): ${p.title}\n\nStandfirst: ${p.summary ?? ''}\n\nData published by: ${p.sources.join('; ') || 'see the piece'}\n\nThe piece's own words:\n${p.source.slice(0, 12000)}`;
  if (!retry) return piece;
  return `${piece}\n\nYour draft:\n${retry.draft}\n\nIt failed these checks. Rewrite it so it passes every one, changing nothing else that is right:\n${retry.issues.map((i) => `- ${i.message}`).join('\n')}`;
}

export type CopyResult = { text: string | null; issues: LintIssue[]; attempts: number };

/**
 * Draft a post and check it; on failure, one rewrite with the findings. If it still fails, the last draft comes back
 * with its issues, and the post is held for an editor.
 */
export async function draftLinkedinCopy(p: CopyPiece, opts: { key?: string; fetchImpl?: typeof fetch } = {}): Promise<CopyResult> {
  const key = opts.key ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { text: null, issues: [{ code: 'no-draft', message: 'No draft: the model is not configured. Write the post with Edit.' }], attempts: 0 };
  const f = opts.fetchImpl ?? fetch;
  const ask = async (content: string) => {
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: linkedinPrompt(), messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`model ${res.status}`);
    const body = await res.json() as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  };
  let draft = '', lint: LintResult | null = null, attempts = 0;
  try {
    draft = await ask(userMessage(p)); attempts++;
    lint = lintLinkedin(draft, p.source);
    if (!lint.ok) {
      draft = await ask(userMessage(p, { draft: lint.text, issues: lint.issues })); attempts++;
      lint = lintLinkedin(draft, p.source);
    }
  } catch (e) {
    if (!lint) return { text: null, issues: [{ code: 'no-draft', message: `No draft: ${e instanceof Error ? e.message : e}. Write the post with Edit.` }], attempts };
  }
  return { text: lint!.text, issues: lint!.issues, attempts };
}
