import React from 'react';

/** The Caveat Indices mark (three rising bars, as in the site's masthead) before the name. `size` is the text size. */
export const Brand: React.FC<{ name: string; size: number; style?: React.CSSProperties }> = ({ name, size, style }) => {
  const h = size * 0.95, w = size * 0.2, gap = size * 0.1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.45, ...style }}>
      <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap, height: h, flexShrink: 0 }} aria-hidden="true">
        {[{ f: 0.44, c: '#4f8fd1' }, { f: 0.72, c: '#8db8e8' }, { f: 1, c: '#ffffff' }].map((b, i) => (
          <i key={i} style={{ display: 'block', width: w, height: h * b.f, borderRadius: w * 0.25, background: b.c }} />
        ))}
      </span>
      <span>{name}</span>
    </div>
  );
};
