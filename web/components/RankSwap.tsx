'use client';
import { useEffect, useRef, useState } from 'react';

const DATA: [string, string, number, number][] = [
  ['USA','United States',1425.1,340.1],['DEU','Germany',586.2,83.6],
  ['CAN','Canada',483.6,41.5],['GBR','United Kingdom',435.7,68.6],
  ['ESP','Spain',368.0,48.9],['FRA','France',298.1,68.4],
  ['AUS','Australia',239.3,27.2],['NLD','Netherlands',183.4,18.0],
  ['JPN','Japan',177.1,123.8],['CHE','Switzerland',135.6,8.9],
  ['IRL','Ireland',71.9,5.4],['LUX','Luxembourg',26.4,0.67],
  ['ISL','Iceland',14.8,0.39],
];
const ROW = 30;

export default function RankSwap() {
  const [perCapita, setPer] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => setPer((p) => !p), 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const scored = DATA.map(([c, n, abs, pop]) => ({ c, n, v: perCapita ? abs / pop : abs }))
    .sort((a, b) => b.v - a.v);
  const max = scored[0].v;
  const pos = new Map(scored.map((s, i) => [s.c, i]));

  return (
    <div className="figure">
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => { if (timer.current) clearInterval(timer.current); setPer(false); }}
          style={btn(!perCapita)}>Total intake</button>
        <button
          onClick={() => { if (timer.current) clearInterval(timer.current); setPer(true); }}
          style={btn(perCapita)}>Per 1,000 people</button>
      </div>
      <div style={{ position: 'relative', height: DATA.length * ROW + 8 }}>
        {DATA.map(([c, n, abs, pop]) => {
          const v = perCapita ? abs / pop : abs;
          const aus = c === 'AUS';
          return (
            <div key={c} style={{
              position: 'absolute', left: 0, right: 0, height: ROW - 6,
              top: (pos.get(c) ?? 0) * ROW,
              display: 'flex', alignItems: 'center', gap: '.5rem',
              transition: 'top .9s cubic-bezier(.65,0,.35,1)',
            }}>
              <span style={{
                width: '2rem', textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '.7rem', color: 'var(--ink-faint)',
              }}>{(pos.get(c) ?? 0) + 1}</span>
              <span style={{
                width: '8.5rem', fontSize: '.82rem',
                fontWeight: aus ? 600 : 400,
              }}>{n}</span>
              <span style={{
                height: 14, borderRadius: 2,
                width: `${Math.max(2, (v / max) * 58)}%`,
                background: aus ? 'var(--pen)' : 'var(--ink)',
                transition: 'width .9s cubic-bezier(.65,0,.35,1)',
              }} />
              <span style={{
                fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem',
                color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums',
              }}>{perCapita ? v.toFixed(1) : Math.round(v).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
      <p className="figure-cap">
        Permanent migration, 2024. Switching the denominator reorders the board:
        the United States falls from 1st to 26th of 38, Luxembourg rises to 1st.
        Australia (in red) barely moves, 8th to 14th.<br />
        Source: OECD International Migration Outlook 2025, Table 1.1; population World Bank.
      </p>
    </div>
  );
}

const btn = (active: boolean): React.CSSProperties => ({
  fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem', letterSpacing: '.08em',
  textTransform: 'uppercase', padding: '.4rem .7rem', cursor: 'pointer',
  border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
  background: active ? 'var(--ink)' : 'transparent',
  color: active ? 'var(--paper)' : 'var(--ink-soft)', borderRadius: 0,
});
