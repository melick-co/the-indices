'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryChartBlock } from '@/lib/story-types';

const ROW = 28;

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

function Bars({ chart }: { chart: StoryChartBlock }) {
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  return (
    <div className="figure story-chart">
      {chart.title && <div className="story-chart-title">{chart.title}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {chart.series.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{
              width: '9rem', fontSize: '.82rem', fontWeight: s.highlight ? 600 : 400, flexShrink: 0,
            }}>{s.label}</span>
            <span style={{
              height: 14, borderRadius: 2,
              width: `${Math.max(2, (Math.abs(s.value) / max) * 58)}%`,
              background: s.highlight ? 'var(--pen)' : 'var(--ink)',
            }} />
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem',
              color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums',
            }}>{formatNum(s.value)}</span>
          </div>
        ))}
      </div>
      {chart.caption && <p className="figure-cap">{chart.caption}</p>}
    </div>
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
    <div className="figure story-chart">
      {chart.title && <div className="story-chart-title">{chart.title}</div>}
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
                background: s.highlight ? 'var(--pen)' : 'var(--ink)',
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
      {chart.caption && <p className="figure-cap">{chart.caption}</p>}
    </div>
  );
}

function Timeline({ chart }: { chart: StoryChartBlock }) {
  const max = Math.max(...chart.series.map((s) => Math.abs(s.value)), 1);
  return (
    <div className="figure story-chart">
      {chart.title && <div className="story-chart-title">{chart.title}</div>}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, paddingTop: 8,
      }}>
        {chart.series.map((s) => (
          <div key={s.label} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 6, height: '100%', justifyContent: 'flex-end',
          }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.65rem', color: 'var(--ink-soft)' }}>
              {formatNum(s.value)}
            </span>
            <span style={{
              width: '100%', maxWidth: 36,
              height: `${Math.max(4, (Math.abs(s.value) / max) * 100)}%`,
              background: s.highlight ? 'var(--pen)' : 'var(--ink)',
              borderRadius: 2,
            }} />
            <span style={{ fontSize: '.7rem', color: 'var(--ink-faint)', textAlign: 'center' }}>{s.label}</span>
          </div>
        ))}
      </div>
      {chart.caption && <p className="figure-cap">{chart.caption}</p>}
    </div>
  );
}

export default function StoryChart({ chart }: { chart: StoryChartBlock }) {
  if (!chart.series?.length) return null;
  if (chart.kind === 'rank_swap' && chart.alt_series?.length) return <RankSwap chart={chart} />;
  if (chart.kind === 'timeline') return <Timeline chart={chart} />;
  return <Bars chart={chart} />;
}
