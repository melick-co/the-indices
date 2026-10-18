import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Audio, Easing, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Brand } from './BrandMark';
import { FlipYear } from './FlipYear';
import { loadFonts } from './fonts';
import { FONT } from './theme';
import {
  BAR_GROW_SHARE, BARS_FPS, BARS_INTRO_SECONDS, TRIM_ANIMATE_SECONDS, TRIM_CAPTION_SECONDS, TRIM_LEAD_SECONDS, barLabel, barStepSeconds,
  barsCaveatStart, barsOutroStart, barsSourcesStart, barsTrimStart, type BarsProps,
} from '../lib/bars-video-types';

const BRAND = 'Caveat Indices';
// The bar-race palette (BarRace.tsx), so the two kinds of video read as one series.
const NAVY = '#0f1830', NAVY2 = '#1d2a48', ON = '#eef2fa', MUTED = '#a9b6d3', GRID = 'rgba(169,182,211,.18)', ZERO = 'rgba(238,242,250,.7)';

/** A round step for the value axis (1, 2, 2.5 or 5 times a power of ten), giving about five lines. */
function niceStep(range: number) {
  const raw = range / 5, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10;
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Stripes in a group's colour: the part of a bar the trimmed pass takes out. */
const hatch = (c: string) => `repeating-linear-gradient(135deg, ${c} 0 7px, ${c}55 7px 14px)`;

/** [lo, hi] for the values between a and b. */
const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

/**
 * What a bar draws at trim progress t: the solid part and the hatched part, as value intervals. The bar stands at
 * d = value − trim·t; the hatched part is what is left to take out, between the trimmed value w and d, less any of it
 * across zero from d (a costing larger than the bar shows as the whole bar hatched, and the remainder appears as the
 * bar settles below zero). The solid part is the rest of the bar from zero to d.
 */
export function barParts(value: number, trim: number, t: number): { d: number; w: number; solid: [number, number] | null; hatched: [number, number] | null } {
  const w = value - trim, d = value - trim * t;
  let hatched: [number, number] | null = trim ? span(w, d) : null;
  if (hatched) {
    hatched = d >= 0 ? [Math.max(0, hatched[0]), hatched[1]] : [hatched[0], Math.min(0, hatched[1])];
    if (hatched[1] - hatched[0] <= 0) hatched = null;
  }
  // The solid part: zero to d, less the hatched part (which lies at d's end of the bar).
  let solid: [number, number] | null = span(0, d);
  if (hatched) solid = d >= 0 ? [0, Math.min(d, hatched[0])] : [Math.max(d, hatched[1]), 0];
  if (solid[1] - solid[0] <= 0) solid = null;
  return { d, w, solid, hatched };
}

/**
 * "Bars over time": one column per period, built left to right, each split into coloured segments (shares of the
 * period); data-derived captions; the period on the split-flap clock; then the finished chart holds, followed by the
 * caveat card, the sources card and the end card. Values above zero are the spec's `axis.up` side.
 */
export const BarBuild: React.FC<BarsProps> = ({ spec, format, musicFile }) => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => { loadFonts().then(() => continueRender(handle)).catch((e) => cancelRender(e)); }, [handle]);
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const tall = format === '9:16', wide = format === '16:9';
  const n = spec.bars.length;
  const fps = BARS_FPS;
  const intro = BARS_INTRO_SECONDS * fps, step = barStepSeconds(n) * fps, grow = step * BAR_GROW_SHARE;
  const caveatAt = barsCaveatStart(spec) * fps, sourcesAt = barsSourcesStart(spec) * fps, outroAt = barsOutroStart(spec) * fps;
  // The trimmed pass: heading, then the hatched parts animate away, then one caption per package.
  const trimAt = barsTrimStart(spec) * fps, animAt = trimAt + TRIM_LEAD_SECONDS * fps, animEnd = animAt + TRIM_ANIMATE_SECONDS * fps;
  const t = spec.trim ? interpolate(frame, [animAt, animEnd], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) }) : 0;
  const trimCaps = spec.trim?.captions ?? [];
  const trimCapAt = (j: number) => animEnd + j * TRIM_CAPTION_SECONDS * fps;
  const trimCapIdx = spec.trim && frame >= animEnd ? trimCaps.reduce((k, _, j) => (frame >= trimCapAt(j) ? j : k), -1) : -1;
  const startOf = (i: number) => intro + i * step;
  const g = (i: number) => interpolate(frame, [startOf(i), startOf(i) + grow], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const reached = Math.max(0, Math.min(n - 1, Math.floor((frame - intro) / step)));
  let period = spec.bars[reached].period;
  let prevPeriod = spec.bars[Math.max(0, reached - 1)].period;
  let sinceChange = reached === 0 ? 999 : frame - startOf(reached);
  const colour = useMemo(() => Object.fromEntries(spec.groups.map((x) => [x.key, x.colour])), [spec]);
  if (trimCapIdx >= 0) {
    period = spec.bars[trimCaps[trimCapIdx].bar].period;
    prevPeriod = trimCapIdx === 0 ? spec.bars[n - 1].period : spec.bars[trimCaps[trimCapIdx - 1].bar].period;
    sinceChange = frame - trimCapAt(trimCapIdx);
  }

  // ---------- layout
  const pad = tall ? 80 : 70;
  const clockSize = tall ? 84 : wide ? 72 : 60;
  const clockBottom = tall ? 340 : 40;
  const clockW = clockSize * 0.66 * period.length + clockSize * 0.08 * (period.length - 1);
  const capFs = tall ? 32 : wide ? 30 : 26;
  const captionBottom = clockBottom + clockSize + 22;
  const captionTop = height - captionBottom - (capFs * 1.25 * (wide ? 1 : 2) + 20);
  const yearFs = tall ? 22 : wide ? 22 : 18;
  const chartTop = tall ? 660 : wide ? 300 : spec.trim ? 400 : 360;
  const chartBottom = captionTop - 24 - yearFs * 1.6;
  const gutter = tall ? 110 : wide ? 120 : 96;
  const x0 = pad + gutter, x1 = width - pad;
  const colW = (x1 - x0) / n;
  const barW = colW * 0.72;
  const valFs = Math.min(wide ? 24 : 22, colW * 0.5);
  const whole = colW < 60;
  const labelH = valFs * 1.5;

  // ---------- scale: fixed from the start, so the bars grow into a stable frame
  // Both views, so the trimmed bars (some below zero) fit the same frame.
  const vals = spec.bars.flatMap((b) => (b.value == null ? [] : [b.value, b.value - (b.trim ?? 0)]));
  const maxUp = Math.max(0, ...vals), maxDown = Math.max(0, ...vals.map((v) => -v));
  const stepV = niceStep(maxUp + maxDown || 1);
  // The top runs to a round gridline; the bottom only as deep as the largest value below zero, so a small surplus
  // side doesn't take a full grid step of empty space.
  const topV = Math.ceil(maxUp / stepV) * stepV, botV = maxDown;
  const plotTop = chartTop + labelH, plotBottom = chartBottom - (botV > 0 ? labelH : 0);
  const scale = (plotBottom - plotTop) / ((topV + botV) || 1);
  const zeroY = plotTop + topV * scale;
  const y = (v: number) => zeroY - v * scale;
  const ticks: number[] = [];
  for (let v = -Math.floor(botV / stepV) * stepV; v <= topV + 1e-9; v += stepV) ticks.push(Math.round(v));

  // ---------- captions: from their bar until the next one (at most 4.5s), the last one through the hold
  const capIdx = [...spec.captions].map((c, i) => ({ ...c, i })).reverse().find((c) => frame >= startOf(c.bar));
  const capStart = capIdx ? startOf(capIdx.bar) : 0;
  const isLastCaption = capIdx && capIdx.i === spec.captions.length - 1;
  // In the trimmed pass its heading, then its own captions, replace the build's.
  const inTrim = !!spec.trim && frame >= trimAt;
  const caption = !inTrim ? (capIdx && (isLastCaption || frame - capStart < 4.5 * fps) ? { text: capIdx.text, at: capStart } : null)
    : trimCapIdx >= 0 ? { text: trimCaps[trimCapIdx].text, at: trimCapAt(trimCapIdx) } : { text: spec.trim!.heading, at: trimAt };
  const showCaption = caption && frame < caveatAt;
  const capOpacity = caption ? interpolate(frame, [caption.at, caption.at + 8], [0, 1], clamp) : 0;

  const introOpacity = interpolate(frame, [0, 12, intro - 10, intro + 5], [0, 1, 1, 0], clamp);
  const cardIn = (at: number) => interpolate(frame, [at, at + 12], [0, 1], clamp);
  const titleSize = tall ? 56 : wide ? 52 : 46;
  const orgs = [...new Set(spec.sources.map((s) => s.org))];

  return (
    // Quoted: an unquoted family name ending in a number (Source Sans 3) is invalid CSS and falls back to a serif.
    <AbsoluteFill style={{ background: NAVY, color: ON, fontFamily: `'${FONT.ui}', 'Helvetica Neue', Arial, sans-serif` }}>
      {musicFile && (
        <Audio src={staticFile(musicFile)} loop volume={(f) => interpolate(f, [0, 20, durationInFrames - 45, durationInFrames], [0, 0.55, 0.55, 0], clamp)} />
      )}
      {/* Header and legend */}
      <div style={{ position: 'absolute', left: pad, right: pad, top: tall ? 200 : 56 }}>
        <Brand name={BRAND} size={tall ? 26 : 22} style={{ fontSize: tall ? 26 : 22, letterSpacing: 4, textTransform: 'uppercase', color: MUTED, fontWeight: 600 }} />
        <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.1, marginTop: 10 }}>{spec.title}</div>
        <div style={{ fontSize: tall ? 26 : wide ? 24 : 21, color: MUTED, marginTop: 8, lineHeight: 1.3 }}>{spec.subtitle}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', marginTop: tall ? 22 : 14, alignItems: 'center' }}>
          {spec.groups.map((x) => (
            <span key={x.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: tall ? 26 : wide ? 24 : 21, fontWeight: 600 }}>
              <span style={{ width: 22, height: 22, borderRadius: 4, background: x.colour }} />{x.label}
            </span>
          ))}
          {spec.trim && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: tall ? 26 : wide ? 24 : 21, fontWeight: 600 }}>
              <span style={{ width: 22, height: 22, borderRadius: 4, background: hatch(MUTED) }} />{spec.trim.legend}
            </span>
          )}
          {spec.legendNote && <span style={{ fontSize: tall ? 21 : wide ? 20 : 17, color: MUTED, flexBasis: wide ? 'auto' : '100%' }}>{spec.legendNote}</span>}
        </div>
      </div>

      {/* Axis: grid, values in $ billion, and the plain words for each side of zero */}
      {ticks.map((v) => (
        <React.Fragment key={v}>
          <div style={{ position: 'absolute', left: x0, width: x1 - x0, top: y(v), height: v === 0 ? 2 : 1, background: v === 0 ? ZERO : GRID }} />
          <div style={{ position: 'absolute', left: pad + 34, width: gutter - 44, top: y(v) - valFs * 0.65, textAlign: 'right', fontSize: valFs * 0.9, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{barLabel(Math.abs(v), true)}</div>
        </React.Fragment>
      ))}
      <div style={{ position: 'absolute', left: x0, top: chartTop - (tall ? 44 : 36), fontSize: tall ? 20 : 18, color: MUTED, letterSpacing: 1 }}>{spec.axis.unitLabel}</div>
      {spec.trim && t > 0 && frame < caveatAt && (
        <div style={{ position: 'absolute', right: pad, top: chartTop - (tall ? 46 : 38), fontSize: tall ? 22 : 19, fontWeight: 700, color: ON, opacity: t }}>{spec.trim.heading}</div>
      )}
      {[{ text: spec.axis.up, from: plotTop, to: zeroY }, ...(botV > 0 ? [{ text: spec.axis.down, from: zeroY, to: plotBottom }] : [])].map((s) => (
        <div key={s.text} style={{ position: 'absolute', left: pad - 6, top: (s.from + s.to) / 2, width: 0, height: 0 }}>
          <div style={{ position: 'absolute', transform: 'translate(-50%, -50%) rotate(-90deg)', left: 14, whiteSpace: 'nowrap', fontSize: tall ? 19 : 17, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ON }}>{s.text}</div>
        </div>
      ))}

      {/* Bars, built left to right */}
      {spec.bars.map((b, i) => {
        const k = g(i);
        if (k <= 0) return null;
        const left = x0 + i * colW + (colW - barW) / 2;
        const cx = x0 + i * colW + colW / 2;
        const year = (i % 5 === 0 || i === n - 1) && (
          <div style={{ position: 'absolute', left: cx - 70, width: 140, top: chartBottom + 10, textAlign: 'center', fontSize: yearFs, color: MUTED }}>{b.period}</div>
        );
        if (b.value == null) {
          // No figure: a dashed outline on the zero line, never a made-up bar.
          return (
            <React.Fragment key={b.period}>
              <div style={{ position: 'absolute', left, width: barW, top: zeroY - 30, height: 30, border: `2px dashed ${MUTED}`, borderBottom: 'none', opacity: k * 0.8, boxSizing: 'border-box' }} />
              <div style={{ position: 'absolute', left: cx - 40, width: 80, top: zeroY - 30 - labelH, textAlign: 'center', fontSize: valFs * 0.85, color: MUTED, opacity: k }}>n/a</div>
              {year}
            </React.Fragment>
          );
        }
        const v = b.value * k, trim = (b.trim ?? 0) * k;
        const { d, w, solid, hatched } = barParts(v, trim, t);
        // Value intervals to pixels; segments stack from the end nearer zero, each part split in the bar's shares.
        const draw = ([lo, hi]: [number, number], striped: boolean) => {
          const top = Math.round(y(hi)), bottom = Math.round(y(lo)), len = bottom - top;
          const fromZero = hi <= 0; // a part below zero stacks downward from its top
          let acc = 0;
          return b.segments.map((s) => {
            const a = Math.round(acc * len), z = Math.round((acc + s.share) * len);
            acc += s.share;
            const c = colour[s.group] ?? MUTED;
            return <div key={`${striped ? 'h' : 's'}${s.group}`} style={{ position: 'absolute', left, width: barW, top: fromZero ? top + a : bottom - z, height: Math.max(0, z - a), background: striped ? hatch(c) : c }} />;
          });
        };
        // The label sits beyond the outer end of what is drawn; it changes from the full to the trimmed value
        // while the bar settles (faded through the move, so no in-between figure is shown).
        const ends = [d, ...(hatched ? hatched : []), ...(solid ? solid : [])];
        const outer = d >= 0 ? Math.max(...ends) : Math.min(...ends);
        const labelOpacity = interpolate(k, [0.85, 1], [0, 1], clamp) * (t > 0 && t < 1 ? Math.abs(t - 0.5) * 2 : 1);
        return (
          <React.Fragment key={b.period}>
            {/* After the trim starts, a faint outline keeps the full bar. */}
            {t > 0 && b.trim ? (
              <div style={{ position: 'absolute', left, width: barW, top: Math.round(y(Math.max(0, b.value))), height: Math.round(Math.abs(y(b.value) - y(0))), border: `2px solid ${MUTED}`, opacity: 0.45 * t, boxSizing: 'border-box' }} />
            ) : null}
            {solid && draw(solid, false)}
            {hatched && draw(hatched, true)}
            <div style={{
              position: 'absolute', left: cx - 60, width: 120, textAlign: 'center', fontSize: valFs, fontWeight: 700, color: ON, fontVariantNumeric: 'tabular-nums',
              top: outer >= 0 ? y(outer) - labelH : y(outer) + labelH * 0.12, opacity: labelOpacity,
            }}>{barLabel(t < 0.5 ? b.value : b.value - (b.trim ?? 0), whole)}</div>
            {year}
          </React.Fragment>
        );
      })}

      {/* Period counter: the split-flap clock, bottom right */}
      <div style={{ position: 'absolute', right: pad, bottom: clockBottom }}>
        <FlipYear text={period} prev={prevPeriod} sinceChange={sinceChange} flipFrames={Math.min(10, Math.max(6, Math.round(step * 0.5)))} size={clockSize} />
      </div>
      {/* Source line, beside the clock */}
      <div style={{ position: 'absolute', left: pad, right: pad + clockW + 30, bottom: clockBottom, fontSize: tall ? 21 : 18, lineHeight: 1.3, color: MUTED }}>
        Source: {orgs.join(', ')}. Colour: party in office.
      </div>
      {/* Caption, full width above the clock */}
      {showCaption && (
        <div style={{ position: 'absolute', left: pad, right: pad, bottom: captionBottom, display: 'flex', opacity: capOpacity }}>
          <div style={{ background: ON, color: NAVY, fontSize: capFs, fontWeight: 700, padding: '10px 20px', borderRadius: 8, lineHeight: 1.25 }}>{caption!.text}</div>
        </div>
      )}

      {/* Title card */}
      <AbsoluteFill style={{ background: NAVY, opacity: introOpacity, justifyContent: 'center', padding: pad }}>
        <Brand name={BRAND} size={tall ? 30 : 28} style={{ fontSize: tall ? 30 : 28, letterSpacing: 5, textTransform: 'uppercase', color: '#4f8fd1', fontWeight: 700 }} />
        <div style={{ fontSize: titleSize * 1.25, fontWeight: 800, lineHeight: 1.08, marginTop: 18 }}>{spec.title}</div>
        <div style={{ fontSize: tall ? 32 : 28, color: MUTED, marginTop: 16, lineHeight: 1.3 }}>{spec.subtitle}</div>
      </AbsoluteFill>

      {/* Caveat card */}
      {frame >= caveatAt && frame < sourcesAt + 12 && (
        <AbsoluteFill style={{ background: NAVY, opacity: cardIn(caveatAt), justifyContent: 'center', padding: pad, paddingBottom: tall ? 300 : pad }}>
          <Brand name={BRAND} size={tall ? 26 : 22} style={{ fontSize: tall ? 26 : 22, letterSpacing: 4, textTransform: 'uppercase', color: MUTED, fontWeight: 600 }} />
          <div style={{ display: 'flex', gap: 14, marginTop: 28 }}>
            {spec.groups.map((x) => <span key={x.key} style={{ width: 60, height: 14, borderRadius: 3, background: x.colour }} />)}
          </div>
          {spec.caveat.map((line, i) => (
            <div key={i} style={{ fontSize: i === 0 ? (tall ? 50 : wide ? 48 : 38) : (tall ? 32 : wide ? 30 : 25), fontWeight: i === 0 ? 700 : 400, color: i === 0 ? ON : MUTED, lineHeight: 1.22, marginTop: i === 0 ? 26 : 24, opacity: interpolate(frame, [caveatAt + 10 + i * 24, caveatAt + 22 + i * 24], [0, 1], clamp) }}>{line}</div>
          ))}
        </AbsoluteFill>
      )}

      {/* Sources card */}
      {frame >= sourcesAt && frame < outroAt + 12 && (
        <AbsoluteFill style={{ background: NAVY, opacity: cardIn(sourcesAt), padding: pad, paddingTop: tall ? 220 : 56, paddingBottom: tall ? 300 : 40 }}>
          <Brand name={BRAND} size={tall ? 26 : 22} style={{ fontSize: tall ? 26 : 22, letterSpacing: 4, textTransform: 'uppercase', color: MUTED, fontWeight: 600 }} />
          <div style={{ fontSize: tall ? 48 : wide ? 44 : 38, fontWeight: 700, marginTop: 18 }}>Sources</div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: tall ? 10 : 6 }}>
            {spec.sources.map((s, i) => <div key={i} style={{ fontSize: tall ? 25 : wide ? 22 : 19, lineHeight: 1.3, color: ON }}><b>{s.org}</b>: {s.dataset}</div>)}
          </div>
          <div style={{ marginTop: tall ? 28 : 16, display: 'flex', flexDirection: 'column', gap: tall ? 10 : 6 }}>
            {spec.notes.map((t, i) => <div key={i} style={{ fontSize: tall ? 21 : wide ? 19 : 16, lineHeight: 1.3, color: MUTED }}>{t}</div>)}
          </div>
        </AbsoluteFill>
      )}

      {/* End card */}
      {frame >= outroAt && (
        <AbsoluteFill style={{ background: `linear-gradient(180deg, ${NAVY} 0%, ${NAVY2} 100%)`, opacity: cardIn(outroAt), justifyContent: 'center', padding: pad }}>
          <Brand name={BRAND} size={tall ? 44 : 40} style={{ fontSize: tall ? 44 : 40, fontWeight: 800 }} />
          <div style={{ fontSize: tall ? 28 : 24, color: MUTED, marginTop: 12 }}>Australia, on one page · official data · {orgs.slice(0, 2).join(', ')}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
