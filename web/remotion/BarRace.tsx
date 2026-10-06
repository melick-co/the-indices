import React, { useMemo, useState, useEffect } from 'react';
import { AbsoluteFill, Audio, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { curves, glidingRanks, standings } from './race-motion';
import { FlipYear } from './FlipYear';
import { loadFonts } from './fonts';
import { FONT } from './theme';
import { INTRO_SECONDS, OUTRO_SECONDS, RACE_FPS, stepSeconds, type RaceProps } from '../lib/race-video-types';

const NAVY = '#0f1830', NAVY2 = '#1d2a48', ON = '#eef2fa', MUTED = '#a9b6d3', ACCENT = '#4f8fd1';
const PALETTE = ['#4f8fd1', '#2f9e44', '#f07f1e', '#c2372d', '#8a5cc2', '#d9a21b', '#14837b', '#b04a7a', '#8db8e8', '#7aa95c', '#e0775a', '#5b6bb5'];
const colourFor = (key: string) => PALETTE[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

function value(v: number, unit: RaceProps['race']['unit']) {
  if (unit === 'usd') return `US$${Math.round(v).toLocaleString('en-AU')}`;
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : Math.round(v).toLocaleString('en-AU');
}

/** A bar-chart race: bars glide between ranks and values; data-derived captions; title and end cards; music bed. */
export const BarRace: React.FC<RaceProps> = ({ race, format, musicFile }) => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => { loadFonts().then(() => continueRender(handle)).catch((e) => cancelRender(e)); }, [handle]);
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const tall = format === '9:16', wide = format === '16:9';
  const n = race.frames.length;
  const intro = INTRO_SECONDS * RACE_FPS, perStep = stepSeconds(n) * RACE_FPS;
  // Constant-speed time through the whole timeline; s = 3.5 is halfway between the 4th and 5th periods.
  const sAt = (f: number) => Math.min(n - 1, Math.max(0, (f - intro) / perStep));
  const s = sAt(frame);
  const slots = format === '1:1' ? Math.min(race.topN, 8) : race.topN;
  const c = useMemo(() => curves(race), [race]);
  const now = standings(c, s);
  const glide = glidingRanks(c, sAt, frame, slots);
  const rows = now.map((x) => ({ k: x.k, v: x.v, r: glide[x.k] ?? slots + 1 })).filter((x) => x.r < slots);
  const maxV = Math.max(1, ...now.slice(0, slots).map((x) => x.v));
  // The clock shows the last period reached; it flips over as each new one arrives.
  const reached = Math.floor(s + 1e-6);
  const period = race.frames[reached].period;
  const prevPeriod = race.frames[Math.max(0, reached - 1)].period;
  const sinceChange = reached === 0 ? 999 : frame - (intro + reached * perStep);

  const pad = tall ? 80 : 70;
  // Each format gives the clock its own zone so no bar can run into it: top right beside the title (16:9), a band
  // below the bars inside the platforms' safe area (9:16), a strip below the bars beside the caption (1:1).
  const clockSize = tall ? 110 : wide ? 100 : 76;
  const clockW = clockSize * 0.66 * 4 + clockSize * 0.08 * 3;
  const top = tall ? 560 : wide ? 250 : 280;
  const bottom = tall ? 690 : wide ? 130 : 290;
  const labelW = wide ? 330 : 300;
  const area = height - top - bottom;
  const slotH = area / slots;
  const barMax = width - pad * 2 - labelW - (wide ? 260 : 200);
  const outroStart = durationInFrames - OUTRO_SECONDS * RACE_FPS;
  const keyframe = reached;
  const caption = [...race.captions].reverse().find((c) => keyframe >= c.frame && keyframe - c.frame <= Math.ceil(2.5 / stepSeconds(n)));
  const introOpacity = interpolate(frame, [0, 12, intro - 10, intro + 5], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const outroOpacity = interpolate(frame, [outroStart, outroStart + 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleSize = tall ? 64 : wide ? 58 : 52;

  return (
    // Quoted: an unquoted family name ending in a number (Source Sans 3) is invalid CSS and falls back to a serif.
    <AbsoluteFill style={{ background: NAVY, color: ON, fontFamily: `'${FONT.ui}', 'Helvetica Neue', Arial, sans-serif` }}>
      {musicFile && (
        <Audio src={staticFile(musicFile)} volume={(f) => interpolate(f, [0, 20, durationInFrames - 45, durationInFrames], [0, 0.55, 0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      )}
      {/* Header */}
      <div style={{ position: 'absolute', left: pad, right: wide ? pad + clockW + 40 : pad, top: tall ? 200 : 60 }}>
        <div style={{ fontSize: tall ? 26 : 24, letterSpacing: 4, textTransform: 'uppercase', color: MUTED, fontWeight: 600 }}>The Indices</div>
        <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.1, marginTop: 10 }}>{race.title}</div>
        <div style={{ fontSize: tall ? 30 : 26, color: MUTED, marginTop: 10 }}>{race.subtitle}</div>
      </div>
      {/* Bars */}
      {rows.map((x) => {
        const y = top + x.r * slotH;
        const w = Math.max(4, (x.v / maxV) * barMax);
        // Bars leaving the top N fade out within the last slot, so nothing is drawn under the captions.
        const fade = interpolate(x.r, [slots - 1, slots - 0.2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={x.k} style={{ position: 'absolute', left: pad, top: y, height: slotH * 0.78, width: width - pad * 2, display: 'flex', alignItems: 'center', opacity: fade }}>
            <div style={{ width: labelW, paddingRight: 18, textAlign: 'right', fontSize: Math.min(36, slotH * 0.42), fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{race.labels[x.k] ?? x.k}</div>
            <div style={{ width: w, height: '100%', background: colourFor(x.k), borderRadius: 6 }} />
            <div style={{ paddingLeft: 16, fontSize: Math.min(32, slotH * 0.38), color: ON, fontVariantNumeric: 'tabular-nums' }}>{value(x.v, race.unit)}</div>
          </div>
        );
      })}
      {/* Period counter: a split-flap clock */}
      <div style={{ position: 'absolute', right: pad, ...(wide ? { top: 64 } : { bottom: tall ? 520 : 150 }) }}>
        <FlipYear text={period} prev={prevPeriod} sinceChange={sinceChange} flipFrames={Math.min(10, Math.max(6, Math.round(perStep * 0.6)))} size={clockSize} />
      </div>
      {/* Caption */}
      {caption && frame < outroStart && (
        <div style={{ position: 'absolute', left: pad, right: tall || wide ? pad : pad + clockW + 30, bottom: tall ? 410 : wide ? 56 : 160, display: 'flex' }}>
          <div style={{ background: ACCENT, color: '#fff', fontSize: tall ? 34 : 30, fontWeight: 700, padding: '12px 22px', borderRadius: 8 }}>{caption.text}</div>
        </div>
      )}
      {/* Source */}
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: tall ? 345 : 18, fontSize: tall ? 22 : 20, color: MUTED }}>Source: {race.source.org}, {race.source.dataset}. Values between {race.frames.length > 1 && /^\d{4}$/.test(race.frames[0].period) ? 'years' : 'periods'} are interpolated.</div>
      {/* Title card */}
      <AbsoluteFill style={{ background: NAVY, opacity: introOpacity, justifyContent: 'center', padding: pad }}>
        <div style={{ fontSize: tall ? 30 : 28, letterSpacing: 5, textTransform: 'uppercase', color: ACCENT, fontWeight: 700 }}>The Indices</div>
        <div style={{ fontSize: titleSize * 1.25, fontWeight: 800, lineHeight: 1.08, marginTop: 18 }}>{race.title}</div>
        <div style={{ fontSize: tall ? 34 : 30, color: MUTED, marginTop: 16 }}>{race.subtitle}</div>
      </AbsoluteFill>
      {/* End card */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(15,24,48,0) 0%, ${NAVY2} 55%)`, opacity: outroOpacity, justifyContent: 'flex-end', padding: pad, paddingBottom: tall ? 300 : 70 }}>
        <div style={{ fontSize: tall ? 40 : 36, fontWeight: 800 }}>The Indices</div>
        <div style={{ fontSize: tall ? 26 : 24, color: MUTED, marginTop: 8 }}>Australia, on one page · official data · {race.source.org}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
