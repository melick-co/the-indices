export type SeriesPoint = { period: string; value: number };

export type InputSeriesChartProps = {
  title: string;
  subtitle?: string;
  role?: string;
  unit?: string;
  points: SeriesPoint[];
  step?: boolean;
  latest?: number | null;
};

const W = 320;
const H = 120;
const PAD = { t: 12, r: 12, b: 28, l: 36 };

function fmtPeriod(period: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return new Date(`${period}T00:00:00Z`).toLocaleDateString('en-AU', {
      month: 'short', year: '2-digit', timeZone: 'UTC',
    });
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-AU', {
      month: 'short', year: '2-digit', timeZone: 'UTC',
    });
  }
  return period;
}

function buildPath(points: SeriesPoint[], step: boolean, x: (i: number) => number, y: (v: number) => number) {
  if (!points.length) return '';
  if (points.length === 1) {
    const px = x(0);
    const py = y(points[0].value);
    return `M ${PAD.l} ${py} L ${W - PAD.r} ${py} M ${px} ${PAD.t} L ${px} ${H - PAD.b}`;
  }
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const px = x(i);
    const py = y(points[i].value);
    if (i === 0) {
      d += `M ${px} ${py}`;
      continue;
    }
    if (step) {
      d += ` H ${px} V ${py}`;
    } else {
      d += ` L ${px} ${py}`;
    }
  }
  return d;
}

export default function InputSeriesChart({
  title,
  subtitle,
  role,
  unit = '%',
  points,
  step = false,
  latest,
}: InputSeriesChartProps) {
  const values = points.map((p) => p.value);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const padY = (maxV - minV) * 0.08 || 0.5;
  const lo = minV - padY;
  const hi = maxV + padY;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const x = (i: number) => PAD.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - ((v - lo) / (hi - lo)) * innerH;

  const path = buildPath(points, step, x, y);
  const displayLatest = latest ?? (points.length ? points[points.length - 1].value : null);

  return (
    <div className="input-chart-box">
      <div className="input-chart-head">
        <div>
          <div className="input-chart-title">{title}</div>
          {role && <div className="input-chart-role">{role}</div>}
        </div>
        <div className="input-chart-latest">
          {displayLatest != null ? (
            <>
              <span className="input-chart-value">{displayLatest.toFixed(2)}</span>
              <span className="input-chart-unit">{unit}</span>
            </>
          ) : (
            <span className="input-chart-value">—</span>
          )}
        </div>
      </div>
      {subtitle && <div className="input-chart-sub">{subtitle}</div>}
      {points.length === 0 ? (
        <p className="input-chart-empty">No observations in the past twelve months.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="input-chart-svg" role="img"
          aria-label={`${title} over the past twelve months`}>
          {[0, 0.5, 1].map((t) => {
            const v = lo + (hi - lo) * (1 - t);
            const yy = PAD.t + innerH * t;
            return (
              <g key={t}>
                <line x1={PAD.l} y1={yy} x2={W - PAD.r} y2={yy}
                  stroke="var(--color-fossil)" strokeWidth={0.5} opacity={0.35} />
                <text x={PAD.l - 4} y={yy + 3} textAnchor="end" fontSize={8}
                  fill="var(--color-fossil)" fontFamily="IBM Plex Mono, monospace">
                  {v.toFixed(1)}
                </text>
              </g>
            );
          })}
          {path && (
            <path d={path} fill="none" stroke="var(--color-ink-black)" strokeWidth={2}
              vectorEffect="non-scaling-stroke" />
          )}
          {points.map((p, i) => (
            <circle key={p.period} cx={x(i)} cy={y(p.value)} r={3}
              fill="var(--color-paper-white)" stroke="var(--color-ink-black)" strokeWidth={1.5} />
          ))}
          {points.length > 0 && (
            <>
              <text x={x(0)} y={H - 6} textAnchor="start" fontSize={8}
                fill="var(--color-fossil)" fontFamily="IBM Plex Mono, monospace">
                {fmtPeriod(points[0].period)}
              </text>
              {points.length > 1 && (
                <text x={x(points.length - 1)} y={H - 6} textAnchor="end" fontSize={8}
                  fill="var(--color-fossil)" fontFamily="IBM Plex Mono, monospace">
                  {fmtPeriod(points[points.length - 1].period)}
                </text>
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}
