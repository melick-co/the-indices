import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChartSeriesPoint, StoryBlock, StoryChartBlock, StoryOneNumber } from '@/lib/story-types';
import { CPI_ENTITY_NAMES, cpiMeta, cpiObservations, isCpiId } from '../../agent/scripts/lib/cpi-components.mjs';

/**
 * Fill story chart series from stored observations.
 * The model chooses what to chart (metric, mode, entities); this code supplies
 * every value, so a published chart can only show numbers that are in the store.
 */

const HOME = 'AUS';
const MAX_BARS = 10;
const DEFAULT_TIMELINE = 12;

type Obs = { entity: string; period: string; value: number };
type MetricMeta = { metric_id: string; name: string; unit: string | null; source_org: string | null; source_dataset: string | null };

const fmt = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
const isPercent = (unit: string | null | undefined) => /percent|per cent|%/i.test(unit ?? '');

/** Subtitle per NEWS-STYLE.md §4.4: what is measured, units, timeframe. */
function subtitleOf(meta: MetricMeta | null, span: string) {
  return [meta?.name, meta?.unit, span].filter(Boolean).join(', ');
}

/** Subtitle for two series on one chart: both names, the shared unit, the span. */
function subtitleOf2(a: MetricMeta | null, b: MetricMeta | null, span: string) {
  const unit = a?.unit && a.unit === b?.unit ? a.unit : [a?.unit, b?.unit].filter(Boolean).join(' / ');
  return [`${a?.name ?? 'Series 1'} and ${b?.name ?? 'Series 2'}`, unit, span].filter(Boolean).join(', ');
}

/** A writer's source line without footnote markers (the chart links its footnote itself). */
const cleanCaption = (c?: string) => c?.replace(/\s*\[\^\d+\]/g, '').trim();

export type BindResult = { chart: StoryChartBlock; ok: boolean; issue?: string };

/** All observations for a metric, paged past PostgREST's 1000-row cap. */
export async function loadObservations(db: SupabaseClient, metricId: string): Promise<Obs[]> {
  // CPI components (cpi:<code>:<measure>…) live in cpi_observations.
  if (isCpiId(metricId)) return cpiObservations(db, metricId);
  const out: Obs[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('observations')
      .select('entity, period, value')
      .eq('metric_id', metricId)
      .order('period', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`observations for ${metricId}: ${error.message}`);
    for (const o of data ?? []) out.push({ entity: String(o.entity).trim(), period: String(o.period), value: Number(o.value) });
    if ((data?.length ?? 0) < 1000) return out;
  }
}

async function loadMeta(db: SupabaseClient, metricId: string): Promise<MetricMeta | null> {
  if (isCpiId(metricId)) return cpiMeta(db, metricId);
  const { data } = await db.from('metrics')
    .select('metric_id, name, unit, source_org, source_dataset')
    .eq('metric_id', metricId).maybeSingle();
  return data as MetricMeta | null;
}

let entityNames: Map<string, string> | null = null;
async function nameOf(db: SupabaseClient, code: string): Promise<string> {
  if (!entityNames) {
    const { data } = await db.from('entities').select('code, name');
    entityNames = new Map((data ?? []).map((e) => [e.code.trim(), e.name]));
  }
  return entityNames.get(code) ?? (CPI_ENTITY_NAMES as Record<string, string>)[code] ?? code;
}

/** The period to compare countries on: Australia's latest, else the period most entities share. */
function comparisonPeriod(obs: Obs[]): string | null {
  const home = obs.filter((o) => o.entity === HOME).map((o) => o.period).sort();
  if (home.length) return home[home.length - 1];
  const counts = new Map<string, number>();
  for (const o of obs) counts.set(o.period, (counts.get(o.period) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
}

async function entitySeries(
  db: SupabaseClient, obs: Obs[], period: string, entities?: string[],
): Promise<ChartSeriesPoint[]> {
  let rows = obs.filter((o) => o.period === period);
  if (entities?.length) {
    const want = new Set(entities.map((e) => e.toUpperCase()));
    rows = rows.filter((o) => want.has(o.entity));
  } else {
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, MAX_BARS);
    const home = sorted.find((o) => o.entity === HOME);
    if (home && !top.includes(home)) top[top.length - 1] = home;
    rows = top;
  }
  rows.sort((a, b) => b.value - a.value);
  return Promise.all(rows.map(async (o) => ({
    label: await nameOf(db, o.entity),
    value: o.value,
    ...(o.entity === HOME ? { highlight: true } : {}),
  })));
}

function sourceLine(meta: MetricMeta | null, period: string) {
  const org = meta?.source_org ?? 'Source';
  return `Source: ${org}${meta?.source_dataset ? `, ${meta.source_dataset}` : ''}, ${period}.`;
}

export async function bindChart(db: SupabaseClient, chart: StoryChartBlock): Promise<BindResult> {
  const spec = chart.data;
  if (!spec?.metric_id) return { chart, ok: false, issue: 'chart has no data spec, so its values cannot be traced' };

  const [obs, meta] = await Promise.all([loadObservations(db, spec.metric_id), loadMeta(db, spec.metric_id)]);
  if (!obs.length) return { chart, ok: false, issue: `chart metric ${spec.metric_id} has no observations` };

  if (spec.mode === 'timeline') {
    const entity = (spec.entity ?? HOME).toUpperCase();
    let own = obs.filter((o) => o.entity === entity).sort((a, b) => a.period.localeCompare(b.period));
    // A second series over the same periods (headline and trimmed mean CPI; wages against prices): both lines
    // are drawn, so both must be in the store for the same periods.
    let altOwn: Obs[] | null = null;
    let altMeta: MetricMeta | null = null;
    if (spec.alt_metric_id) {
      const [altObs, am] = await Promise.all([loadObservations(db, spec.alt_metric_id), loadMeta(db, spec.alt_metric_id)]);
      const byPeriod = new Map(altObs.filter((o) => o.entity === entity).map((o) => [o.period, o]));
      own = own.filter((o) => byPeriod.has(o.period));
      altOwn = own.map((o) => byPeriod.get(o.period)!);
      altMeta = am;
      if (own.length < 2) return { chart, ok: false, issue: `chart asks for ${spec.alt_metric_id} beside ${spec.metric_id}, but they share fewer than two periods` };
    }
    const n = Math.max(2, spec.last ?? DEFAULT_TIMELINE);
    const recent = own.slice(-n);
    const recentAlt = altOwn?.slice(-n) ?? null;
    if (recent.length < 2) return { chart, ok: false, issue: `not enough ${entity} history for ${spec.metric_id}` };
    const last = recent[recent.length - 1];
    const span = `${recent[0].period} to ${last.period}`;
    const altLast = recentAlt?.[recentAlt.length - 1];
    return {
      ok: true,
      chart: {
        ...chart,
        // Change over time: a line that draws in, unless the writer asked for bars.
        kind: chart.kind === 'timeline' ? 'timeline' : 'line',
        series: recent.map((o, i) => ({ label: o.period, value: o.value, ...(i === recent.length - 1 ? { highlight: true } : {}) })),
        alt_series: recentAlt?.map((o) => ({ label: o.period, value: o.value })),
        primary_label: recentAlt ? meta?.name ?? spec.metric_id : chart.primary_label,
        alt_label: recentAlt ? altMeta?.name ?? spec.alt_metric_id : undefined,
        // The subtitle says what is plotted, from the data itself, so it cannot describe a series the chart lacks.
        subtitle: recentAlt ? subtitleOf2(meta, altMeta, span) : subtitleOf(meta, span),
        alt: chart.alt?.trim() || `${chart.title ?? meta?.name ?? spec.metric_id}: ${fmt(last.value)} in ${last.period}, from ${fmt(recent[0].value)} in ${recent[0].period}${altLast ? `; ${altMeta?.name ?? spec.alt_metric_id} ${fmt(altLast.value)}` : ''}.`,
        caption: cleanCaption(chart.caption) || sourceLine(meta, span),
        bound: { metric_id: spec.metric_id, period: last.period, ...(altLast ? { alt_metric_id: spec.alt_metric_id, alt_period: altLast.period } : {}) },
      },
    };
  }

  if (spec.alt_metric_id && chart.kind !== 'rank_swap') {
    return { chart, ok: false, issue: `chart "${chart.title ?? chart.kind}" asks for a second series (${spec.alt_metric_id}) that a ${chart.kind} chart of countries cannot draw; use rank_swap or a timeline` };
  }
  const period = comparisonPeriod(obs);
  if (!period) return { chart, ok: false, issue: `no comparable period for ${spec.metric_id}` };
  const series = await entitySeries(db, obs, period, spec.entities);
  if (series.length < 2) return { chart, ok: false, issue: `fewer than two entities for ${spec.metric_id} at ${period}` };

  let alt: Pick<StoryChartBlock, 'alt_series'> & { bound?: Partial<NonNullable<StoryChartBlock['bound']>> } = {};
  if (chart.kind === 'rank_swap' && spec.alt_metric_id) {
    const altObs = await loadObservations(db, spec.alt_metric_id);
    const altPeriod = comparisonPeriod(altObs);
    const labels = new Set(series.map((s) => s.label));
    const altSeries = altPeriod
      ? (await entitySeries(db, altObs, altPeriod, spec.entities)).filter((s) => labels.has(s.label))
      : [];
    if (altSeries.length < 2) {
      return { chart, ok: false, issue: `alt metric ${spec.alt_metric_id} does not cover the charted entities` };
    }
    alt = { alt_series: altSeries, bound: { alt_metric_id: spec.alt_metric_id, alt_period: altPeriod! } };
  }

  const home = series.find((p) => p.highlight);
  return {
    ok: true,
    chart: {
      ...chart,
      kind: chart.kind === 'rank_swap' && alt.alt_series ? 'rank_swap' : 'bars',
      series,
      alt_series: alt.alt_series,
      subtitle: alt.alt_series ? subtitleOf2(meta, await loadMeta(db, spec.alt_metric_id!), period) : subtitleOf(meta, period),
      alt: chart.alt?.trim() || `${chart.title ?? meta?.name ?? spec.metric_id}: ${home ? `Australia ${fmt(home.value)}, ` : ''}highest ${series[0].label} ${fmt(series[0].value)} (${period}).`,
      caption: cleanCaption(chart.caption) || sourceLine(meta, period),
      bound: { metric_id: spec.metric_id, period, ...alt.bound },
    },
  };
}

/** Bind every chart block in a story body. Unbindable charts are dropped and reported. */
export async function bindStoryCharts(
  db: SupabaseClient, blocks: StoryBlock[],
): Promise<{ blocks: StoryBlock[]; issues: string[]; chartMetricIds: string[] }> {
  const out: StoryBlock[] = [];
  const issues: string[] = [];
  const chartMetricIds: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'chart') { out.push(block); continue; }
    const res = await bindChart(db, block as StoryChartBlock);
    if (res.ok) {
      out.push(res.chart);
      chartMetricIds.push(res.chart.bound!.metric_id);
      if (res.chart.bound!.alt_metric_id) chartMetricIds.push(res.chart.bound!.alt_metric_id);
    } else {
      issues.push(res.issue!);
    }
  }
  return { blocks: out, issues, chartMetricIds };
}

/**
 * Hero stat card: when one_number names a metric, its value, period and
 * comparison with a year earlier come from the store, not the model.
 * Percent series compare in points; others in percent change.
 */
export async function bindOneNumber(
  db: SupabaseClient, one: StoryOneNumber | null | undefined,
): Promise<{ one: StoryOneNumber | null | undefined; issue?: string }> {
  if (!one?.metric_id) return { one };
  const [obs, meta] = await Promise.all([loadObservations(db, one.metric_id), loadMeta(db, one.metric_id)]);
  const own = obs.filter((o) => o.entity === HOME).sort((a, b) => a.period.localeCompare(b.period));
  const last = own.at(-1);
  if (!last) return { one, issue: `one number metric ${one.metric_id} has no Australian observations` };
  // A year earlier: same quarter/month last year, or the previous year for annual data.
  const prevPeriod = /^\d{4}-Q\d$/.test(last.period) || /^\d{4}-\d{2}$/.test(last.period) || /^\d{4}$/.test(last.period)
    ? `${Number(last.period.slice(0, 4)) - 1}${last.period.slice(4)}`
    : null;
  const prev = prevPeriod ? own.find((o) => o.period === prevPeriod) : undefined;
  const pct = isPercent(meta?.unit);
  const value = `${fmt(last.value)}${pct ? '%' : ''}`;
  let comparison: string | undefined;
  let direction: StoryOneNumber['direction'];
  if (prev) {
    const change = pct ? last.value - prev.value : prev.value ? (last.value / prev.value - 1) * 100 : 0;
    direction = Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down';
    const size = pct ? `${fmt(Math.abs(change))} pts` : `${fmt(Math.abs(change))}%`;
    comparison = direction === 'flat' ? `unchanged on ${prevPeriod}` : `${direction} ${size} on ${prevPeriod}`;
  }
  return { one: { ...one, value, period: last.period, comparison, direction } };
}
