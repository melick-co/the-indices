'use client';
const YRS = [2021, 2022, 2023, 2024, 2025, 2026];
const AWARD = [2.5, 4.6, 5.75, 3.75, 3.5, 4.75];
const CPI: (number | null)[] = [3.8, 6.1, 6.0, 3.8, 2.1, 3.8];
const W = 620, H = 260, PAD = 38;
const X = (i: number) => PAD + i * ((W - PAD * 2) / (YRS.length - 1));
const Y = (v: number) => H - 34 - (v / 7) * (H - 70);

export default function SpiralTimeline() {
  const path = CPI.map((v, i) => (v == null ? '' : `${i ? 'L' : 'M'}${X(i)} ${Y(v)}`)).join(' ');
  return (
    <div className="figure">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img"
        aria-label="Award wage increases against consumer price inflation, 2021 to 2026">
        {[0, 2, 4, 6].map((v) => (
          <g key={v}>
            <line x1={PAD - 6} x2={W - PAD} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
            <text x={8} y={Y(v) + 4} fontFamily="IBM Plex Mono, monospace" fontSize="10"
              fill="var(--ink-faint)">{v}%</text>
          </g>
        ))}
        {YRS.map((y, i) => (
          <g key={y}>
            <rect x={X(i) - 11} y={Y(AWARD[i])} width={22} height={H - 34 - Y(AWARD[i])}
              fill={AWARD[i] >= 4.5 ? 'var(--ink)' : 'var(--ink-faint)'} rx={1} />
            <text x={X(i)} y={Y(AWARD[i]) - 5} textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace" fontSize="9.5" fill="var(--ink)">
              {AWARD[i]}%
            </text>
            <text x={X(i)} y={H - 16} textAnchor="middle"
              fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="var(--ink-faint)">{y}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--pen)" strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round" />
        {CPI.map((v, i) => v == null ? null : (
          <circle key={i} cx={X(i)} cy={Y(v)} r={3.5} fill="var(--paper)"
            stroke="var(--pen)" strokeWidth={2} />
        ))}
        <text x={X(1) - 6} y={Y(6.1) - 12} fontFamily="IBM Plex Mono, monospace"
          fontSize="9.5" fill="var(--pen)">&ldquo;spiral&rdquo; → fell</text>
        <text x={X(2) + 4} y={Y(6.0) - 12} fontFamily="IBM Plex Mono, monospace"
          fontSize="9.5" fill="var(--pen)">&ldquo;spiral&rdquo; → fell again</text>
      </svg>
      <p className="figure-cap">
        Bars: modern award increases, effective 1 July. Line: headline CPI, annual change.
        The two largest rises were followed by inflation falling; the smallest rise of the era
        was followed by inflation rising.<br />
        Source: Fair Work Commission Annual Wage Reviews; ABS 6401.0. The 2023 minimum wage
        figure of 8.65% includes a one-off technical realignment and is excluded; award rates shown.
      </p>
    </div>
  );
}
