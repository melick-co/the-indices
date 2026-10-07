import { Brand } from './BrandMark';
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { RACE_FPS, STACK_FADE_SECONDS, stackBuildSeconds, type RaceProps } from '../lib/race-video-types';

const NAVY = '#0f1830', ON = '#eef2fa', MUTED = '#a9b6d3', GRID = 'rgba(169,182,211,.18)', OTHER = '#5a6788';
const SEGMENTS = 8;

const millions = (v: number, d = 1) => `${(v / 1e6).toFixed(d)}m`;
/** A round step for the value axis (1, 2, 2.5 or 5 times a power of ten), giving about five lines. */
function niceStep(max: number) {
  const raw = max / 5, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}

/**
 * The race's ending: the same data as stacked columns, one per period, built left to right. Each column is the
 * largest entities (in the race's colours, flag in the legend) plus everyone else, so it reaches the period's total.
 * The finished chart is the end frame.
 */
const LegendItem: React.FC<{ l: { label: string; colour: string }; flag: string | null | undefined; fs: number }> = ({ l, flag, fs }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fs, lineHeight: 1.35, fontWeight: 600, color: ON, whiteSpace: 'nowrap', overflow: 'hidden' }}>
    <span style={{ width: fs * 0.8, height: fs * 0.8, borderRadius: 3, background: l.colour, flexShrink: 0 }} />
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
    {flag && <Img src={flag} style={{ height: fs * 0.8, width: fs * 1.2, borderRadius: 2, flexShrink: 0 }} />}
  </div>
);

export const StackEnding: React.FC<RaceProps & { start: number; colourOf: Record<string, string>; flags: Record<string, string | null>; brand: string }> = ({ race, format, start, colourOf, flags, brand }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (!race.stack) return null;
  const tall = format === '9:16', wide = format === '16:9';
  const periods = race.frames.map((f) => f.period);
  const last = race.frames.at(-1)!;
  const keys = Object.entries(last.values).sort((a, b) => b[1] - a[1]).slice(0, SEGMENTS).map(([k]) => k);
  const columns = race.frames.map((f) => {
    const parts = keys.map((k) => ({ k, v: f.values[k] ?? 0 }));
    const total = race.stack!.totals[f.period] ?? parts.reduce((a, p) => a + p.v, 0);
    return { period: f.period, total, parts: [...parts, { k: 'other', v: Math.max(0, total - parts.reduce((a, p) => a + p.v, 0)) }] };
  });
  const maxV = Math.max(...columns.map((c) => c.total));
  const step = niceStep(maxV), top = Math.ceil(maxV / step) * step;

  const t = frame - start;
  const fade = interpolate(t, [0, STACK_FADE_SECONDS * RACE_FPS], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const build = stackBuildSeconds(periods.length) * RACE_FPS;
  const per = build / periods.length;
  const grow = (i: number) => interpolate(t, [i * per, i * per + per * 2.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const pad = tall ? 80 : 70;
  const legendW = wide ? 380 : 0;
  const fs = tall ? 26 : wide ? 24 : 21, srcFs = tall ? 22 : 18;
  const chartTop = tall ? 500 : wide ? 250 : 250;
  // Below the chart, bottom up: the source line (two lines), the legend (below the chart except on 16:9), the years.
  const legendRows = wide ? 0 : Math.ceil((keys.length + 1) / 3);
  const footBottom = tall ? 300 : 18;
  const footH = srcFs * 1.3 * (wide ? 1 : 2) + (legendRows ? legendRows * (fs * 1.35 + (tall ? 16 : 10)) + 14 : 0);
  const chartBottom = height - footBottom - footH - fs * 2.2;
  const axisW = 70;
  const x0 = pad + axisW, x1 = width - pad - legendW;
  const colW = (x1 - x0) / periods.length;
  const y = (v: number) => chartBottom - (v / top) * (chartBottom - chartTop);
  const lastTotal = columns.at(-1)!.total, firstTotal = columns[0].total;
  const done = interpolate(t, [build, build + 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const legend = [...keys.map((k) => ({ k, label: race.labels[k] ?? k, colour: colourOf[k] })), { k: 'other', label: race.stack.otherLabel, colour: OTHER }];

  return (
    <AbsoluteFill style={{ background: NAVY, opacity: fade }}>
      <div style={{ position: 'absolute', left: pad, right: pad, top: tall ? 200 : 60 }}>
        <Brand name={brand} size={tall ? 26 : 24} style={{ fontSize: tall ? 26 : 24, letterSpacing: 4, textTransform: 'uppercase', color: MUTED, fontWeight: 600  }} />
        <div style={{ fontSize: tall ? 60 : wide ? 56 : 50, fontWeight: 700, lineHeight: 1.1, marginTop: 10 }}>{race.stack.title}</div>
        <div style={{ fontSize: tall ? 30 : 26, color: MUTED, marginTop: 10 }}>
          {millions(firstTotal)} in {periods[0]}; <span style={{ color: ON, fontWeight: 700, opacity: done }}>{millions(lastTotal)} in {periods.at(-1)}</span>
        </div>
      </div>
      {/* Value axis */}
      {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
        <React.Fragment key={v}>
          <div style={{ position: 'absolute', left: x0, width: x1 - x0, top: y(v), height: 1, background: GRID }} />
          <div style={{ position: 'absolute', left: pad - 10, width: axisW, top: y(v) - fs * 0.65, textAlign: 'right', paddingRight: 14, fontSize: fs * 0.85, color: MUTED }}>{v === 0 ? '0' : millions(v, step % 1e6 ? 1 : 0)}</div>
        </React.Fragment>
      ))}
      {/* Columns, built left to right */}
      {columns.map((c, i) => {
        const g = grow(i);
        let acc = 0;
        return (
          <React.Fragment key={c.period}>
            {c.parts.map((p) => {
              // Whole pixels, so neighbouring segments meet without a hairline between them.
              const y0 = Math.round(y(acc * g)), y1 = Math.round(y((acc + p.v) * g));
              acc += p.v;
              return <div key={p.k} style={{ position: 'absolute', left: x0 + i * colW + colW * 0.12, width: colW * 0.76, top: y1, height: Math.max(0, y0 - y1), background: p.k === 'other' ? OTHER : colourOf[p.k] }} />;
            })}
            {(i % 5 === 0 || i === columns.length - 1) && (
              <div style={{ position: 'absolute', left: x0 + i * colW - 30, width: colW + 60, top: chartBottom + 8, textAlign: 'center', fontSize: fs * 0.85, color: MUTED, opacity: g > 0 ? 1 : 0 }}>{c.period}</div>
            )}
          </React.Fragment>
        );
      })}
      {/* The latest total, over the last column once it is up */}
      <div style={{ position: 'absolute', left: x0 + (columns.length - 1) * colW - 80, width: colW + 160, top: y(lastTotal) - fs * 1.7, textAlign: 'center', fontSize: fs * 1.1, fontWeight: 800, color: ON, opacity: done }}>{millions(lastTotal)}</div>
      {/* Legend beside the chart on 16:9 */}
      {wide && (
        <div style={{ position: 'absolute', right: pad, width: legendW - 40, top: chartTop, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {legend.map((l) => <LegendItem key={l.k} l={l} flag={flags[l.k]} fs={fs} />)}
        </div>
      )}
      {/* Legend below the chart otherwise, then the source line */}
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: footBottom, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!wide && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: tall ? 16 : 10, columnGap: 18 }}>
            {legend.map((l) => <LegendItem key={l.k} l={l} flag={flags[l.k]} fs={fs} />)}
          </div>
        )}
        <div style={{ fontSize: srcFs, lineHeight: 1.3, color: MUTED }}>
          Source: {race.source.org}, {race.source.dataset}. Each column is that year&apos;s total; &quot;{race.stack.otherLabel}&quot; is the total less the countries shown.
        </div>
      </div>
    </AbsoluteFill>
  );
};
