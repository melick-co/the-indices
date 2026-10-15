import { createClient } from '@/lib/supabase-server';
import { checkStory } from '@/lib/generate-story';
import type { StructuredStory } from '@/lib/article-from-pitch';

/**
 * The publish gate. Nothing goes live, and no live story's claims change, unless that exact content passed the
 * strict check: checkStory with the claim audit (figures against stored data, house style, claim audit, sourced
 * statements, footnote links). A story that passes is stamped with check_hash = the hash Postgres computes for its
 * claims (agent/supabase/45_publish_gate.sql); a trigger refuses a publish or a live claim change without the stamp.
 *
 * Until 45_publish_gate.sql runs there is no hash to stamp: the gate here still runs the strict check before every
 * publish, but the database backstop is not active.
 */

/** The article fields a story row and a revision hold. Placement, art and dates are not among them. */
export const ARTICLE_COLS = ['kicker', 'title', 'hook', 'caveat', 'one_number', 'evidence', 'body', 'frame_check'] as const;
/** The fields whose content is the story's claims (story_claim_hash in 45_publish_gate.sql). */
export const CLAIM_COLS = ['title', 'kicker', 'hook', 'caveat', 'one_number', 'body', 'evidence'] as const;

export type ArticleContent = Record<(typeof ARTICLE_COLS)[number], unknown> & { metric_ids_used?: string[] };

/** Stored check result: what the desk shows next to a draft or revision. */
export type StoredCheck = {
  ok: boolean; issues: string[]; warnings: string[]; checked_at: string;
  /** The claim audit and source checks ran (they need ANTHROPIC_API_KEY). Without them the check is not strict. */
  audited?: boolean;
  /** Edited since the check. */
  stale?: boolean;
};

/** Any check result the gate reads: a FactCheck, a StoredCheck, or a revision's stored check. */
export type GateCheck = { ok: boolean; issues?: string[]; audited?: boolean; stale?: boolean } | null | undefined;

/** Passed the strict check: every check passed, the claim audit ran, and nothing was edited since. Fails closed. */
export function passedStrict(check: GateCheck): boolean {
  return Boolean(check && check.ok && check.audited === true && !check.stale);
}

/** Why a check does not count as passed, for the editor. */
export function gateIssues(check: GateCheck): string[] {
  if (!check) return ['not checked'];
  if (check.stale) return ['edited since its last check: re-check it'];
  if (check.ok && check.audited !== true) {
    return ['the strict check did not run in full (the claim audit needs ANTHROPIC_API_KEY), so it cannot go live'];
  }
  return check.issues?.length ? check.issues : check.ok ? [] : ['held by the checks'];
}

/** A story's claims, as the hash sees them: the body's highlight panel is made after the check and is not a claim. */
export function claimsOf(row: Record<string, unknown>): Record<(typeof CLAIM_COLS)[number], unknown> {
  const out = Object.fromEntries(CLAIM_COLS.map((k) => [k, row[k] ?? null])) as Record<(typeof CLAIM_COLS)[number], unknown>;
  if (out.body && typeof out.body === 'object' && !Array.isArray(out.body)) {
    const { highlights: _h, ...rest } = out.body as Record<string, unknown>;
    out.body = rest;
  }
  return out;
}

/** JSON with object keys sorted and undefined dropped: equal for content jsonb stores the same way. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Two versions of a story make the same claims (art, highlights, placement and dates aside). */
export function sameClaims(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return canonicalJson(claimsOf(a)) === canonicalJson(claimsOf(b));
}

/** The message the publish-gate trigger raises (SQLSTATE CV001). */
export function isGateError(err: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(err && (err.code === 'CV001' || /publish gate:/i.test(err.message ?? '')));
}

/** A database error as the editor should read it: the gate's own words when the trigger refused the write. */
export function gateMessage(err: { code?: string; message?: string } | null | undefined): string {
  if (isGateError(err)) {
    return `${err!.message} Re-check it and try again; nothing was published.`;
  }
  return err?.message ?? 'unknown database error';
}

type Db = ReturnType<typeof createClient>;

const missingFunction = (err: { code?: string; message?: string }) =>
  err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message ?? '');

/**
 * The hash Postgres computes for this content's claims (claim_hash_of), so a stamp always matches what the trigger
 * computes. Null when 45_publish_gate.sql has not run.
 */
export async function claimHash(db: Db, content: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db.rpc('claim_hash_of', { p: claimsOf(content) });
  if (error) {
    if (missingFunction(error)) return null;
    throw new Error(`claim hash: ${error.message}`);
  }
  return typeof data === 'string' ? data : null;
}

/**
 * The stamp to write in the same update as content that passed the strict check: check_hash for exactly that
 * content. `override` is an editor's reason for putting unchecked content live (CLI only), recorded on the row.
 * Empty (no stamp) when the check did not pass, when the gate is not installed, or when the hash cannot be had:
 * an unstamped story is checked again before it goes live.
 */
export async function stampFields(
  db: Db, content: Record<string, unknown>, check: GateCheck, override?: string,
): Promise<Record<string, unknown>> {
  const reason = override?.trim();
  if (!passedStrict(check) && !reason) return {};
  try {
    const hash = await claimHash(db, content);
    if (!hash) return {};
    return { check_hash: hash, checked_at: new Date().toISOString(), check_override: passedStrict(check) ? null : reason };
  } catch (e) {
    console.warn(`publish gate: could not stamp (${e instanceof Error ? e.message : e}); it will be checked again before going live`);
    return {};
  }
}

/** Stamp a story row whose stored content passed the strict check (drafts too). True when stamped. */
export async function stampIfPassed(db: Db, slug: string, content: Record<string, unknown>, check: GateCheck): Promise<boolean> {
  const stamp = await stampFields(db, content, check);
  if (!stamp.check_hash) return false;
  const { error } = await db.from('stories').update(stamp).eq('slug', slug);
  if (error) {
    console.warn(`publish gate: could not stamp /stories/${slug}: ${error.message}`);
    return false;
  }
  return true;
}

/** Metric ids the copy may quote: the pitch's links. */
export async function pitchMetricIds(pitchId: string | null): Promise<string[]> {
  if (!pitchId) return [];
  const { data } = await createClient().from('pitches').select('metric_ids, resurface_metrics').eq('id', pitchId).maybeSingle();
  return [...new Set([...(data?.metric_ids ?? []), ...(data?.resurface_metrics ?? [])])] as string[];
}

/**
 * Run every publishing check on copy, without rewriting it: the strict check (claim audit on).
 * Returns the checked content: unverifiable quotes removed, charts and the hero number refilled from the store.
 */
export async function recheck(content: ArticleContent, pitchId: string | null): Promise<{ content: ArticleContent; check: StoredCheck }> {
  const db = createClient();
  // Series the copy quotes: kept on the revision and in evidence.metric_ids (saved with every article since Oct 2026).
  const saved = ((content.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  const used = [...new Set([...(content.metric_ids_used ?? []), ...saved])];
  const draft = { ...(content as unknown as StructuredStory), slug_hint: '', generation_note: '', metric_ids_used: used };
  const { check, ids } = await checkStory(db, draft, { metricIds: await pitchMetricIds(pitchId), audit: true });
  draft.evidence = { ...draft.evidence, metric_ids: [...ids] };
  const row = draft as unknown as Record<string, unknown>;
  return {
    content: {
      ...(Object.fromEntries(ARTICLE_COLS.map((k) => [k, row[k]])) as ArticleContent),
      ...(draft.metric_ids_used?.length ? { metric_ids_used: draft.metric_ids_used } : {}),
    },
    check: {
      ok: check.ok, issues: check.issues, warnings: check.warnings ?? [], checked_at: new Date().toISOString(),
      audited: Boolean(check.audited),
    },
  };
}

export type GateResult = { ok: boolean; issues: string[]; check?: StoredCheck };

/**
 * Before a story goes live: pass when its stamp matches its current content; otherwise run the strict check on the
 * current content, save the checked copy with its stamp, and pass only if it passed. `passed` is a strict check the
 * caller has just run on exactly the stored content; it is trusted only when there is no hash to compare (the gate
 * migration has not run), so a fresh draft is not checked twice.
 */
export async function ensurePublishable(slug: string, opts: { passed?: GateCheck } = {}): Promise<GateResult> {
  const db = createClient();
  const { data: row, error } = await db.from('stories').select('*').eq('slug', slug).maybeSingle();
  if (error) return { ok: false, issues: [error.message] };
  if (!row) return { ok: false, issues: [`no story at /stories/${slug}`] };
  let hash: string | null;
  try { hash = await claimHash(db, row); }
  catch (e) { return { ok: false, issues: [e instanceof Error ? e.message : String(e)] }; }
  if (hash && row.check_hash === hash) return { ok: true, issues: [] };
  if (!hash && passedStrict(opts.passed)) return { ok: true, issues: [] };

  const live = Object.fromEntries(ARTICLE_COLS.map((k) => [k, row[k]])) as ArticleContent;
  const saved = ((live.evidence as { metric_ids?: string[] } | null)?.metric_ids) ?? [];
  let result: { content: ArticleContent; check: StoredCheck };
  try { result = await recheck({ ...live, metric_ids_used: saved }, row.pitch_id as string | null); }
  catch (e) { return { ok: false, issues: [`the strict check failed to run: ${e instanceof Error ? e.message : String(e)}`] }; }
  const { content, check } = result;
  if (!passedStrict(check)) return { ok: false, issues: gateIssues(check), check };

  // Save the copy as checked (charts and the hero number rebuilt from the store), stamped, in one write. The
  // highlight panel is kept; it is not a claim.
  const highlights = (row.body as { highlights?: unknown } | null)?.highlights;
  const body = highlights ? { ...(content.body as Record<string, unknown>), highlights } : content.body;
  const claims = { ...claimsOf(content as Record<string, unknown>), body };
  const stamp = await stampFields(db, claims, check);
  const { error: saveErr } = await db.from('stories')
    .update({ ...claims, ...stamp, updated_at: new Date().toISOString() }).eq('slug', slug);
  if (saveErr) return { ok: false, issues: [gateMessage(saveErr)], check };
  return { ok: true, issues: [], check };
}
