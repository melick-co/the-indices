/**
 * Claims to the source scout.
 *
 * When a feed item (Australia Inc) or an economist's note makes a claim that an official series could test but the
 * store does not hold that series, the reviewer files a `source_suggestions` row (register_data_source). The daily
 * source scout (scout-sources.mjs) looks for it at the official providers; on adoption it writes
 * payload.adopted_metric_id, the loaders keep the series fresh (series_registry, every daily `sources` run), and the
 * next review run re-checks the original claim against it once (payload.rechecked_at).
 *
 * Policy: official sources only. Private indices (Cotality/CoreLogic, PropTrack, bank or Westpac-Melbourne Institute
 * surveys), polls, opinions, forecasts, promises and one-off figures are never requested.
 * Pure helpers first (tested in claim-requests.check.mjs), then the database steps (db = a supabase-js client).
 */

export const RETRY_DAYS = 30;
export const MAX_REQUESTS_PER_RUN = 6;
export const RECHECK_DAYS = 7;
export const CLAIM_ORIGINS = ['australia_inc', 'economists'];

/** The scout's working id for a requested series (scout-sources.mjs uses this exact function). */
export const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);

/** Official publishers we may ask the scout for, with their tier (1: national, 2: international official body). */
const OFFICIAL = [
  { rx: /\babs\b|australian bureau of statistics|bureau of statistics/i, org: 'ABS', tier: 1 },
  { rx: /\brba\b|reserve bank/i, org: 'RBA', tier: 1 },
  { rx: /\bpbo\b|parliamentary budget office/i, org: 'Parliamentary Budget Office', tier: 1 },
  { rx: /treasury/i, org: 'Treasury', tier: 1 },
  { rx: /\boecd\b/i, org: 'OECD', tier: 2 },
  { rx: /\bimf\b|international monetary fund/i, org: 'IMF', tier: 2 },
  { rx: /world bank/i, org: 'World Bank', tier: 2 },
  { rx: /\bbis\b|bank for international settlements/i, org: 'BIS', tier: 2 },
];

/** Private data and polls: never a series request, whatever the model says. */
const PRIVATE = /cotality|corelogic|core logic|proptrack|\bdomain\b|\bsqm\b|westpac|melbourne institute|\bnab\b|\banz\b|commbank|commonwealth bank|\bcba\b|macquarie|roy morgan|newspoll|resolve (poll|political|strategic)|essential (poll|report|media)|yougov|redbridge|ipsos|freshwater|\bpoll|survey of consumer|consumer sentiment|business confidence|\bpmi\b|s&p global|judo|\bseek\b|\bindeed\b|realestate|\basx\b/i;
/** Forecasts, targets and promises are not recurring statistics. */
const NOT_A_SERIES = /forecast|projection|projected|outlook|target|promise|pledge|expected|estimate[sd]? for|will (be|reach|rise|fall)|budget measure|costing of/i;

/**
 * A claim's `needs` from the extraction prompt, cleaned: {series, org, why, tier} or null when it is not an official
 * recurring statistic we may request.
 */
export function normaliseNeeds(needs) {
  if (!needs || typeof needs !== 'object') return null;
  const series = String(needs.series ?? '').replace(/\s+/g, ' ').trim();
  const org = String(needs.org ?? '').replace(/\s+/g, ' ').trim();
  if (series.length < 6 || series.length > 160 || !org) return null;
  if (!/[a-z]/i.test(series) || slug(series).length < 4) return null;
  if (PRIVATE.test(series) || PRIVATE.test(org)) return null;
  if (NOT_A_SERIES.test(series)) return null;
  const official = OFFICIAL.find((o) => o.rx.test(org));
  if (!official) return null;
  const why = String(needs.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { series, org: official.org, why, tier: official.tier };
}

/** The dedupe key: the slug the scout would work under. */
export const requestKey = (series) => slug(series);

/**
 * Suggestion rows to file for one reviewed item: claims that carried a need and ended without a series.
 * @param {Array<{text: string, verdict?: string, metric_id?: string|null, needs?: unknown}>} claims
 * @param {{origin: 'australia_inc'|'economists', url?: string|null, item_id?: string, note_id?: string, title?: string}} ctx
 */
export function claimRequests(claims, ctx) {
  const out = [];
  const seen = new Set();
  for (const [i, c] of (claims ?? []).entries()) {
    if (!c || c.metric_id || (c.verdict && c.verdict !== 'no series')) continue;
    const n = normaliseNeeds(c.needs);
    if (!n) continue;
    const key = requestKey(n.series);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      row: {
        action: 'register_data_source',
        status: 'pending',
        summary: n.series,
        payload: {
          series: n.series, org: n.org, tier: n.tier,
          why: n.why || `A claim in ${ctx.origin === 'economists' ? 'economists\' commentary' : 'Australia Inc'} could not be checked: no stored series.`,
          url: ctx.url ?? null, origin: ctx.origin, claim: String(c.text ?? '').slice(0, 500), claim_index: i,
          ...(ctx.item_id ? { item_id: ctx.item_id } : {}), ...(ctx.note_id ? { note_id: ctx.note_id } : {}),
          ...(ctx.title ? { title: String(ctx.title).slice(0, 200) } : {}),
        },
      },
    });
  }
  return out;
}

/** Keys already requested: pending or approved suggestions, editor-rejected ones within RETRY_DAYS. */
export function takenKeys(suggestions, scoutLog, now = Date.now()) {
  const cutoff = now - RETRY_DAYS * 864e5;
  const keys = new Set();
  for (const s of suggestions ?? []) {
    const p = s.payload ?? {};
    const key = requestKey(p.series || p.name || s.summary);
    if (!key) continue;
    if (s.status === 'pending' || s.status === 'approved') keys.add(key);
    else if (s.status === 'rejected' && Date.parse(s.reviewed_at ?? s.created_at) > cutoff) keys.add(key);
  }
  for (const t of scoutLog ?? []) {
    if (Date.parse(t.last_tried) > cutoff) keys.add(String(t.requested_id).replace(/^claim:/, ''));
  }
  return keys;
}

/** The metric the scout adopted for a suggestion: payload.adopted_metric_id, else parsed from its review note. */
export function adoptedMetricId(s) {
  const fromPayload = s?.payload?.adopted_metric_id;
  if (typeof fromPayload === 'string' && /^[a-z0-9_]+$/.test(fromPayload)) return fromPayload;
  const m = String(s?.review_note ?? '').match(/^Adopted by the source scout as ([a-z0-9_]+)\b/);
  return m ? m[1] : null;
}

/** Index of the claim a suggestion refers to: matched by text, else by the stored index if that claim is unchanged. */
export function findClaim(claims, payload) {
  const list = claims ?? [];
  const text = String(payload?.claim ?? '').trim();
  const byText = list.findIndex((c) => String(c?.text ?? '').trim() === text);
  if (byText >= 0) return byText;
  const i = Number(payload?.claim_index);
  return Number.isInteger(i) && list[i] && !text ? i : -1;
}

/**
 * Scout order: claim-driven suggestions first, newest first, but never more than `max - 2` of them so other requests
 * (Foundry turns, held articles) and the pitches' asks still move; then the other suggestions, then the pitches.
 */
export function orderDemand(suggested, unlinked, max) {
  const isClaim = (t) => CLAIM_ORIGINS.includes(t.origin);
  const byNew = (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  const claims = suggested.filter(isClaim).sort(byNew);
  const others = suggested.filter((t) => !isClaim(t));
  const head = claims.slice(0, Math.max(1, max - 2));
  const rest = [...others, ...claims.slice(head.length), ...unlinked];
  return [...head, ...rest].slice(0, max);
}

// ---------------------------------------------------------------------------------------------------- database

/**
 * File the requests (pending source_suggestions), skipping keys already requested or recently tried by the scout.
 * @returns {Promise<number>} rows filed
 */
export async function fileClaimRequests(db, requests, { dry = false, log = console.log, cap = MAX_REQUESTS_PER_RUN } = {}) {
  if (!requests.length || cap <= 0) return 0;
  const { data: existing, error } = await db.from('source_suggestions')
    .select('summary, payload, status, created_at, reviewed_at').eq('action', 'register_data_source')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) { log(`claim requests: ${error.message}`); return 0; }
  const keys = requests.map((r) => r.key);
  const { data: tried } = await db.from('source_scout_log').select('requested_id, last_tried')
    .in('requested_id', [...keys, ...keys.map((k) => `claim:${k}`)]);
  const taken = takenKeys(existing, tried);
  let filed = 0;
  for (const r of requests) {
    if (filed >= cap) break;
    if (taken.has(r.key)) continue;
    taken.add(r.key);
    if (!dry) {
      const { error: e } = await db.from('source_suggestions').insert(r.row);
      if (e) { log(`claim request not filed (${r.row.summary}): ${e.message}`); continue; }
    }
    filed++;
    log(`  requested for the source scout${dry ? ' (dry run)' : ''}: ${r.row.summary} (${r.row.payload.org})`);
  }
  return filed;
}

/** Claim-driven suggestions the scout adopted in the last RECHECK_DAYS and not yet re-checked. */
export async function adoptedForRecheck(db, origin) {
  const since = new Date(Date.now() - RECHECK_DAYS * 864e5).toISOString();
  const { data, error } = await db.from('source_suggestions')
    .select('suggestion_id, summary, payload, review_note, reviewed_at')
    .eq('action', 'register_data_source').eq('status', 'approved').gte('reviewed_at', since)
    .eq('payload->>origin', origin).limit(50);
  if (error) return [];
  return (data ?? []).filter((s) => !s.payload?.rechecked_at).map((s) => ({ ...s, metric_id: adoptedMetricId(s) }))
    .filter((s) => s.metric_id);
}

export async function markRechecked(db, s, result) {
  await db.from('source_suggestions').update({
    payload: { ...(s.payload ?? {}), adopted_metric_id: s.metric_id, rechecked_at: new Date().toISOString(), recheck: String(result).slice(0, 300) },
  }).eq('suggestion_id', s.suggestion_id);
}
