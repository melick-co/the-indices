import type { Point, Reading, Status } from '@/lib/economy-dashboard';
import { absoluteChange, formatReading, ordinal } from '@/lib/economy-dashboard';
import type { StoryChartBlock } from '@/lib/story-types';

/** A small trend line for tiles: the recent history, with the latest point marked. */
export function Sparkline({ points, step = false, width = 120, height = 32 }: { points: Point[]; step?: boolean; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => (i * (width - 4)) / (points.length - 1) + 2;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = points.map((p, i) => (i === 0 ? `M${x(0)},${y(p.value)}` : step ? `H${x(i)} V${y(p.value)}` : `L${x(i)},${y(p.value)}`)).join(' ');
  const last = points[points.length - 1];
  return (
    <svg className="dash-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={d} />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.5} />
    </svg>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  'on-target': 'On target', better: 'Better than usual', worse: 'Worse than usual',
  above: 'Above', below: 'Below', neutral: 'Steady',
};

/** Status colour: good, watch or neutral. "Above/below" a target band is a watch. */
export function statusTone(s: Status): 'good' | 'watch' | 'neutral' {
  if (s === 'on-target' || s === 'better') return 'good';
  if (s === 'worse' || s === 'above' || s === 'below') return 'watch';
  return 'neutral';
}

export function StatusBadge({ reading }: { reading: Reading }) {
  return <span className={`dash-status ${statusTone(reading.status)}`}>{reading.verdict || STATUS_LABEL[reading.status]}</span>;
}

export function Value({ reading, big = false }: { reading: Reading; big?: boolean }) {
  if (!reading.latest) return <span className="dash-value">—</span>;
  return <span className={big ? 'dash-value big' : 'dash-value'}>{formatReading(reading.latest.value, reading.indicator.unit, reading.indicator.decimals)}</span>;
}

/** Short forms for tight columns (driver rows, ticker): "22.2/100k", "498 pts". Summaries keep the full wording. */
export function compactReading(v: number, unit: Reading['indicator']['unit'], decimals?: number): string {
  if (unit === 'per_100k') return `${Math.round(v * 10) / 10}/100k`;
  if (unit === 'points') return `${Math.round(v)} pts`;
  return formatReading(v, unit, decimals);
}
const COMPACT_CHANGE: Partial<Record<NonNullable<Reading['indicator']['unit']>, (d: number) => string>> = {
  per_100k: (d) => `${Math.round(d * 10) / 10}/100k`, points: (d) => `${Math.round(d)} pts`,
};

export function Change({ reading, compact = false }: { reading: Reading; compact?: boolean }) {
  const { latest, previous } = reading;
  if (!latest || !previous) return null;
  const d = latest.value - previous.value;
  if (Math.abs(d) < 1e-9) return <span className="dash-change">unchanged</span>;
  const b = reading.indicator.benchmark;
  // Against a target band, a move towards the band is good and a move away is bad; inside the band, neither.
  const good = b.kind === 'target'
    ? (latest.value > b.high ? d < 0 : latest.value < b.low ? d > 0 : null)
    : reading.indicator.higherIsBetter === undefined ? null : (d > 0) === reading.indicator.higherIsBetter;
  const rate = ['percent', 'percent_gdp', 'pts'].includes(reading.indicator.unit ?? '');
  const abs = reading.indicator.unit && ((compact && COMPACT_CHANGE[reading.indicator.unit]) || absoluteChange[reading.indicator.unit]);
  const size = abs ? abs(Math.abs(d)) : rate ? `${Math.abs(Math.round(d * 100) / 100)} pts` : `${Math.abs(Math.round((d / Math.abs(previous.value)) * 1000) / 10)}%`;
  return <span className={`dash-change ${good === null ? '' : good ? 'good' : 'watch'}`}>{d > 0 ? '▲' : '▼'} {size}</span>;
}

/** The history as a story line chart (with a target band's edges as a second series when there is one). */
export function historyChart(r: Reading): StoryChartBlock {
  return {
    type: 'chart', kind: 'line',
    title: `${r.indicator.short ?? r.indicator.label}: the last ${r.history.length} readings`,
    subtitle: `${r.indicator.label}, ${r.history[0]?.period} to ${r.history.at(-1)?.period}`,
    series: r.history.map((p, i) => ({ label: p.period, value: p.value, ...(i === r.history.length - 1 ? { highlight: true } : {}) })),
    caption: r.source ? `Source: ${r.source}.` : undefined,
  };
}

/** Australia against the OECD: the top countries, Australia highlighted, and the median. */
export function peersChart(r: Reading, names: Map<string, string>): StoryChartBlock | null {
  if (!r.peers) return null;
  const rows = r.peers.rows;
  // rows are ordered best (or highest) first
  const top = rows.slice(0, 12);
  const aus = rows.find((x) => x.entity === 'AUS');
  const shown = aus && !top.includes(aus) ? [...top.slice(0, 11), aus] : top;
  return {
    type: 'chart', kind: 'bars',
    title: `Australia ranks ${ordinal(r.peers.rank)} ${r.peers.bestFirst ? 'best' : 'highest'} of ${r.peers.of} OECD countries`,
    subtitle: `${r.peers.label}, ${r.peers.period}; OECD median ${formatReading(r.peers.median, r.peers.unit)}`,
    series: shown.map((x) => ({ label: names.get(x.entity) ?? x.entity, value: x.value, ...(x.entity === 'AUS' ? { highlight: true } : {}) })),
    caption: 'Source: OECD and World Bank cross-country series as stored.',
  };
}

// ------------------------------------------------------------------------------------------------ dashboard v2 parts

export type Tone = 'good' | 'bad' | 'watch' | 'neutral';

/**
 * Colour of a reading: good (on target, better than usual), bad (worse than usual), watch (outside a target band),
 * neutral (a level with no better or worse, e.g. the cash rate above its average).
 */
export function tone(r: Reading): Tone {
  if (r.status === 'on-target' || r.status === 'better') return 'good';
  if (r.status === 'worse') return 'bad';
  if ((r.status === 'above' || r.status === 'below') && r.indicator.benchmark.kind === 'target') return 'watch';
  return 'neutral';
}
export const isPressure = (r: Reading) => tone(r) === 'bad' || tone(r) === 'watch';

/** The value a reading is judged against, and how to name it. */
export function reference(r: Reading): { value: number; label: string } | null {
  const b = r.indicator.benchmark;
  const u = r.indicator.unit;
  if (b.kind === 'target') return { value: (b.low + b.high) / 2, label: `target ${b.low}–${b.high}%` };
  if (b.kind === 'floor') return { value: b.value, label: `${(b.short ?? 'benchmark').replace(/^its /, '')} ${formatReading(b.value, u)}` };
  if (b.kind === 'oecd' && r.peers) return { value: r.peers.median, label: `OECD median ${formatReading(r.peers.median, r.peers.unit)}` };
  if (r.average != null) return { value: r.average, label: `${r.averageLabel ?? 'average'} ${formatReading(r.average, u)}` };
  if (r.peers) return { value: r.peers.median, label: `OECD median ${formatReading(r.peers.median, r.peers.unit)}` };
  return null;
}

export function ToneChip({ reading, children }: { reading: Reading; children?: React.ReactNode }) {
  return <span className={`dx-chip ${tone(reading)}`}>{children ?? (reading.verdict || STATUS_LABEL[reading.status])}</span>;
}

/** A trend with area fill, a dashed reference line (target, average or median) and the latest point marked. */
export function Trend({ points, step = false, width = 280, height = 72, refValue: ref, refLabel, tone: t = 'neutral', band }: {
  points: Point[]; step?: boolean; width?: number; height?: number; refValue?: number | null; refLabel?: string; tone?: Tone;
  band?: [number, number];
}) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value).concat(ref != null ? [ref] : []).concat(band ?? []);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min || 1) * 0.12;
  const lo = min - pad, hi = max + pad;
  const x = (i: number) => (i * (width - 8)) / (points.length - 1) + 2;
  const y = (v: number) => height - 4 - ((v - lo) / (hi - lo)) * (height - 8);
  const line = points.map((p, i) => (i === 0 ? `M${x(0)},${y(p.value)}` : step ? `H${x(i)} V${y(p.value)}` : `L${x(i)},${y(p.value)}`)).join(' ');
  const area = `${line} L${x(points.length - 1)},${height} L${x(0)},${height} Z`;
  const last = points[points.length - 1];
  return (
    <svg className={`dx-trend ${t}`} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
      aria-label={`${points[0].period} to ${last.period}${refLabel ? `, ${refLabel}` : ''}`}>
      {band && <rect className="dx-trend-band" x={0} width={width} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} />}
      <path className="dx-trend-area" d={area} />
      {ref != null && <line className="dx-trend-ref" x1={0} x2={width} y1={y(ref)} y2={y(ref)} vectorEffect="non-scaling-stroke" />}
      <path className="dx-trend-line" d={line} vectorEffect="non-scaling-stroke" />
      <circle className="dx-trend-dot" cx={x(points.length - 1)} cy={y(last.value)} r={3} />
    </svg>
  );
}

/**
 * How far the latest reading sits from its reference, scaled to the widest gap in its own history (or across
 * countries for OECD comparisons). Left of centre is below the reference, right is above; colour is the tone.
 */
export function DeviationBar({ reading }: { reading: Reading }) {
  const ref = reference(reading);
  if (!ref || !reading.latest) return <span className="dx-dev empty" />;
  const pool = reading.indicator.benchmark.kind === 'oecd' && reading.peers ? reading.peers.rows.map((r) => r.value) : reading.history.map((p) => p.value);
  const scale = Math.max(...pool.concat(reading.latest.value).map((v) => Math.abs(v - ref.value)), 1e-9);
  const dev = reading.latest.value - ref.value;
  const pct = Math.min(50, (Math.abs(dev) / scale) * 50);
  const side = dev >= 0 ? { left: '50%' } : { right: '50%' };
  return (
    <span className={`dx-dev ${tone(reading)}`} title={`${formatReading(reading.latest.value, reading.indicator.unit, reading.indicator.decimals)} against ${ref.label}`}>
      <span className="dx-dev-fill" style={{ ...side, width: `${pct}%` }} />
      <span className="dx-dev-mid" />
    </span>
  );
}
