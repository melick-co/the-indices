import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ReelChartFrame, ReelReveal } from '../lib/reel-types';
import { CHARCOAL, CONTENT_WIDTH, FONT, FOSSIL, INK, MUTED, NAVY, RULE } from './theme';

/**
 * The storyboard's charts, drawn frame by frame from the locked series. The geometry follows
 * components/StoryChart.tsx so a reel's chart matches the one in the story; what changes is that
 * time here is the frame, not a scroll position. No value is ever interpolated for display: a bar
 * grows, a label fades, but the figure printed is the figure traced.
 */

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-AU');
  return n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

function clamp(frame: number, from: [number, number], to: [number, number], easing?: (t: number) => number): number {
  return interpolate(frame, from, to, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
}

/** 0 before `delay`, then eases to 1 with a little weight and no overshoot. */
function grow(frame: number, fps: number, delay: number): number {
  return spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 110, mass: 1 } });
}

function stagger(reveal: ReelReveal, fps: number): number {
  return reveal === 'all_at_once' ? 0 : Math.round(fps * 0.16);
}

const label: React.CSSProperties = { fontFamily: FONT.ui, fontSize: 30, lineHeight: 1.15, color: INK };
const figure: React.CSSProperties = {
  fontFamily: FONT.mono, fontSize: 26, color: CHARCOAL, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
};

/**
 * Graphic anatomy (NEWS-STYLE.md 4.4): the takeaway, the chart, the source line. The caption is
 * the receipt and is drawn whatever the reveal.
 */
export function ChartFrame({ chart, children }: { chart: ReelChartFrame; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = clamp(frame, [0, fps * 0.4], [0, 1], Easing.out(Easing.cubic));
  return (
    <div style={{ width: CONTENT_WIDTH, opacity: enter, transform: `translateY(${(1 - enter) * 16}px)` }}>
      {chart.title && (
        <div style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: 34, lineHeight: 1.2, color: INK, marginBottom: 28 }}>
          {chart.title}
        </div>
      )}
      {children}
      <div style={{
        marginTop: 26, paddingTop: 14, borderTop: `1px solid ${RULE}`,
        fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase', color: FOSSIL,
      }}>
        Source: {chart.caption}
      </div>
    </div>
  );
}

export function Bars({ chart }: { chart: ReelChartFrame }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  // The reveal finishes inside a second and a half whatever the count.
  const step = chart.reveal === 'all_at_once' ? 0 : Math.min(stagger(chart.reveal, fps), Math.round((fps * 1.5) / Math.max(1, chart.series.length)));
  return (
    <ChartFrame chart={chart}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {chart.series.map((s, i) => {
          const g = grow(frame, fps, i * step);
          const share = Math.max(2, (Math.abs(s.value) / max) * 72) * g;
          const shown = clamp(frame, [i * step + fps * 0.35, i * step + fps * 0.65], [0, 1]);
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ ...label, width: 250, flexShrink: 0, fontWeight: s.highlight ? 600 : 400 }}>{s.label}</span>
              <div style={{ flex: 1, position: 'relative', height: 34 }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: 34, width: `${share}%`,
                  background: s.highlight ? NAVY : MUTED, borderRadius: 3,
                }} />
                <span style={{ ...figure, position: 'absolute', left: `calc(${share}% + 14px)`, top: 0, lineHeight: '34px', opacity: shown }}>
                  {formatNum(s.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

const ROW = 70;

/**
 * Rank rows, ordered by the primary series, then re-ordered by the alternate series part way
 * through the scene when the reveal is a swap. Each row's bar is scaled against its own series'
 * maximum, so the swap reads as a change of measure, not a change of scale.
 */
export function RankSwap({ chart }: { chart: ReelChartFrame }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const alt = chart.alt_series ?? [];
  const swapping = chart.reveal === 'swap' && alt.length > 0;
  const swapAt = Math.round(durationInFrames * 0.45);
  const t = swapping
    ? clamp(frame, [swapAt, swapAt + Math.round(fps * 0.9)], [0, 1], Easing.inOut(Easing.cubic))
    : 0;

  const order = (series: typeof chart.series) => {
    const sorted = [...series].sort((a, b) => b.value - a.value);
    const max = Math.max(...sorted.map((s) => Math.abs(s.value)), 1);
    return {
      pos: new Map(sorted.map((s, i) => [s.label, i])),
      share: new Map(sorted.map((s) => [s.label, Math.max(2, (Math.abs(s.value) / max) * 60)])),
      value: new Map(sorted.map((s) => [s.label, s.value])),
    };
  };
  const primary = order(chart.series);
  const second = swapping ? order(alt) : primary;
  const step = stagger(chart.reveal === 'swap' ? 'sequential' : chart.reveal, fps);
  const labels = chart.series.map((s) => s.label);

  const tab = (text: string, on: number): React.CSSProperties => ({
    fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '10px 18px', border: `1px solid ${RULE}`,
    background: `rgba(26, 22, 18, ${on})`, color: on > 0.5 ? '#f3efe4' : CHARCOAL,
  });

  return (
    <ChartFrame chart={chart}>
      {swapping && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 30 }}>
          <span style={tab(chart.primary_label ?? 'Absolute', 1 - t)}>{chart.primary_label ?? 'Absolute'}</span>
          <span style={tab(chart.alt_label ?? 'Per person', t)}>{chart.alt_label ?? 'Per person'}</span>
        </div>
      )}
      <div style={{ position: 'relative', height: labels.length * ROW }}>
        {labels.map((name) => {
          const highlight = chart.series.find((s) => s.label === name)?.highlight;
          const p0 = primary.pos.get(name) ?? 0;
          const p1 = second.pos.get(name) ?? p0;
          const top = (p0 + (p1 - p0) * t) * ROW;
          const g = grow(frame, fps, p0 * step);
          const share = ((primary.share.get(name) ?? 2) + ((second.share.get(name) ?? 2) - (primary.share.get(name) ?? 2)) * t) * g;
          const rank = t < 0.5 ? p0 + 1 : p1 + 1;
          const value = t < 0.5 ? primary.value.get(name) : second.value.get(name);
          const shown = clamp(frame, [p0 * step + fps * 0.35, p0 * step + fps * 0.65], [0, 1]);
          // The figure changes at the midpoint of the swap and is never shown in between.
          const flip = swapping ? 1 - clamp(Math.abs(t - 0.5), [0, 0.12], [1, 0]) : 1;
          return (
            <div key={name} style={{
              position: 'absolute', left: 0, right: 0, top, height: ROW - 16,
              display: 'flex', alignItems: 'center', gap: 20,
            }}>
              <span style={{ ...figure, width: 48, textAlign: 'right', color: FOSSIL, opacity: flip }}>{rank}</span>
              <span style={{ ...label, width: 230, flexShrink: 0, fontWeight: highlight ? 600 : 400 }}>{name}</span>
              <div style={{ flex: 1, position: 'relative', height: 34 }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: 34, width: `${share}%`,
                  background: highlight ? NAVY : MUTED, borderRadius: 3,
                }} />
                <span style={{ ...figure, position: 'absolute', left: `calc(${share}% + 14px)`, top: 0, lineHeight: '34px', opacity: shown * flip }}>
                  {value === undefined ? '' : formatNum(value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

/**
 * Bars over time. A story's series can run to dozens of periods (the cash rate from 2003 was 27),
 * so past a dozen bars the labels thin to the ends and the highlights, the values to the ends,
 * the peak and the highlights, and the whole reveal still finishes inside a second and a half.
 */
export function Timeline({ chart }: { chart: ReelChartFrame }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = chart.series.length;
  const dense = n > 12;
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  const peak = chart.series.findIndex((s) => Math.abs(s.value) === max);
  const step = chart.reveal === 'all_at_once' ? 0 : Math.min(stagger(chart.reveal, fps), Math.round((fps * 1.5) / Math.max(1, n)));
  const H = 360;
  const labelled = (i: number) => !dense || i === 0 || i === n - 1 || Boolean(chart.series[i].highlight);
  const valued = (i: number) => labelled(i) || i === peak;
  const labelSize = n > 20 ? 18 : n > 8 ? 20 : 24;
  return (
    <ChartFrame chart={chart}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: dense ? 6 : 18, height: H + 90, paddingTop: 10 }}>
        {chart.series.map((s, i) => {
          const g = grow(frame, fps, i * step);
          const shown = clamp(frame, [i * step + fps * 0.3, i * step + fps * 0.6], [0, 1]);
          const h = Math.max(6, (Math.abs(s.value) / max) * H) * g;
          return (
            <div key={`${s.label}-${i}`} style={{
              flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 12, height: '100%',
            }}>
              <span style={{ ...figure, fontSize: dense ? 20 : 24, opacity: valued(i) ? shown : 0, whiteSpace: 'nowrap' }}>{formatNum(s.value)}</span>
              <div style={{ width: '100%', maxWidth: 110, height: h, background: s.highlight ? NAVY : MUTED, borderRadius: dense ? 2 : 3 }} />
              <span style={{
                fontFamily: FONT.ui, fontSize: labelSize, lineHeight: 1.15, color: FOSSIL, textAlign: 'center',
                minHeight: labelSize * 2.3, overflow: 'hidden', visibility: labelled(i) ? 'visible' : 'hidden',
                // A dense axis keeps its end labels on one line and lets them sit past the bar's own column.
                whiteSpace: dense ? 'nowrap' : 'normal', overflowWrap: 'anywhere',
                ...(dense && i === 0 ? { alignSelf: 'flex-start', textAlign: 'left' } : {}),
                ...(dense && i === n - 1 ? { alignSelf: 'flex-end', textAlign: 'right' } : {}),
              }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

type Pt = { x: number; y: number };

/** Length of a polyline or step path, so the draw-in can be sized without measuring the DOM. */
function pathLength(points: Pt[], stepped: boolean): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    len += stepped ? Math.abs(b.x - a.x) + Math.abs(b.y - a.y) : Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function pathOf(points: Pt[], stepped: boolean): string {
  return points.map((p, i) => (i === 0
    ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}`
    : stepped
      ? `H${p.x.toFixed(1)} V${p.y.toFixed(1)}`
      : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
}

/**
 * Change over time: the line draws in over the first second and a half, then the first and latest
 * values are labelled. A second series of the same length shares the scale (StoryChart's rule).
 */
export function Line({ chart }: { chart: ReelChartFrame }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pts = chart.series;
  const alt = chart.alt_series?.length === pts.length ? chart.alt_series : null;
  const W = CONTENT_WIDTH, H = 420, padL = 12, padR = 150, padT = 30, padB = 52;
  const vals = [...pts, ...(alt ?? [])].map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || Math.abs(max) || 1;
  const lo = min - span * 0.12, hi = max + span * 0.12;
  const dated = pts.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.label));
  const times = pts.map((p) => (dated ? Date.parse(`${p.label}T00:00:00Z`) : 0));
  const x = (i: number) => (dated
    ? padL + ((times[i] - times[0]) * (W - padL - padR)) / Math.max(1, times[times.length - 1] - times[0])
    : padL + (i * (W - padL - padR)) / Math.max(1, pts.length - 1));
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const toPts = (series: typeof pts): Pt[] => series.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const main = toPts(pts);
  const second = alt ? toPts(alt) : null;
  const len = pathLength(main, dated);
  const lenAlt = second ? pathLength(second, dated) : 0;
  const drawn = clamp(frame, [0, fps * 1.5], [0, 1], Easing.out(Easing.cubic));
  const labelled = clamp(frame, [fps * 1.4, fps * 1.8], [0, 1]);
  const first = pts[0], last = pts[pts.length - 1];
  const altLast = alt?.[alt.length - 1];
  const gap = altLast ? y(altLast.value) - y(last.value) : 0;
  const nudge = altLast && Math.abs(gap) < 28 ? ((28 - Math.abs(gap)) / 2) * (gap >= 0 ? 1 : -1) : 0;
  // The first value sits above its point unless the line climbs away from it, then below.
  const firstLabelY = pts.length > 1 && pts[1].value > first.value ? y(first.value) + 36 : y(first.value) - 16;
  const tick: React.CSSProperties = { fontFamily: FONT.mono, fontSize: 22, fill: FOSSIL };
  const end: React.CSSProperties = { fontFamily: FONT.mono, fontSize: 26, fill: INK };

  return (
    <ChartFrame chart={chart}>
      {alt && (
        <div style={{ display: 'flex', gap: 28, marginBottom: 16, fontFamily: FONT.ui, fontSize: 24, color: CHARCOAL }}>
          <span><i style={{ display: 'inline-block', width: 26, height: 5, background: NAVY, marginRight: 10, verticalAlign: 'middle' }} />{chart.primary_label ?? 'Series 1'}</span>
          <span><i style={{ display: 'inline-block', width: 26, height: 5, background: MUTED, marginRight: 10, verticalAlign: 'middle' }} />{chart.alt_label ?? 'Series 2'}</span>
        </div>
      )}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke={RULE} strokeWidth={1.5} />
        {second && (
          <path d={pathOf(second, dated)} fill="none" stroke={MUTED} strokeWidth={5} strokeLinejoin="round"
            strokeDasharray={`${lenAlt} ${lenAlt}`} strokeDashoffset={lenAlt * (1 - drawn)} />
        )}
        <path d={pathOf(main, dated)} fill="none" stroke={NAVY} strokeWidth={6} strokeLinejoin="round"
          strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - drawn)} />
        <circle cx={x(0)} cy={y(first.value)} r={6} fill={NAVY} opacity={labelled} />
        <text x={x(0)} y={firstLabelY} style={end} opacity={labelled}>{formatNum(first.value)}</text>
        <circle cx={x(pts.length - 1)} cy={y(last.value)} r={9} fill={NAVY} opacity={labelled} />
        <text x={x(pts.length - 1) + 18} y={y(last.value) + 9 - nudge} style={{ ...end, fontWeight: 500 }} opacity={labelled}>
          {formatNum(last.value)}
        </text>
        {altLast && (
          <>
            <circle cx={x(alt!.length - 1)} cy={y(altLast.value)} r={7} fill={MUTED} opacity={labelled} />
            <text x={x(alt!.length - 1) + 18} y={y(altLast.value) + 9 + nudge} style={{ ...end, fill: CHARCOAL }} opacity={labelled}>
              {formatNum(altLast.value)}
            </text>
          </>
        )}
        <text x={x(0)} y={H - 14} style={tick}>{first.label}</text>
        <text x={x(pts.length - 1)} y={H - 14} textAnchor="end" style={tick}>{last.label}</text>
      </svg>
    </ChartFrame>
  );
}

export function Chart({ chart }: { chart: ReelChartFrame }) {
  if (!chart.series?.length) return null;
  if (chart.kind === 'rank_swap' && chart.alt_series?.length) return <RankSwap chart={chart} />;
  if (chart.kind === 'line' && chart.series.length >= 2) return <Line chart={chart} />;
  if (chart.kind === 'timeline') return <Timeline chart={chart} />;
  return <Bars chart={chart} />;
}
