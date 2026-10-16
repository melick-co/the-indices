import type { CheckableStory, FactCheck } from '@/lib/fact-check';
import type { ClaimAudit } from '@/lib/claim-audit';

/**
 * The Rub's column rules and the strict-check decision, kept pure so they can be tested without a database or a
 * model. The impure half (running the figure check and the claim audit) is web/lib/rub-check.ts.
 */

export const CLOSING_LINE = 'Which, if we are being precise, is the rub.';
export const MIN_PARAGRAPHS = 3;
export const MAX_PARAGRAPHS = 4;
export const MIN_WORDS = 200;
export const MAX_WORDS = 320;
export const MAX_TITLE_WORDS = 14;

export type RubCopy = { title: string; paragraphs: string[] };

export type RubCheck = {
  ok: boolean;
  /** The claim audit ran and returned. Without it the check is not the strict check, and a rub cannot be approved. */
  audited: boolean;
  issues: string[];
  warnings: string[];
  claims?: Array<{ claim: string; verdict: string; evidence: string }>;
  checked_at?: string;
  legacy?: boolean;
  stale?: boolean;
};

export const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** The paragraphs before the closing line. */
export function bodyParagraphs(paragraphs: string[]): string[] {
  return paragraphs.at(-1) === CLOSING_LINE ? paragraphs.slice(0, -1) : paragraphs;
}

/** Column rules: a contrarian title, 3-4 paragraphs, the word range, no em dashes, the exact closing line. */
export function columnIssues(rub: RubCopy): string[] {
  const issues: string[] = [];
  const title = (rub.title ?? '').trim();
  const paragraphs = Array.isArray(rub.paragraphs) ? rub.paragraphs : [];
  if (!title) issues.push('column: no title');
  else if (words(title) > MAX_TITLE_WORDS) issues.push(`column: title is ${words(title)} words; keep it to ${MAX_TITLE_WORDS} or fewer`);
  if (paragraphs.some((p) => typeof p !== 'string' || !p.trim())) issues.push('column: an empty paragraph');
  if (paragraphs.at(-1) !== CLOSING_LINE) {
    issues.push(`column: must end with its own final paragraph, exactly "${CLOSING_LINE}"`);
  }
  if (paragraphs.slice(0, -1).some((p) => p.includes(CLOSING_LINE))) issues.push('column: the closing line appears before the end');
  const body = bodyParagraphs(paragraphs);
  if (body.length < MIN_PARAGRAPHS || body.length > MAX_PARAGRAPHS) {
    issues.push(`column: ${body.length} paragraphs before the closing line; needs ${MIN_PARAGRAPHS} to ${MAX_PARAGRAPHS}`);
  }
  const n = body.reduce((s, p) => s + words(String(p ?? '')), 0);
  if (n < MIN_WORDS || n > MAX_WORDS) issues.push(`column: ${n} words before the closing line; needs ${MIN_WORDS} to ${MAX_WORDS}`);
  const all = [title, ...paragraphs].join('\n');
  if (/—/.test(all)) issues.push('column: em dash (house style: none)');
  if (/\s–\s/.test(all)) issues.push('column: en dash used as a dash (house style: none)');
  return issues;
}

/** The column in the shape the story checks take: its paragraphs are the body; no deck, caveat, chart or evidence. */
export function asCheckable(rub: RubCopy): CheckableStory {
  return {
    kicker: 'The Rub',
    title: rub.title,
    hook: '',
    caveat: '',
    one_number: null,
    evidence: null,
    body: { blocks: bodyParagraphs(rub.paragraphs).map((text) => ({ type: 'paragraph' as const, text })) },
  };
}

/** Figure-check findings that belong to articles, not to a column (a column carries no chart). */
const NOT_FOR_COLUMNS = [/^no chart$/];

export type CheckInputs = {
  columnIssues: string[];
  fact: FactCheck | null;
  factError?: string | null;
  /** null when the audit did not run (no key, figures failed, or it threw). */
  audit: ClaimAudit | null;
  auditError?: string | null;
  apiKey: boolean;
};

/**
 * Fail closed: ok only when the column rules pass, the figure check ran and passed, and the claim audit ran and
 * found nothing unsupported. Anything that did not run is an issue, never a pass.
 */
export function decideCheck(x: CheckInputs, now = new Date()): RubCheck {
  const issues = [...x.columnIssues];
  const warnings: string[] = [];
  let figuresOk = false;
  if (x.fact) {
    const factIssues = x.fact.issues.filter((i) => !NOT_FOR_COLUMNS.some((re) => re.test(i)));
    issues.push(...factIssues);
    warnings.push(...(x.fact.warnings ?? []));
    figuresOk = factIssues.length === 0;
  } else {
    issues.push(`figure check did not run${x.factError ? `: ${x.factError}` : ''}`);
  }
  let audited = false;
  let claims: RubCheck['claims'];
  if (x.audit) {
    audited = true;
    claims = x.audit.claims;
    for (const c of x.audit.unsupported) issues.push(`claim not supported by stored data: "${c.claim}" (${c.evidence})`);
  } else if (x.auditError) {
    issues.push(`claim audit failed: ${x.auditError}`);
  } else if (!x.apiKey) {
    issues.push('claim audit did not run: ANTHROPIC_API_KEY is not set');
  } else if (figuresOk) {
    issues.push('claim audit did not run');
  } else {
    issues.push('claim audit did not run: the figures failed first');
  }
  const ok = issues.length === 0 && figuresOk && audited && !!x.audit?.ok;
  return { ok, audited, issues, warnings, claims, checked_at: now.toISOString() };
}

/** Whether an editor may approve a row with this check (mirrors the trigger in agent/supabase/47_the_rub.sql). */
export const approvable = (check: Partial<RubCheck> | null | undefined) => check?.ok === true && check?.audited === true;

/** The status a freshly checked rub is saved with. Never 'published': that is the editor's call. */
export const statusFor = (check: RubCheck): 'pending' | 'draft' => (approvable(check) ? 'pending' : 'draft');

/** A url-safe slug from a title. */
export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'the-rub';
}
