/**
 * Pure helpers for the Newsdesk dashboard (/foundry): time-ago labels, counts, feed health, and reading the loosely
 * shaped rows of tables that may not be installed yet. No database access here, so they can be checked offline
 * (lib/newsdesk.check.ts).
 */

/** "just now", "12m ago", "5h ago", "3d ago", "6w ago"; future times read "in 5h". Empty for a missing or bad date. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = now.getTime() - t;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  let label: string;
  if (s < 60) return future ? 'in under a minute' : 'just now';
  if (s < 3600) label = `${Math.floor(s / 60)}m`;
  else if (s < 86400) label = `${Math.floor(s / 3600)}h`;
  else if (s < 86400 * 14) label = `${Math.floor(s / 86400)}d`;
  else label = `${Math.floor(s / (86400 * 7))}w`;
  return future ? `in ${label}` : `${label} ago`;
}

/** Counts of rows by a string field, e.g. pitches by state. Missing values count under "unknown". */
export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** A queue error that came from the publish gate (the database trigger or the app's own check). */
export function isGateHold(error: string | null | undefined): boolean {
  return !!error && /publish gate/i.test(error);
}

export type FeedRow = {
  feed_id: string; name: string | null; publisher: string | null; url: string; active: boolean;
  last_fetched: string | null; last_item_at: string | null; error_count: number | null; beat?: string | null;
};

export type FeedProblem = { feed: FeedRow; reason: 'failing' | 'never fetched' | 'stale' };

/**
 * Health of the active feeds: failing (error_count > 0), never fetched, or not fetched in `staleHours`.
 * Problems are listed worst first (most errors, then never fetched, then longest since a fetch).
 */
export function feedHealth(feeds: FeedRow[], now: Date = new Date(), staleHours = 36) {
  const active = feeds.filter((f) => f.active);
  const problems: FeedProblem[] = [];
  for (const f of active) {
    if ((f.error_count ?? 0) > 0) problems.push({ feed: f, reason: 'failing' });
    else if (!f.last_fetched) problems.push({ feed: f, reason: 'never fetched' });
    else if (now.getTime() - new Date(f.last_fetched).getTime() > staleHours * 3600e3) problems.push({ feed: f, reason: 'stale' });
  }
  const order = { failing: 0, 'never fetched': 1, stale: 2 } as const;
  problems.sort((a, b) => order[a.reason] - order[b.reason]
    || (b.feed.error_count ?? 0) - (a.feed.error_count ?? 0)
    || (a.feed.last_fetched ?? '').localeCompare(b.feed.last_fetched ?? ''));
  const lastFetched = active.map((f) => f.last_fetched).filter((v): v is string => !!v).sort().at(-1) ?? null;
  return {
    total: feeds.length,
    active: active.length,
    failing: problems.filter((p) => p.reason === 'failing').length,
    neverFetched: problems.filter((p) => p.reason === 'never fetched').length,
    stale: problems.filter((p) => p.reason === 'stale').length,
    lastFetched,
    problems,
  };
}

/** The issues of a stored check ({ ok, issues: [...] }), as strings. Anything else reads as none. */
export function checkIssues(check: unknown): string[] {
  if (!check || typeof check !== 'object') return [];
  const issues = (check as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((i) => (typeof i === 'string'
    ? i
    : i && typeof i === 'object' && 'message' in i ? String((i as { message: unknown }).message) : JSON.stringify(i)));
}

/** A display title from a row whose shape is not fixed yet (The Rub, Bottom Line): the first non-empty text field. */
export function rowTitle(row: Record<string, unknown>, fields = ['headline', 'title', 'topic', 'summary']): string {
  for (const f of fields) {
    const v = row[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return 'Untitled';
}

/** The newest timestamp a row carries among `fields` (ISO strings compare in order). */
export function rowTime(row: Record<string, unknown>, fields = ['published_at', 'updated_at', 'created_at', 'day']): string | null {
  const times = fields.map((f) => row[f]).filter((v): v is string => typeof v === 'string' && !!v);
  return times.sort().at(-1) ?? null;
}

/** Rows newest first by rowTime. */
export function newestFirst<T extends Record<string, unknown>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (rowTime(b) ?? '').localeCompare(rowTime(a) ?? ''));
}

/** Today's Bottom Line status: the row for `day` if there is one, else "missing". */
export function bottomLineToday(rows: Array<Record<string, unknown>>, day: string): { status: string; row: Record<string, unknown> | null } {
  const row = rows.find((r) => String(r.day ?? '').slice(0, 10) === day) ?? null;
  return { status: row ? String(row.status ?? 'unknown') : 'missing', row };
}

/** The Sydney date as the masthead shows it, e.g. "Friday 16 October 2026". */
export function sydneyDateLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** A Sydney date and time for upcoming things, e.g. "Tue 20 Oct, 11:30 am". */
export function sydneyWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** The host of a link, without www., for a publisher fallback. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
