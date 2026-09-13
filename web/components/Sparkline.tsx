/** Recent history behind a dial reading: shape only, no axes. */

export type SparkPoint = { period: string; value: number };

const W = 160;
const H = 30;
const PAD = 3;

export default function Sparkline({
  points,
  label,
  step = false,
}: {
  points: SparkPoint[];
  label: string;
  step?: boolean;
}) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const x = (i: number) => PAD + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD + innerH - ((v - lo) / span) * innerH;

  let d = `M ${x(0)} ${y(values[0])}`;
  for (let i = 1; i < points.length; i++) {
    d += step ? ` H ${x(i)} V ${y(values[i])}` : ` L ${x(i)} ${y(values[i])}`;
  }

  const lastX = x(points.length - 1);
  const lastY = y(values[values.length - 1]);
  const first = points[0].period;
  const last = points[points.length - 1].period;

  return (
    <svg
      className="dial-spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label}, ${first} to ${last}`}
    >
      <path d={d} fill="none" stroke="var(--color-charcoal)" strokeWidth={1.25}
        vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.2} fill="var(--color-ink-black)" />
    </svg>
  );
}
