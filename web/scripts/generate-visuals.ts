/**
 * Visuals for The Indices: Visual Capitalist-style graphics from stored official data, auto-published under a daily cap.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/generate-visuals.ts             # publish up to the daily cap
 *   npx tsx --import ./scripts/node-shims.mjs scripts/generate-visuals.ts --dry-run   # pick, write and check; store nothing
 *   npx tsx --import ./scripts/node-shims.mjs scripts/generate-visuals.ts --list      # every candidate and its score
 *   npx tsx --import ./scripts/node-shims.mjs scripts/generate-visuals.ts --key rank:hsl_11_1   # force a dataset
 *
 * Each visual: a dataset (lib/visuals-data.ts) → facts computed from it → the model writes a title, subtitle and
 * takeaways from those facts only → every number in the text must match a number in the facts (to the precision
 * written) → published. The page draws the chart from the stored spec, so words and graphic come from the same numbers.
 */
import { createClient } from '@/lib/supabase-server';
import { MODEL } from '@/lib/research-agent';
import { formatReading } from '@/lib/economy-dashboard';
import { buildDatasets, type Dataset, type VisualSpec } from '@/lib/visuals-data';

const DAILY_CAP = Number(process.env.VISUALS_DAILY_CAP ?? 1);
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const list = args.includes('--list');
// One or more dataset keys to force (space separated), from --key or the workflow's pitch input.
const forcedKeys = ((args.includes('--key') ? args[args.indexOf('--key') + 1] : process.env.VISUAL_KEY) ?? '').split(/\s+/).filter(Boolean);
const forced = forcedKeys.length ? forcedKeys : null;

// ------------------------------------------------------------------------------------------------ facts

export function fmtValue(v: number, unit: VisualSpec['unit']): string {
  if (unit === 'persons') return Math.round(v).toLocaleString('en-AU');
  if (unit === 'aud_m') return `$${(v / 1000).toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} billion`;
  return formatReading(v, unit as never);
}
const pct = (v: number, d = 1) => `${(Math.round(v * 10 ** d) / 10 ** d).toFixed(d)}%`;
const ord = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Plain sentences of numbers the model may use, and nothing else. */
export function facts(d: Dataset): string[] {
  const s = d.spec;
  const f: string[] = [`Measure: ${s.measure}. Period: ${s.period}${s.priorPeriod ? `, compared with ${s.priorPeriod}` : ''}.`];
  if (s.template === 'ranked') {
    const aus = s.rows.find((r) => r.highlight);
    const dir = s.bestFirst ? (s.higherIsBetter ? 'highest is best' : 'lowest is best') : 'ranked highest first';
    f.push(`${s.of} OECD countries are ranked (${dir}). The OECD median is ${fmtValue(s.median!, s.unit)}.`);
    if (aus) f.push(`Australia: ${fmtValue(aus.value, s.unit)}, ranked ${ord(s.rank!)} of ${s.of}, ${aus.value > s.median! ? 'above' : aus.value < s.median! ? 'below' : 'at'} the median.`);
    f.push(`Top three: ${s.rows.slice(0, 3).map((r) => `${r.label} ${fmtValue(r.value, s.unit)}`).join('; ')}.`);
    f.push(`Bottom three: ${s.rows.slice(-3).map((r) => `${r.label} ${fmtValue(r.value, s.unit)}`).join('; ')}.`);
    f.push(`All countries: ${s.rows.map((r, i) => `${i + 1}. ${r.label} ${fmtValue(r.value, s.unit)}`).join('; ')}.`);
  } else if (s.template === 'treemap') {
    const total = s.total ?? s.rows.reduce((t, r) => t + r.value, 0);
    f.push(`Total: ${fmtValue(total, s.unit)}.`);
    for (const r of s.rows) f.push(`${r.label}: ${fmtValue(r.value, s.unit)}, ${pct((r.value / total) * 100)} of the total.`);
  } else {
    const rows = s.rows.filter((r) => r.prior != null && r.prior > 0);
    for (const r of rows) f.push(`${r.label}: ${fmtValue(r.value, s.unit)}, against ${fmtValue(r.prior!, s.unit)} (${r.value >= r.prior! ? 'up' : 'down'} ${pct(Math.abs((r.value / r.prior! - 1) * 100))}; ${pct((r.value / r.prior!) * 100, 0)} of the earlier level).`);
    const ranked = [...rows].sort((a, b) => b.value / b.prior! - a.value / a.prior!);
    if (ranked.length) f.push(`Largest rise: ${ranked[0].label}. Largest fall or smallest rise: ${ranked.at(-1)!.label}.`);
  }
  f.push(`Context: ${d.context}`);
  return f;
}

// ------------------------------------------------------------------------------------------------ number check

type Num = { value: number; pct: boolean; tol: number; text: string };

/** Numbers in text as values in base units ("$2.9 trillion" → 2.9e12, "1.4 million" → 1.4e6, "12.5%" → 12.5 pct). */
export function numbers(text: string): Num[] {
  const out: Num[] = [];
  const re = /(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|per cent|trillion|billion|bn|million|m\b|thousand|k\b)?/gi;
  for (const m of text.matchAll(re)) {
    const intPart = m[2].replace(/,/g, '');
    const dec = m[3] ?? '';
    const unit = (m[4] ?? '').toLowerCase();
    const mult = unit === 'trillion' ? 1e12 : unit === 'billion' || unit === 'bn' ? 1e9 : unit === 'million' || unit === 'm' ? 1e6 : unit === 'thousand' || unit === 'k' ? 1e3 : 1;
    const isPct = unit === '%' || unit === 'per cent';
    const v = Number(`${intPart}${dec}`) * mult;
    const places = dec ? dec.length - 1 : 0;
    // What was written can be a rounding of the real value: half a unit in its last place.
    const tol = 0.5 * 10 ** -places * mult + 1e-9;
    out.push({ value: v, pct: isPct, tol, text: m[0].trim() });
  }
  return out;
}

/** Every number in the text must match one in the facts (same kind, within the rounding of what was written). */
export function checkNumbers(text: string, factText: string, years: Set<number>): string[] {
  const allowed = numbers(factText);
  const problems: string[] = [];
  for (const n of numbers(text)) {
    if (!n.pct && Number.isInteger(n.value) && n.value >= 1900 && n.value <= 2100 && years.has(n.value)) continue;
    // Small counts and ranks ("top three", "12 countries", "7th") are allowed when they appear in the facts too.
    const ok = allowed.some((a) => a.pct === n.pct && Math.abs(a.value - n.value) <= Math.max(n.tol, a.tol));
    if (!ok) problems.push(`"${n.text}" is not in the facts`);
  }
  return problems;
}

// ------------------------------------------------------------------------------------------------ writing

type Copy = { title: string; subtitle: string; takeaways: string[]; alt: string };

async function write(d: Dataset, factLines: string[], feedback?: string): Promise<Copy> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const system = `You write the words for a data graphic in the style of Visual Capitalist, for "The Indices", an Australian data site.
Rules:
- Use ONLY the numbers in the facts. Do not round to a different precision than shown unless you write fewer digits of the same number (e.g. $2,927.1 billion may become $2.9 trillion). Never invent, add or subtract numbers yourself.
- Title: punchy, under 80 characters, sentence case, optionally starting "Ranked:", "Visualised:" or "Charted:". Australian spelling.
- Subtitle: one sentence saying what is measured, where and when.
- Takeaways: 3 to 5 short sentences, each one specific fact from the data. No causes, forecasts or opinions; no exclamation marks.
- alt: one sentence describing the graphic for screen readers.
Return JSON only: {"title": "...", "subtitle": "...", "takeaways": ["..."], "alt": "..."}`;
  const user = `Graphic type: ${d.spec.template === 'ranked' ? 'a ranked bar chart of countries' : d.spec.template === 'treemap' ? 'a treemap of shares of a total' : 'bars comparing two periods'}.
Facts:
${factLines.map((l) => `- ${l}`).join('\n')}${feedback ? `\n\nYour last draft failed these checks; fix them:\n${feedback}` : ''}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const raw = (body.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n');
  return JSON.parse(raw.replace(/```json|```/g, '').trim()) as Copy;
}

function styleProblems(c: Copy): string[] {
  const p: string[] = [];
  if (!c.title || c.title.length > 90) p.push('title missing or over 90 characters');
  if (!Array.isArray(c.takeaways) || c.takeaways.length < 3 || c.takeaways.length > 5) p.push('need 3 to 5 takeaways');
  if ([c.title, c.subtitle, ...(c.takeaways ?? [])].some((t) => /!/.test(t ?? ''))) p.push('no exclamation marks');
  if ((c.takeaways ?? []).some((t) => t.length > 220)) p.push('a takeaway is over 220 characters');
  return p;
}

// ------------------------------------------------------------------------------------------------ choosing

function score(d: Dataset, recent: Map<string, number>, lastTemplate: string | null): number {
  const age = recent.get(d.key);
  const cooldown = d.spec.template === 'ranked' ? 60 : 30;
  if (age != null && age < cooldown) return -1;
  let s = d.spec.template === 'ranked' ? 0.4 : d.spec.template === 'treemap' ? 0.6 : 0.65;
  if (d.spec.template === 'ranked' && d.spec.rank && d.spec.of) {
    const pos = (d.spec.rank - 1) / (d.spec.of - 1);
    s = 0.3 + Math.max(pos, 1 - pos) * 0.5 + (d.spec.rank <= 3 || d.spec.rank > d.spec.of - 3 ? 0.15 : 0);
  }
  if (lastTemplate && d.spec.template === lastTemplate) s -= 0.2;
  return s;
}

const slugify = (t: string) => t.toLowerCase().replace(/^(ranked|visualised|charted):\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

async function main() {
  const db = createClient();
  const all = await buildDatasets();
  const { data: past } = await db.from('visuals').select('dataset_key, template, published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(200);
  const now = Date.now();
  const recent = new Map<string, number>();
  for (const v of past ?? []) if (!recent.has(v.dataset_key)) recent.set(v.dataset_key, (now - new Date(v.published_at).getTime()) / 864e5);
  const lastTemplate = past?.[0]?.template ?? null;
  const ranked = all.map((d) => ({ d, s: score(d, recent, lastTemplate) })).sort((a, b) => b.s - a.s);
  console.log(`${all.length} candidate datasets.`);
  if (list) { for (const { d, s } of ranked) console.log(`${s.toFixed(2)}  ${d.key}  (${d.spec.template}, ${d.spec.rows.length} rows, ${d.spec.period})`); return; }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  const publishedToday = (past ?? []).filter((v) => new Date(v.published_at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) === today).length;
  let room = forced ? forced.length : Math.max(0, DAILY_CAP - publishedToday);
  if (!room) { console.log(`Daily cap reached (${DAILY_CAP}); nothing to do.`); return; }

  const queue = forced ? forced.map((k) => all.find((d) => d.key === k)).filter((d): d is Dataset => !!d) : ranked.filter((x) => x.s > 0).map((x) => x.d);
  if (forced && queue.length !== forced.length) throw new Error(`Unknown dataset key in: ${forced.join(' ')}`);
  for (const d of queue) {
    if (!room) break;
    const factLines = facts(d);
    const factText = factLines.join('\n');
    const years = new Set([...factText.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])));
    let copy: Copy | null = null, problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      copy = await write(d, factLines, attempt ? problems.join('\n') : undefined);
      const text = [copy.title, copy.subtitle, ...copy.takeaways, copy.alt].join('\n');
      problems = [...styleProblems(copy), ...checkNumbers(text, factText, years)];
      if (!problems.length) break;
    }
    console.log(`\n${d.key}: ${copy?.title}\n  ${copy?.subtitle}\n${copy?.takeaways.map((t) => `  • ${t}`).join('\n')}`);
    if (problems.length) { console.log(`  REJECTED: ${problems.join('; ')}`); continue; }
    console.log('  checks passed');
    if (dry) { room--; continue; }
    const slug = `${slugify(copy!.title)}-${today}`;
    const { error } = await db.from('visuals').insert({
      slug, dataset_key: d.key, template: d.spec.template, title: copy!.title, subtitle: copy!.subtitle, takeaways: copy!.takeaways, alt: copy!.alt,
      spec: d.spec, sources: d.sources, checks: { numbers: 'all matched', facts: factLines.length }, status: 'published', published_at: new Date().toISOString(),
    });
    if (error) throw new Error(`visuals insert: ${error.message}`);
    console.log(`  published /indices/visuals/${slug}`);
    room--;
  }
}

if (process.argv[1]?.endsWith('generate-visuals.ts')) main().catch((e) => { console.error(e); process.exit(1); });
