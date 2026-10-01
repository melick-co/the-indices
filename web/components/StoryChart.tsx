'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryChartBlock } from '@/lib/story-types';

const ROW = 28;
const GROW = 'cubic-bezier(.22,.61,.36,1)';

/**
 * True once the chart has scrolled into view (immediately when motion is
 * reduced or IntersectionObserver is unavailable), so bars grow in as the
 * reader reaches them.
 */
function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSeen(true); return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

function formatNum(n: number) {
  if (Number.isInteger(n)) return n.toLocaleString('en-AU');
  return n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
}

function btn(on: boolean): React.CSSProperties {
  return {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '.7rem',
    letterSpacing: '.04em',
    textTransform: 'uppercase' as const,
    padding: '.35rem .65rem',
    border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
    background: on ? 'var(--ink)' : 'transparent',
    color: on ? 'var(--paper)' : 'var(--ink-soft)',
    cursor: 'pointer',
  };
}

/**
 * Graphic anatomy (NEWS-STYLE.md §4.4): takeaway headline, subhead with units
 * and timeframe, the chart, and a source line linked to its footnote. The alt
 * text is the figure's accessible name.
 */
function ChartFrame({ chart, children, frameRef }: {
  chart: StoryChartBlock;
  children: React.ReactNode;
  frameRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <figure className="figure story-chart" ref={frameRef} aria-label={chart.alt ?? chart.title}>
      {chart.title && <div className="story-chart-title">{chart.title}</div>}
      {chart.subtitle && <div className="story-chart-subtitle">{chart.subtitle}</div>}
      {children}
      {(chart.caption || chart.footnote) && (
        <figcaption className="figure-cap">
          {chart.caption}
          {chart.footnote ? <sup className="fn-ref"><a href={`#fn-${chart.footnote}`} aria-label={`Source ${chart.footnote}`}>{chart.footnote}</a></sup> : null}
        </figcaption>
      )}
    </figure>
  );
}

function Bars({ chart }: { chart: StoryChartBlock }) {
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <ChartFrame chart={chart} frameRef={ref}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {chart.series.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{
              width: '9rem', fontSize: '.82rem', fontWeight: s.highlight ? 600 : 400, flexShrink: 0,
            }}>{s.label}</span>
            <span style={{
              height: 14, borderRadius: 2,
              width: seen ? `${Math.max(2, (Math.abs(s.value) / max) * 58)}%` : '0%',
              background: s.highlight ? 'var(--pen)' : 'var(--graphic-muted)',
              transition: `width .8s ${GROW} ${i * 70}ms`,
            }} />
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem',
              color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums',
              opacity: seen ? 1 : 0, transition: `opacity .4s ease ${i * 70 + 500}ms`,
            }}>{formatNum(s.value)}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

function RankSwap({ chart }: { chart: StoryChartBlock }) {
  const altSeries = chart.alt_series ?? [];
  const [alt, setAlt] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = alt ? altSeries : chart.series;
  const ids = chart.series.map((s) => s.label);
  const primaryLabel = chart.primary_label ?? 'Absolute';
  const altLabel = chart.alt_label ?? 'Per person';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => setAlt((v) => !v), 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const scored = [...active].sort((a, b) => b.value - a.value);
  const max = Math.max(...scored.map((s) => Math.abs(s.value)), 1);
  const pos = new Map(scored.map((s, i) => [s.label, i]));
  const byLabel = new Map(active.map((s) => [s.label, s]));

  return (
    <ChartFrame chart={chart}>
      <div style={{ display: 'flex', gap: '.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { if (timer.current) clearInterval(timer.current); setAlt(false); }} style={btn(!alt)}>
          {primaryLabel}
        </button>
        <button type="button" onClick={() => { if (timer.current) clearInterval(timer.current); setAlt(true); }} style={btn(alt)}>
          {altLabel}
        </button>
      </div>
      <div style={{ position: 'relative', height: ids.length * ROW + 8 }}>
        {ids.map((label) => {
          const s = byLabel.get(label);
          if (!s) return null;
          return (
            <div key={label} style={{
              position: 'absolute', left: 0, right: 0, height: ROW - 6,
              top: (pos.get(label) ?? 0) * ROW,
              display: 'flex', alignItems: 'center', gap: '.5rem',
              transition: 'top .9s cubic-bezier(.65,0,.35,1)',
            }}>
              <span style={{
                width: '2rem', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '.7rem', color: 'var(--ink-faint)',
              }}>{(pos.get(label) ?? 0) + 1}</span>
              <span style={{ width: '8.5rem', fontSize: '.82rem', fontWeight: s.highlight ? 600 : 400 }}>
                {label}
              </span>
              <span style={{
                height: 14, borderRadius: 2,
                width: `${Math.max(2, (Math.abs(s.value) / max) * 58)}%`,
                background: s.highlight ? 'var(--pen)' : 'var(--graphic-muted)',
                transition: 'width .9s cubic-bezier(.65,0,.35,1)',
              }} />
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem',
                color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums',
              }}>{formatNum(s.value)}</span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

function Timeline({ chart }: { chart: StoryChartBlock }) {
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <ChartFrame chart={chart} frameRef={ref}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, paddingTop: 8,
      }}>
        {chart.series.map((s, i) => (
          <div key={s.label} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, height: '100%', justifyContent: 'flex-end',
          }}>
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '.65rem', color: 'var(--ink-soft)',
              opacity: seen ? 1 : 0, transition: `opacity .4s ease ${i * 60 + 450}ms`,
            }}>
              {formatNum(s.value)}
            </span>
            <span style={{
              width: '100%', maxWidth: 36,
              height: seen ? `${Math.max(4, (Math.abs(s.value) / max) * 100)}%` : '0%',
              background: s.highlight ? 'var(--pen)' : 'var(--graphic-muted)',
              borderRadius: 2,
              transition: `height .7s ${GROW} ${i * 60}ms`,
            }} />
            <span style={{ fontSize: '.7rem', color: 'var(--ink-faint)', textAlign: 'center' }}>{s.label}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

/**
 * Change over time: a line that draws in when scrolled into view, with the
 * first and latest values labelled directly and the latest point highlighted.
 */
function Line({ chart }: { chart: StoryChartBlock }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const pts = chart.series;
  const W = 640, H = 220, padL = 8, padR = 64, padT = 18, padB = 26;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || Math.abs(max) || 1;
  const lo = min - span * 0.12, hi = max + span * 0.12;
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, pts.length - 1);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = pts[0];
  return (
    <ChartFrame chart={chart} frameRef={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} className="story-line" role="img" aria-label={chart.alt ?? chart.title ?? ''}>
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} className="story-line-axis" />
        <path d={d} pathLength={1} className={`story-line-path${seen ? ' drawn' : ''}`} />
        <circle cx={x(0)} cy={y(first.value)} r={3} className="story-line-dot" />
        <text x={x(0)} y={y(first.value) - 8} className="story-line-label">{formatNum(first.value)}</text>
        <circle cx={x(pts.length - 1)} cy={y(last.value)} r={4.5} className={`story-line-dot key${seen ? ' shown' : ''}`} />
        <text x={x(pts.length - 1) + 8} y={y(last.value) + 4} className={`story-line-label key${seen ? ' shown' : ''}`}>{formatNum(last.value)}</text>
        <text x={x(0)} y={H - 8} className="story-line-tick">{first.label}</text>
        <text x={x(pts.length - 1)} y={H - 8} textAnchor="end" className="story-line-tick">{last.label}</text>
      </svg>
    </ChartFrame>
  );
}

export default function StoryChart({ chart }: { chart: StoryChartBlock }) {
  if (!chart.series?.length) return null;
  if (chart.kind === 'rank_swap' && chart.alt_series?.length) return <RankSwap chart={chart} />;
  if (chart.kind === 'line' && chart.series.length >= 2) return <Line chart={chart} />;
  if (chart.kind === 'timeline') return <Timeline chart={chart} />;
  return <Bars chart={chart} />;
}
