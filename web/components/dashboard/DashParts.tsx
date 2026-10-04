import type { Point, Reading, Status } from '@/lib/economy-dashboard';
import { formatReading } from '@/lib/economy-dashboard';
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
  return <span className={big ? 'dash-value big' : 'dash-value'}>{formatReading(reading.latest.value, reading.indicator.unit)}</span>;
}

export function Change({ reading }: { reading: Reading }) {
  const { latest, previous } = reading;
  if (!latest || !previous) return null;
  const d = latest.value - previous.value;
  if (Math.abs(d) < 1e-9) return <span className="dash-change">unchanged</span>;
  const good = reading.indicator.higherIsBetter === undefined ? null : (d > 0) === reading.indicator.higherIsBetter;
  const rate = ['percent', 'percent_gdp', 'pts'].includes(reading.indicator.unit ?? '');
  const size = rate ? `${Math.abs(Math.round(d * 100) / 100)} pts` : `${Math.abs(Math.round((d / Math.abs(previous.value)) * 1000) / 10)}%`;
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
  const top = rows.slice(0, 12);
  const aus = rows.find((x) => x.entity === 'AUS');
  const shown = aus && !top.includes(aus) ? [...top.slice(0, 11), aus] : top;
  return {
    type: 'chart', kind: 'bars',
    title: `Australia ranks ${r.peers.rank} of ${r.peers.of} OECD countries`,
    subtitle: `${r.peers.label}, ${r.peers.period}; OECD median ${formatReading(r.peers.median, r.peers.unit)}`,
    series: shown.map((x) => ({ label: names.get(x.entity) ?? x.entity, value: x.value, ...(x.entity === 'AUS' ? { highlight: true } : {}) })),
    caption: 'Source: OECD and World Bank cross-country series as stored.',
  };
}
