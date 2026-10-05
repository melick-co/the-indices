import { createClient } from '@/lib/supabase-server';
import type { Point, Reading, SectionReading } from '@/lib/economy-dashboard';
import { formatReading } from '@/lib/economy-dashboard';

/**
 * Published polls (agent/scripts/watch-polls.mjs → `polls`). Private sources: shown only as labelled context.
 * Averages take each pollster's latest poll in a window, so a pollster publishing weekly does not outweigh one
 * publishing monthly; MRP models re-use a firm's own fieldwork and are left out of averages.
 */
export type Poll = {
  /** vi (voting intention), dir (direction), appr (leader approval), ppm:<names> (a preferred-PM contest). */
  key: string; table: string; pollster: string; client: string | null; mode: string | null; sample: number | null;
  start: string; end: string; source: string; values: Record<string, number>;
};

export const PARTY_LABEL: Record<string, string> = { alp: 'Labor', lnp: 'Coalition', grn: 'Greens', onp: 'One Nation', oth: 'Others' };

export async function loadPolls(): Promise<Poll[]> {
  const db = createClient();
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('polls').select('poll_key, measure, value, field_start, field_end, pollster, client, mode, sample_size, source_url')
      .order('field_end', { ascending: false }).range(from, from + 999);
    if (error || !data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const polls = new Map<string, Poll>();
  for (const r of rows) {
    const key = String(r.poll_key);
    const p = polls.get(key) ?? {
      key, table: key.split('|')[2] ?? 'vi', pollster: String(r.pollster), client: (r.client as string) ?? null,
      mode: (r.mode as string) ?? null, sample: (r.sample_size as number) ?? null,
      start: String(r.field_start ?? r.field_end), end: String(r.field_end), source: String(r.source_url), values: {},
    } as Poll;
    p.values[String(r.measure)] = Number(r.value);
    polls.set(key, p);
  }
  for (const p of polls.values()) {
    const { direction_right: r, direction_wrong: w } = p.values;
    if (r != null && w != null) p.values.direction_net = round1(r - w);
  }
  return [...polls.values()].sort((a, b) => b.end.localeCompare(a.end));
}

const isModel = (p: Poll) => /\bMRP\b/i.test(p.pollster);
/** The firm behind a poll, so a firm's partnered releases ("RedBridge", "RedBridge/Accent") count once. */
const firm = (p: Poll) => p.pollster.toLowerCase().replace(/\/accent$/, '');
const round1 = (n: number) => Math.round(n * 10) / 10;
const dayMs = 864e5;

export type PollAverage = { value: number; n: number; pollsters: string[]; from: string; to: string };

/** Average of each pollster's latest poll on a measure within `days` before `asOf` (default: the latest poll). */
export function pollAverage(polls: Poll[], measure: string, days = 30, asOf?: string): PollAverage | null {
  const withM = polls.filter((p) => p.values[measure] != null && !isModel(p) && (!asOf || p.end <= asOf));
  if (!withM.length) return null;
  const to = asOf ?? withM[0].end;
  const cutoff = new Date(new Date(to).getTime() - days * dayMs).toISOString().slice(0, 10);
  const latest = new Map<string, Poll>();
  for (const p of withM) if (p.end > cutoff && p.end <= to && !latest.has(firm(p))) latest.set(firm(p), p);
  const list = [...latest.values()];
  if (!list.length) return null;
  return {
    value: round1(list.reduce((s, p) => s + p.values[measure], 0) / list.length), n: list.length,
    pollsters: list.map((p) => p.pollster), from: list.map((p) => p.start).sort()[0], to,
  };
}

/** Monthly average of every poll on a measure (field end month), oldest first. */
export function monthlyTrend(polls: Poll[], measure: string): Point[] {
  const by = new Map<string, number[]>();
  for (const p of polls) {
    if (p.values[measure] == null || isModel(p)) continue;
    const m = p.end.slice(0, 7);
    by.set(m, [...(by.get(m) ?? []), p.values[measure]]);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, value: round1(v.reduce((s, x) => s + x, 0) / v.length) }));
}

/** Each pollster's latest poll that reports a measure, newest first. */
export function latestByPollster(polls: Poll[], measure: string): Poll[] {
  const seen = new Set<string>();
  return polls.filter((p) => p.values[measure] != null && !isModel(p) && !seen.has(firm(p)) && seen.add(firm(p)));
}

export const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Does the official data back the mood? Counts the household-pressure readings that are worse than usual (or
 * above target), and sets that against consumer confidence and the direction polls. Plain sentences from the
 * numbers; no judgement beyond the count.
 */
export function moodCheck(consumers: SectionReading, direction: PollAverage | null, wrong: PollAverage | null) {
  const cc = consumers.headline;
  const tests = consumers.others.filter((r) => r.latest);
  const pressure = (r: Reading) => r.status === 'worse' || (r.indicator.benchmark.kind === 'target' && r.status === 'above');
  const relief = (r: Reading) => r.status === 'better' || r.status === 'on-target';
  const worse = tests.filter(pressure);
  const ok = tests.filter(relief);
  const known = cc.latest != null || direction != null;
  const gloomy = (cc.latest ? cc.latest.value < 100 : false) || (direction != null && direction.value < 0);
  // Lower-case only an ordinary first word ("Rents" → "rents", but "CPI" stays).
  const name = (r: Reading) => { const s = r.indicator.short ?? r.indicator.label; return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; };
  const list = (rs: Reading[]) => rs.map((r) => `${name(r)} (${r.latest ? formatReading(r.latest.value, r.indicator.unit) : '—'})`).join(', ');

  const mood: string[] = [];
  if (cc.latest) mood.push(`Consumer confidence is ${formatReading(cc.latest.value, cc.indicator.unit)}, ${cc.latest.value < 100 ? 'below' : 'above'} its long-run average of 100`);
  if (direction && wrong) {
    // Direction polls are irregular: date them, and use the past tense once they are more than a month old.
    const stale = Date.now() - new Date(wrong.to).getTime() > 31 * dayMs;
    const month = new Date(`${wrong.to}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    mood.push(`in the latest direction polls (to ${month}) an average of ${wrong.value}% ${stale ? 'said' : 'say'} the country ${stale ? 'was' : 'is'} heading in the wrong direction (net ${direction.value > 0 ? '+' : ''}${direction.value})`);
  }
  const verdict = !known ? 'unknown' : !tests.length ? 'mixed'
    : gloomy ? (worse.length * 2 > tests.length ? 'backs' : worse.length <= 1 ? 'runs-ahead' : 'mixed')
      : (ok.length * 2 > tests.length ? 'backs' : 'mixed');
  const lines = [
    mood.length ? `${mood.join('; ').charAt(0).toUpperCase()}${mood.join('; ').slice(1)}.` : '',
    `Of ${tests.length} official ${tests.length === 1 ? 'measure' : 'measures'} of household pressure, ${worse.length} ${worse.length === 1 ? 'is' : 'are'} worse than usual${worse.length ? `: ${list(worse)}` : ''}${ok.length ? `; ${ok.length} ${ok.length === 1 ? 'is' : 'are'} better than usual or on target: ${list(ok)}` : ''}.`,
    !known ? 'There is no reading of the mood yet to test.'
      : gloomy
      ? verdict === 'backs' ? 'The official numbers back the gloom.' : verdict === 'runs-ahead' ? 'The gloom runs ahead of the official numbers.' : 'The official numbers give the gloom only partial support.'
      : verdict === 'backs' ? 'The official numbers back the optimism.' : 'The official numbers give the optimism only partial support.',
  ].filter(Boolean);
  return { gloomy, verdict, lines, worse, ok };
}

// ---------------------------------------------------------------------------------------------------- leaders

export type Role = 'pm' | 'opposition' | 'other';
export const ROLE_LABEL: Record<Role, string> = { pm: 'Prime Minister', opposition: 'Opposition leader', other: 'Other leader' };

/** The measure for whoever currently holds a role (from the latest poll naming one), e.g. approval_net:pm:Albanese. */
export function currentMeasure(polls: Poll[], prefix: string, role: Role, name?: string): string | null {
  for (const p of polls) {
    const k = Object.keys(p.values).find((x) => x.startsWith(`${prefix}:${role}:`) && (!name || x.endsWith(`:${name}`)));
    if (k) return k;
  }
  return null;
}
export const personOf = (measure: string) => measure.split(':')[2];

/** A role's monthly average whoever held it, with who held it when (for captions). */
export function roleTrend(polls: Poll[], prefix: string, role: Role): { points: Point[]; holders: { name: string; from: string; to: string }[] } {
  const by = new Map<string, number[]>();
  const holders: { name: string; from: string; to: string }[] = [];
  for (const p of [...polls].reverse()) {
    if (isModel(p)) continue;
    const k = Object.keys(p.values).find((x) => x.startsWith(`${prefix}:${role}:`));
    if (!k) continue;
    const m = p.end.slice(0, 7);
    by.set(m, [...(by.get(m) ?? []), p.values[k]]);
    const name = personOf(k);
    if (holders.at(-1)?.name === name) holders.at(-1)!.to = m; else holders.push({ name, from: m, to: m });
  }
  return {
    points: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, value: round1(v.reduce((s, x) => s + x, 0) / v.length) })),
    holders,
  };
}

/** Head-to-head preferred-PM polls only (the PM against the Opposition leader, no third name). */
export function headToHead(polls: Poll[]): Poll[] {
  return polls.filter((p) => p.table.startsWith('ppm') && (() => {
    const ks = Object.keys(p.values).filter((k) => k.startsWith('ppm:'));
    return ks.length === 2 && ks.some((k) => k.startsWith('ppm:pm:')) && ks.some((k) => k.startsWith('ppm:opposition:'));
  })());
}
