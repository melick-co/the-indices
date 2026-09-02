/** Semicircular gauge: green (low) → amber (mid) → red (high). */

export type DialProps = {
  id?: string;
  value: number | null;
  min?: number;
  max?: number;
  label: string;
  subtitle?: string;
  unit?: string;
  footnote?: string;
  size?: 'md' | 'lg';
};

const CX = 100;
const CY = 96;
const R = 72;
const STROKE = 10;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number, r = R) {
  const s = polar(r, startDeg);
  const e = polar(r, endDeg);
  const large = startDeg - endDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export default function Dial({
  id = 'dial',
  value,
  min = 0,
  max = 100,
  label,
  subtitle,
  unit = '%',
  footnote,
  size = 'lg',
}: DialProps) {
  const gradId = `${id}-gradient`;
  const hasValue = value != null && Number.isFinite(value);
  const norm = hasValue ? clamp((value - min) / (max - min), 0, 1) : 0;
  const needleDeg = 180 - norm * 180;
  const needle = polar(R - STROKE / 2, needleDeg);
  const display = hasValue ? (unit === '/100' ? value.toFixed(1) : Math.round(value).toString()) : '—';
  const dim = size === 'lg' ? 220 : 180;

  return (
    <figure className={`dial dial-${size}`} aria-label={`${label}: ${display}${unit === '/100' ? '' : unit}`}>
      <svg viewBox="0 0 200 118" width={dim} height={dim * 0.58} role="img" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2a9d6e" />
            <stop offset="50%" stopColor="#e9b949" />
            <stop offset="100%" stopColor="#c0392b" />
          </linearGradient>
        </defs>
        {/* track */}
        <path
          d={arcPath(180, 0)}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={STROKE}
          strokeLinecap="butt"
        />
        {/* dim unfilled portion */}
        {hasValue && norm < 1 && (
          <path
            d={arcPath(needleDeg, 0)}
            fill="none"
            stroke="var(--color-paper-white)"
            strokeWidth={STROKE + 2}
            strokeLinecap="butt"
            opacity={0.92}
          />
        )}
        {/* needle */}
        {hasValue && (
          <>
            <line
              x1={CX}
              y1={CY}
              x2={needle.x}
              y2={needle.y}
              stroke="var(--color-ink-black)"
              strokeWidth={2}
            />
            <circle cx={needle.x} cy={needle.y} r={5} fill="var(--color-ink-black)" />
          </>
        )}
        <text x={18} y={112} fontSize={9} fill="var(--color-fossil)" fontFamily="IBM Plex Mono, monospace">
          {min}
        </text>
        <text x={178} y={112} fontSize={9} fill="var(--color-fossil)" fontFamily="IBM Plex Mono, monospace" textAnchor="end">
          {max}
        </text>
      </svg>
      <div className="dial-readout">
        <span className="dial-value">{display}</span>
        {unit !== '/100' && unit && <span className="dial-unit">{unit}</span>}
        {unit === '/100' && <span className="dial-unit">/100</span>}
      </div>
      <figcaption className="dial-label">{label}</figcaption>
      {subtitle && <p className="dial-sub">{subtitle}</p>}
      {footnote && <p className="dial-foot">{footnote}</p>}
    </figure>
  );
}
