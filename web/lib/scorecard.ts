/**
 * The government scorecard (/australia-inc/scorecard): pure rules, no database. Tested in scorecard.check.ts.
 *
 * Two halves. Promises: the federal government's own measurable commitments, each quoted verbatim from an official
 * document and measured by an official stored series, rated mechanically on pace. Outcomes: headline official series
 * from a baseline (the election that began the term) to the latest reading, with no rating at all.
 *
 * Fairness rules, enforced here and on the page: no grades or evaluative words; every rating is reproducible from the
 * stored series and the thresholds below; official data only.
 */

// ---------------------------------------------------------------------------------------------------- terms

export type TermKey = '2025' | '2022';
export const TERMS: Record<TermKey, { key: TermKey; date: string; label: string; long: string }> = {
  '2025': { key: '2025', date: '2025-05-03', label: 'This term', long: 'since the federal election of 3 May 2025' },
  '2022': { key: '2022', date: '2022-05-21', label: 'Since taking office', long: 'since the federal election of 21 May 2022' },
};
export const DEFAULT_TERM: TermKey = '2025';

/** The ?since= query value as a term: "2022" is the first term, anything else the current one. */
export const termOf = (since: string | string[] | undefined | null): TermKey => ((Array.isArray(since) ? since[0] : since) === '2022' ? '2022' : DEFAULT_TERM);

// ---------------------------------------------------------------------------------------------------- periods

const DAY = 864e5;
const YEAR = 365.25 * DAY;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

/**
 * The span a stored period covers, as UTC milliseconds [start, end] (end inclusive, the last day). Periods come as
 * 2026-Q2, 2026-08, 2026, 2024-25 (financial year), or a date 2026-09-30 (a point: start = end). Null if unreadable.
 */
export function periodSpan(period: string): { start: number; end: number; point: boolean } | null {
  const p = String(period).trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-Q([1-4])$/.exec(p))) {
    const y = +m[1], q = +m[2];
    return { start: utc(y, (q - 1) * 3, 1), end: utc(y, q * 3, 0), point: false };
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p))) {
    const t = utc(+m[1], +m[2] - 1, +m[3]);
    return { start: t, end: t, point: true };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(p))) {
    const y = +m[1], mo = +m[2];
    // 2024-25 is a financial year (July 2024 to June 2025), not a month.
    if (mo > 12) return null;
    return { start: utc(y, mo - 1, 1), end: utc(y, mo, 0), point: false };
  }
  if ((m = /^(\d{4})$/.exec(p))) return { start: utc(+m[1], 0, 1), end: utc(+m[1], 11, 31), point: false };
  return null;
}

/** Financial years ("2024-25") are spans too; handled apart because they look like a month. */
export function spanOf(period: string): { start: number; end: number; point: boolean } | null {
  const fy = /^(\d{4})-(\d{2})$/.exec(String(period).trim());
  if (fy && +fy[2] > 12) {
    const y = +fy[1];
    if ((y + 1) % 100 !== +fy[2]) return null;
    return { start: utc(y, 6, 1), end: utc(y + 1, 5, 30), point: false };
  }
  return periodSpan(period);
}

export const dateMs = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? utc(+m[1], +m[2] - 1, +m[3]) : NaN;
};

export type Obs = { period: string; value: number };

/**
 * The observation for a baseline date: the period that covers the date (2025-Q2 for 3 May 2025, 2022-05 for 21 May
 * 2022, the year 2022 for an annual series); for a series of dated points (the cash rate's decision dates), the last
 * point on or before the date, which is the value in force that day. Null when the series does not reach back.
 */
export function baselineObs(obs: Obs[], date: string): Obs | null {
  const t = dateMs(date);
  if (!Number.isFinite(t)) return null;
  const spans = obs.map((o) => ({ o, s: spanOf(o.period) })).filter((x) => x.s && Number.isFinite(x.o.value)) as Array<{ o: Obs; s: NonNullable<ReturnType<typeof spanOf>> }>;
  if (!spans.length) return null;
  if (spans.every((x) => x.s.point)) {
    const before = spans.filter((x) => x.s.start <= t).sort((a, b) => a.s.start - b.s.start);
    return before.at(-1)?.o ?? null;
  }
  return spans.find((x) => !x.s.point && x.s.start <= t && t <= x.s.end)?.o ?? null;
}

/** The latest observation by period end. */
export function latestObs(obs: Obs[]): Obs | null {
  let best: { o: Obs; end: number } | null = null;
  for (const o of obs) {
    const s = spanOf(o.period);
    if (!s || !Number.isFinite(o.value)) continue;
    if (!best || s.end > best.end) best = { o, end: s.end };
  }
  return best?.o ?? null;
}

/** Sum of the four quarters ending at each quarter (annual totals from a quarterly flow series). */
export function sumFourQuarters(obs: Obs[]): Obs[] {
  const q = new Map(obs.filter((o) => /^\d{4}-Q[1-4]$/.test(o.period)).map((o) => [o.period, o.value]));
  const prev = (p: string) => { const y = +p.slice(0, 4), n = +p.slice(6); return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`; };
  const out: Obs[] = [];
  for (const p of [...q.keys()].sort()) {
    const ps = [p]; while (ps.length < 4) ps.push(prev(ps.at(-1)!));
    if (ps.every((x) => q.has(x))) out.push({ period: p, value: ps.reduce((s, x) => s + q.get(x)!, 0) });
  }
  return out;
}

/** a − b for each period both series have (real wages: WPI growth less CPI inflation). */
export function difference(a: Obs[], b: Obs[]): Obs[] {
  const bm = new Map(b.map((o) => [o.period, o.value]));
  return a.filter((o) => bm.has(o.period)).map((o) => ({ period: o.period, value: +(o.value - bm.get(o.period)!).toFixed(4) }));
}

// ---------------------------------------------------------------------------------------------------- promises

export type Method = 'cumulative_sum' | 'level' | 'share' | 'change';
export type Rating = 'ahead' | 'on track' | 'behind' | 'off track' | 'met' | 'missed' | 'not yet rated';
export const RATINGS: Rating[] = ['ahead', 'on track', 'behind', 'off track', 'met', 'missed', 'not yet rated'];

/** Thresholds on pace achieved ÷ pace needed. Fixed, published in the methodology. */
export const THRESHOLDS = { ahead: 1.1, onTrack: 0.9, behind: 0.6 } as const;
/** A rating needs at least this many readings since the commitment's start; fewer is "not yet rated". */
export const MIN_READINGS = 2;

export type Commitment = {
  method: Method;
  /** The target, in target_unit: a count for cumulative_sum, a level for level/share, a % reduction for change. */
  target_value: number;
  /** When counting starts (cumulative_sum) or the starting reading is taken (level, share, change). */
  start_date: string;
  target_date: string;
  /** 'increase' when the series must rise to the target, 'decrease' when it must fall. */
  direction?: 'increase' | 'decrease';
  /** For change: the reference level the % is measured from (2005 emissions for "43% below 2005 levels"). */
  baseline_value?: number | null;
};

export type Assessment = {
  rating: Rating;
  /** Progress in the target's own terms (homes completed so far; the level reached; the % reduction so far). */
  progress: number | null;
  /** Progress as a share of the distance to the target, 0 to 100+ (the bar). */
  pct: number | null;
  /** Units per year: what has been achieved since the start, and what is needed from here to the deadline. */
  paceAchieved: number | null;
  paceNeeded: number | null;
  ratio: number | null;
  latestPeriod: string | null;
  readings: number;
  deadlinePassed: boolean;
  /** One plain sentence on how the rating was reached. */
  note: string;
};

/** The rating for a pace ratio (achieved ÷ needed). */
export function ratingForRatio(ratio: number): Rating {
  if (ratio >= THRESHOLDS.ahead) return 'ahead';
  if (ratio >= THRESHOLDS.onTrack) return 'on track';
  if (ratio >= THRESHOLDS.behind) return 'behind';
  return 'off track';
}

/** Where the commitment stands in its own terms at a reading (signed so that "more" is always toward the target). */
function standing(c: Commitment, value: number): number {
  if (c.method === 'change') {
    const ref = c.baseline_value ?? NaN;
    // A % reduction below the reference (or a % rise above it, for an increase target).
    return c.direction === 'increase' ? ((value - ref) / ref) * 100 : ((ref - value) / ref) * 100;
  }
  return value;
}

/**
 * Rate a commitment from its series. Pace achieved is the average since the start (progress made ÷ years elapsed):
 * reproducible from the stored series alone, and steadier than a recent window for lumpy quarterly data. Pace needed is
 * the remaining distance ÷ years left to the deadline. Once the data covers the deadline, the verdict is met or missed.
 */
export function assess(c: Commitment, obs: Obs[]): Assessment {
  const start = dateMs(c.start_date);
  const deadline = dateMs(c.target_date);
  const empty = (note: string, extra: Partial<Assessment> = {}): Assessment => ({
    rating: 'not yet rated', progress: null, pct: null, paceAchieved: null, paceNeeded: null, ratio: null,
    latestPeriod: null, readings: 0, deadlinePassed: false, note, ...extra,
  });
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || !(deadline > start) || !Number.isFinite(c.target_value)) return empty('The commitment is missing a start, deadline or target.');
  if (c.method === 'change' && !(Number(c.baseline_value) > 0)) return empty('The reference level for this target is not stored.');

  const rows = obs.map((o) => ({ o, s: spanOf(o.period) })).filter((x) => x.s && Number.isFinite(x.o.value))
    .sort((a, b) => a.s!.end - b.s!.end) as Array<{ o: Obs; s: NonNullable<ReturnType<typeof spanOf>> }>;
  const decreasing = c.direction === 'decrease';

  let progress: number;
  let made: number;
  let fromMs: number;
  let latest: (typeof rows)[number];
  let readings: number;
  let distance: number; // the whole way from the start to the target, for the bar
  let atDeadline: (typeof rows)[number] | undefined;

  if (c.method === 'cumulative_sum') {
    // Count only periods wholly inside the window: a quarter that began before the start is not part of the target.
    const inWindow = rows.filter((x) => x.s.start >= start && x.s.end <= deadline + DAY);
    if (!inWindow.length) return empty('No readings since the commitment began yet.');
    readings = inWindow.length;
    latest = inWindow.at(-1)!;
    progress = inWindow.reduce((s, x) => s + x.o.value, 0);
    made = progress;
    fromMs = start;
    distance = c.target_value;
    // The deadline is covered once a period ends on or after the deadline's last day.
    atDeadline = rows.find((x) => x.s.end >= deadline - DAY) ? latest : undefined;
  } else {
    // level, share, change: the reading at the start, then the latest.
    const first = [...rows].reverse().find((x) => x.s.start <= start) ?? rows.find((x) => x.s.end >= start);
    const after = rows.filter((x) => x.s.end > (first?.s.end ?? Infinity));
    if (!first) return empty('The series does not reach back to the commitment\'s start.');
    readings = after.length + 1;
    latest = after.at(-1) ?? first;
    const s0 = standing(c, first.o.value);
    const sign = c.method === 'change' ? 1 : decreasing ? -1 : 1;
    fromMs = first.s.end;
    distance = sign * (c.target_value - s0);
    atDeadline = rows.find((x) => x.s.start <= deadline && deadline <= x.s.end) ?? (rows.at(-1)!.s.end >= deadline ? rows.at(-1) : undefined);
    progress = standing(c, (atDeadline ?? latest).o.value);
    made = sign * (progress - s0);
  }

  const latestEnd = latest.s.end;
  const reached = (p: number) => (c.method === 'cumulative_sum' || c.method === 'change' ? p >= c.target_value
    : decreasing ? p <= c.target_value : p >= c.target_value);
  const pctOf = (madeSoFar: number) => (distance > 0 ? Math.max(0, (madeSoFar / distance) * 100) : null);
  const deadlinePassed = latestEnd >= deadline - DAY;

  if (atDeadline) {
    const met = reached(progress);
    return {
      rating: met ? 'met' : 'missed', progress, pct: pctOf(made), paceAchieved: null, paceNeeded: null, ratio: null,
      latestPeriod: latest.o.period, readings, deadlinePassed: true,
      note: met ? 'The data for the deadline shows the target was reached.' : 'The data for the deadline shows the target was not reached.',
    };
  }
  if (readings < MIN_READINGS) {
    return { ...empty(`Rated once there are ${MIN_READINGS} readings since the start; there is ${readings}.`), progress, pct: pctOf(made), latestPeriod: latest.o.period, readings };
  }
  const elapsed = (latestEnd - fromMs) / YEAR;
  const left = (deadline - latestEnd) / YEAR;
  const paceAchieved = elapsed > 0 ? made / elapsed : null;
  const remaining = distance - made;
  if (remaining <= 0 || reached(progress)) {
    // Already at the target before the deadline. A count cannot fall back, so it is met; a level can, so it stays ahead.
    const rating: Rating = c.method === 'cumulative_sum' ? 'met' : 'ahead';
    return { rating, progress, pct: pctOf(made), paceAchieved, paceNeeded: 0, ratio: null, latestPeriod: latest.o.period, readings, deadlinePassed,
      note: rating === 'met' ? 'The target has been reached before the deadline.' : 'The target level has been reached; it is assessed again at the deadline.' };
  }
  const paceNeeded = left > 0 ? remaining / left : null;
  if (paceAchieved == null || paceNeeded == null) {
    return { ...empty('Not enough time has passed to measure a pace.'), progress, pct: pctOf(made), latestPeriod: latest.o.period, readings };
  }
  const ratio = paceAchieved / paceNeeded;
  return {
    rating: ratingForRatio(ratio), progress, pct: pctOf(made), paceAchieved, paceNeeded, ratio,
    latestPeriod: latest.o.period, readings, deadlinePassed,
    note: `Average pace since the start is ${(ratio * 100).toFixed(0)} per cent of the pace needed from here to the deadline.`,
  };
}

/** Which commitments a term shows: those still running at the term's start (deadline after it). */
export const inTerm = (c: { target_date: string }, term: TermKey) => dateMs(c.target_date) >= dateMs(TERMS[term].date);

/** "Of 6 promises: 1 ahead, 2 on track, 1 behind, 1 off track, 1 not yet rated." */
export function summaryLine(ratings: Rating[]): string {
  if (!ratings.length) return '';
  const order: Rating[] = ['met', 'ahead', 'on track', 'behind', 'off track', 'missed', 'not yet rated'];
  const parts = order.map((r) => [r, ratings.filter((x) => x === r).length] as const).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`);
  return `Of ${ratings.length} promise${ratings.length === 1 ? '' : 's'} with data: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------------------------------- outcomes

export type ChangeKind = 'pp' | 'pct' | 'abs';

/** The change between two readings: percentage points for rates, per cent for levels, plain units otherwise. */
export function changeBetween(from: number, to: number, kind: ChangeKind): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (kind === 'pct') return from === 0 ? null : ((to - from) / Math.abs(from)) * 100;
  return to - from;
}

/** ▲ up, ▼ down, ▬ unchanged. Direction only: never coloured as good or bad. */
export const marker = (change: number | null, epsilon = 1e-9) => (change == null ? '' : change > epsilon ? '▲' : change < -epsilon ? '▼' : '▬');

// ---------------------------------------------------------------------------------------------------- wording guard

/** Words the scorecard never uses about the government: no grades, no verdicts. Tested against every fixed text. */
export const EVALUATIVE = /\b(?:fail(?:ed|ing|ure)?|success(?:ful)?|good|bad|poor(?:ly)?|strong(?:ly)?|weak(?:ly)?|excellent|disappointing|impressive|broken|kept|grade[sd]?|score[sd]?)\b|—/i;

// ---------------------------------------------------------------------------------------------------- the strict check

export type Status = 'active' | 'awaiting_data' | 'held' | 'retired';

/**
 * Where a commitment stands after the strict check, fail closed. Shown only when the quote was found in the document's
 * own text AND the source check ran AND it confirmed the quote and the target read from it. Live only with an official
 * stored series that reaches back to the commitment's start; otherwise it waits for data (and a series is requested).
 */
export function decideStatus(c: { quote_found: boolean; audited: boolean; confirmed: boolean; metric_id: string | null; covered: boolean }): Status {
  if (!c.quote_found || !c.audited || !c.confirmed) return 'held';
  if (!c.metric_id || !c.covered) return 'awaiting_data';
  return 'active';
}

/** True when the series can measure the commitment from its start: the period holding the start date is stored. */
export function coversStart(c: Pick<Commitment, 'start_date' | 'method'>, obs: Obs[]): boolean {
  const t = dateMs(c.start_date);
  if (!Number.isFinite(t)) return false;
  return obs.some((o) => {
    const s = spanOf(o.period);
    if (!s || !Number.isFinite(o.value)) return false;
    // A count needs the first whole period of the window; a level needs a reading at or before the start.
    return c.method === 'cumulative_sum' ? s.start >= t && s.start - t < 32 * DAY : s.start <= t;
  });
}

export const slugify = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "June 2029" for 2029-06-30. */
export const monthYear = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? '');
  return m ? `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : (iso ?? '');
};
/** "3 May 2025" for 2025-05-03. */
export const longDate = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${+m[3]} ${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : (iso ?? '');
};

export type CommitmentDraft = {
  slug: string; title: string; quote: string; source_url: string; source_title: string | null; source_date: string | null;
  metric_id: string | null; series_label: string | null; data_note: string | null;
  target_value: number; target_unit: string; target_date: string; start_date: string;
  direction: 'increase' | 'decrease'; baseline_value: number | null; baseline_period: string | null; method: Method;
  needs?: { series: string; org: string } | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const METHODS: Method[] = ['cumulative_sum', 'level', 'share', 'change'];

/**
 * A model-drafted commitment, cleaned, or the reason it cannot be one: an official (.gov.au) source, a verbatim quote of
 * real length, a numeric target, ISO dates with the deadline after the start, a known method, no evaluative words.
 */
export function normaliseDraft(raw: unknown): { ok: true; draft: CommitmentDraft } | { ok: false; reason: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const title = str(r.title);
  const quote = str(r.quote);
  const url = str(r.source_url);
  const target = r.target_value == null || r.target_value === '' ? NaN : Number(r.target_value);
  const method = str(r.method) as Method;
  const start = str(r.start_date);
  const end = str(r.target_date);
  if (!title || !quote) return { ok: false, reason: 'no title or quote' };
  if (quote.split(' ').length < 5) return { ok: false, reason: 'quote too short to verify' };
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, reason: 'no source url' }; }
  if (!host.endsWith('.gov.au')) return { ok: false, reason: `not an official source (${host})` };
  if (!Number.isFinite(target)) return { ok: false, reason: 'no numeric target' };
  if (!METHODS.includes(method)) return { ok: false, reason: `unknown method ${method || '(none)'}` };
  if (!ISO.test(start) || !ISO.test(end) || !(dateMs(end) > dateMs(start))) return { ok: false, reason: 'start and deadline must be dates, deadline after start' };
  if (EVALUATIVE.test(title)) return { ok: false, reason: 'evaluative wording in the title' };
  const metric = str(r.metric_id);
  const n = r.needs && typeof r.needs === 'object' ? r.needs as Record<string, unknown> : null;
  const needs = n ? { series: str(n.series), org: str(n.org) } : null;
  const bv = r.baseline_value == null || r.baseline_value === '' ? NaN : Number(r.baseline_value);
  return {
    ok: true,
    draft: {
      slug: slugify(str(r.slug) || title), title, quote, source_url: url, source_title: str(r.source_title) || null,
      source_date: ISO.test(str(r.source_date)) ? str(r.source_date) : null,
      metric_id: /^[a-z0-9_:]+$/.test(metric) ? metric : null, series_label: str(r.series_label) || null, data_note: str(r.data_note) || null,
      target_value: target, target_unit: str(r.target_unit), target_date: end, start_date: start,
      direction: str(r.direction) === 'decrease' ? 'decrease' : 'increase', baseline_value: Number.isFinite(bv) ? bv : null,
      baseline_period: str(r.baseline_period) || null, method, needs: needs?.series && needs.org ? needs : null,
    },
  };
}

/** Fields whose change counts as a changed commitment (logged as 'changed'). */
export function changedFields(a: Partial<CommitmentDraft>, b: Partial<CommitmentDraft>): string[] {
  const keys: Array<keyof CommitmentDraft> = ['quote', 'source_url', 'target_value', 'target_unit', 'target_date', 'start_date', 'method', 'direction', 'metric_id', 'baseline_value'];
  return keys.filter((k) => String(a[k] ?? '') !== String(b[k] ?? ''));
}
