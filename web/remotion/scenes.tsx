import React from 'react';
import { AbsoluteFill, Easing, Img, Loop, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CutMedia, CutProps, CutScene } from '../lib/reel-cut-types';
import { framesFor } from '../lib/reel-cut-types';
import { Chart } from './charts';
import { CHARCOAL, CONTENT_WIDTH, FONT, FOSSIL, INK, NAVY, PAPER, RULE, SAFE } from './theme';

/**
 * Scene layouts for the seven scene kinds. Every word on screen is the storyboard's own; the
 * layout only decides where it sits and how it arrives. Nothing counts up or ticks over, because a
 * frame in the middle of a count would show a figure the story never stated.
 */

function clamp(frame: number, from: [number, number], to: [number, number], easing?: (t: number) => number): number {
  return interpolate(frame, from, to, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
}

/** Opacity and lift for something arriving at `at` seconds into the scene. */
function useArrival(at: number, over = 0.45): React.CSSProperties {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = clamp(frame, [at * fps, (at + over) * fps], [0, 1], Easing.out(Easing.cubic));
  return { opacity: t, transform: `translateY(${(1 - t) * 18}px)` };
}

const mono: React.CSSProperties = {
  fontFamily: FONT.mono, fontSize: 24, letterSpacing: '0.1em', textTransform: 'uppercase', color: FOSSIL,
};

function Kicker({ left, index, total }: { left: string; index: number; total: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drawn = clamp(frame, [0, fps * 0.6], [0, 1], Easing.out(Easing.cubic));
  return (
    <div style={{ width: CONTENT_WIDTH }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 14 }}>
        <span style={mono}>{left}</span>
        <span style={mono}>{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
      </div>
      <div style={{ height: 2, width: `${drawn * 100}%`, background: RULE, opacity: 0.6 }} />
    </div>
  );
}

function OnScreen({ text, size, italic, at = 0.15 }: { text: string; size?: number; italic?: boolean; at?: number }) {
  const px = size ?? (text.length > 44 ? 64 : 76);
  return (
    <div style={{
      ...useArrival(at), width: CONTENT_WIDTH,
      fontFamily: FONT.display, fontStyle: italic ? 'italic' : 'normal', fontWeight: 400,
      fontSize: px, lineHeight: 1.08, letterSpacing: '-0.018em', color: INK, textWrap: 'balance' as never,
    }}>
      {text}
    </div>
  );
}

function LowerThird({ text }: { text?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!text) return <div style={{ height: 58 }} />;
  const t = clamp(frame, [fps * 0.35, fps * 0.8], [0, 1], Easing.out(Easing.cubic));
  return (
    <div style={{ width: CONTENT_WIDTH, overflow: 'hidden' }}>
      <span style={{
        display: 'inline-block', transform: `translateX(${(t - 1) * 100}%)`,
        background: INK, color: PAPER, padding: '14px 22px',
        fontFamily: FONT.mono, fontSize: 24, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.25,
        maxWidth: CONTENT_WIDTH,
      }}>
        {text}
      </span>
    </div>
  );
}

/** A generator's picture behind the text, washed with paper so the burned-in text stays legible. */
function Backdrop({ media, seconds }: { media: CutMedia; seconds: number }) {
  const frame = useCurrentFrame();
  const total = framesFor(seconds);
  const scale = 1 + (frame / Math.max(1, total)) * 0.06;
  const clipFrames = media.seconds && media.seconds > 0 ? framesFor(media.seconds) : null;
  const src = media.file ? staticFile(media.file) : media.url;
  const video = <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: media.kind === 'image' ? `scale(${scale})` : undefined }}>
        {media.kind === 'image'
          ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : clipFrames && clipFrames < total
            ? <Loop durationInFrames={clipFrames}>{video}</Loop>
            : video}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(243, 239, 228, 0.28)` }} />
      <AbsoluteFill style={{
        background: `linear-gradient(to bottom, ${PAPER} 0%, rgba(243,239,228,0.9) ${SAFE.top + 420}px, rgba(243,239,228,0) ${SAFE.top + 720}px, rgba(243,239,228,0) 68%, rgba(243,239,228,0.92) 84%, ${PAPER} 100%)`,
      }} />
    </AbsoluteFill>
  );
}

function Frame({ children, scene }: { children: React.ReactNode; scene: CutScene }) {
  const frame = useCurrentFrame();
  const fade = clamp(frame, [0, 6], [0, 1]);
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {scene.media && !scene.chart && <Backdrop media={scene.media} seconds={scene.seconds} />}
      <AbsoluteFill style={{
        padding: `${SAFE.top}px ${SAFE.x}px ${SAFE.bottom}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: fade,
      }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Nameplate({ size = 112 }: { size?: number }) {
  return (
    <div style={{ ...useArrival(0.05), fontFamily: FONT.masthead, fontSize: size, lineHeight: 1, color: INK }}>
      The Caveat
    </div>
  );
}

type SceneProps = { scene: CutScene; index: number; total: number; props: CutProps };

function ColdOpen({ scene, props }: SceneProps) {
  return (
    <Frame scene={scene}>
      <div>
        <Nameplate />
        <div style={{ ...mono, marginTop: 22 }}>{props.story.kicker}</div>
      </div>
      <OnScreen text={scene.on_screen} size={scene.on_screen.length > 36 ? 76 : 92} at={0.3} />
      <LowerThird text={scene.lower_third} />
    </Frame>
  );
}

function Standard({ scene, index, total }: SceneProps) {
  const centred = !scene.chart && !scene.media;
  return (
    <Frame scene={scene}>
      <Kicker left="The Caveat" index={index} total={total} />
      {scene.chart ? (
        <>
          <OnScreen text={scene.on_screen} size={scene.on_screen.length > 40 ? 52 : 60} />
          <Chart chart={scene.chart} />
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: centred ? 'center' : 'flex-start', flex: 1, paddingTop: centred ? 0 : 40 }}>
          <OnScreen text={scene.on_screen} size={centred ? (scene.on_screen.length > 40 ? 72 : 88) : 68} />
        </div>
      )}
      <LowerThird text={scene.lower_third} />
    </Frame>
  );
}

function OneNumber({ scene, index, total, props }: SceneProps) {
  const number = props.oneNumber;
  const value = number?.value ?? '';
  const size = value.length > 7 ? 120 : value.length > 4 ? 160 : 210;
  return (
    <Frame scene={scene}>
      <Kicker left="One number" index={index} total={total} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36, flex: 1, justifyContent: 'center' }}>
        <OnScreen text={scene.on_screen} size={scene.on_screen.length > 40 ? 50 : 58} />
        {number && (
          <div style={useArrival(0.5)}>
            <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: size, lineHeight: 1, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </div>
            <div style={{ fontFamily: FONT.ui, fontSize: 36, lineHeight: 1.3, color: CHARCOAL, marginTop: 20, maxWidth: CONTENT_WIDTH }}>
              {number.label}
            </div>
          </div>
        )}
        {scene.chart && <Chart chart={scene.chart} />}
      </div>
      <LowerThird text={scene.lower_third} />
    </Frame>
  );
}

function Caveat({ scene, index, total }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drawn = clamp(frame, [fps * 0.1, fps * 0.9], [0, 1], Easing.out(Easing.cubic));
  return (
    <Frame scene={scene}>
      <Kicker left="Caveat lector" index={index} total={total} />
      <div style={{ display: 'flex', gap: 36, flex: 1, alignItems: 'center' }}>
        <div style={{ width: 8, alignSelf: 'stretch', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '20%', height: `${drawn * 60}%`, width: 8, background: CHARCOAL }} />
        </div>
        <div style={{ flex: 1 }}>
          <OnScreen text={scene.on_screen} size={scene.on_screen.length > 44 ? 58 : 68} italic at={0.35} />
        </div>
      </div>
      <LowerThird text={scene.lower_third} />
    </Frame>
  );
}

function Sources({ scene, index, total, props }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Frame scene={scene}>
      <Kicker left="Sources" index={index} total={total} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40 }}>
        <OnScreen text={scene.on_screen} size={scene.on_screen.length > 44 ? 48 : 56} />
        {props.sources.length > 0 && (
          <div style={{ width: CONTENT_WIDTH, borderTop: `1px solid ${RULE}` }}>
            {props.sources.map((s, i) => {
              const t = clamp(frame, [fps * (0.5 + i * 0.12), fps * (0.85 + i * 0.12)], [0, 1]);
              return (
                <div key={`${s.org}-${s.period}`} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24,
                  padding: '18px 0', borderBottom: `1px solid ${RULE}`, opacity: t,
                }}>
                  <span style={{ fontFamily: FONT.ui, fontWeight: 600, fontSize: 32, color: INK }}>{s.org}</span>
                  <span style={{ ...mono, fontSize: 22, flexShrink: 0 }}>{s.period}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: CONTENT_WIDTH }}>
        <Nameplate size={72} />
        <span style={mono}>{props.story.published}</span>
      </div>
    </Frame>
  );
}

export function Scene(p: SceneProps) {
  switch (p.scene.kind) {
    case 'cold_open': return <ColdOpen {...p} />;
    case 'one_number': return <OneNumber {...p} />;
    case 'caveat': return <Caveat {...p} />;
    case 'sources': return <Sources {...p} />;
    default: return <Standard {...p} />;
  }
}
