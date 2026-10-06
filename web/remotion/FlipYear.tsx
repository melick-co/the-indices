import React from 'react';

/**
 * The period as a split-flap clock. Each character sits on its own card; when it changes, the top flap (old
 * character) folds down, then the bottom flap (new character) lands, over `flipFrames` frames.
 */
export const FlipYear: React.FC<{ text: string; prev: string; sinceChange: number; flipFrames: number; size: number }> = ({ text, prev, sinceChange, flipFrames, size }) => {
  const w = size * 0.66, h = size, r = size * 0.08;
  const card: React.CSSProperties = { position: 'absolute', left: 0, width: w, height: h / 2, overflow: 'hidden', background: '#1b2744', color: '#eef2fa' };
  const glyph = (c: string, half: 'top' | 'bottom'): React.ReactNode => (
    <div style={{ position: 'absolute', left: 0, width: w, height: h, top: half === 'top' ? 0 : -h / 2, lineHeight: `${h}px`, textAlign: 'center', fontSize: size * 0.82, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{c}</div>
  );
  const p = Math.min(1, Math.max(0, sinceChange / flipFrames));
  return (
    <div style={{ display: 'flex', gap: size * 0.08, perspective: size * 6 }}>
      {[...text].map((c, i) => {
        const old = prev[i] ?? c;
        const flipping = old !== c && p < 1;
        return (
          <div key={i} style={{ position: 'relative', width: w, height: h, borderRadius: r, boxShadow: '0 6px 18px rgba(0,0,0,.45)' }}>
            {/* Static halves: the new character on top, the old one below until the flap lands. */}
            <div style={{ ...card, top: 0, borderRadius: `${r}px ${r}px 0 0` }}>{glyph(c, 'top')}</div>
            <div style={{ ...card, top: h / 2, borderRadius: `0 0 ${r}px ${r}px`, background: '#17223d' }}>{glyph(flipping ? old : c, 'bottom')}</div>
            {flipping && p < 0.5 && (
              <div style={{ ...card, top: 0, borderRadius: `${r}px ${r}px 0 0`, transformOrigin: 'bottom', transform: `rotateX(${-p * 2 * 90}deg)`, backfaceVisibility: 'hidden' }}>{glyph(old, 'top')}</div>
            )}
            {flipping && p >= 0.5 && (
              <div style={{ ...card, top: h / 2, borderRadius: `0 0 ${r}px ${r}px`, background: '#17223d', transformOrigin: 'top', transform: `rotateX(${(1 - (p - 0.5) * 2) * 90}deg)`, backfaceVisibility: 'hidden' }}>{glyph(c, 'bottom')}</div>
            )}
            {/* The hinge line across the middle. */}
            <div style={{ position: 'absolute', left: 0, right: 0, top: h / 2 - 1, height: 2, background: '#0b1226' }} />
          </div>
        );
      })}
    </div>
  );
};
