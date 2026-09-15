import type { InstrumentCard, InstrumentObservation } from '@/lib/instrument-types';

const W = 320;
const H = 92;
const PAD = 8;

function path(points: InstrumentObservation[], w = W, h = H) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const innerW = w - PAD * 2;
  const innerH = h - PAD * 2;
  const x = (i: number) => PAD + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD + innerH - ((v - lo) / span) * innerH;
  let d = `M ${x(0)} ${y(values[0])}`;
  for (let i = 1; i < points.length; i++) d += ` L ${x(i)} ${y(values[i])}`;
  return { d, last: { x: x(points.length - 1), y: y(values[values.length - 1]) } };
}

function stacked(a: InstrumentObservation[], b: InstrumentObservation[]) {
  const periods = a.map((p) => p.period);
  const bMap = new Map(b.map((p) => [p.period, p.value]));
  const rows = periods
    .map((period, i) => ({ period, a: a[i].value, b: bMap.get(period) ?? 0 }))
    .filter((r) => r.b != null);
  if (rows.length < 2) return null;
  const totals = rows.map((r) => r.a + r.b);
  const hi = Math.max(...totals) || 1;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const x = (i: number) => PAD + (i / (rows.length - 1)) * innerW;
  const y = (v: number) => PAD + innerH - (v / hi) * innerH;
  const bottom = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.b)}`);
  const top = [...rows].reverse().map((r, i) => `L ${x(rows.length - 1 - i)} ${y(r.a + r.b)}`);
  return `${bottom.join(' ')} ${top.join(' ')} Z`;
}

function zeroPath(points: InstrumentObservation[]) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const x = (i: number) => PAD + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD + innerH - ((v - lo) / span) * innerH;
  let d = `M ${x(0)} ${y(values[0])}`;
  for (let i = 1; i < points.length; i++) d += ` L ${x(i)} ${y(values[i])}`;
  const zeroY = y(0);
  return { d, zeroY, last: { x: x(points.length - 1), y: y(values[values.length - 1]) } };
}

function tape(price: InstrumentObservation[], volume: InstrumentObservation[]) {
  const pricePath = path(price, W, 62);
  const maxV = Math.max(...volume.map((p) => p.value), 1);
  const barW = Math.max(2, (W - PAD * 2) / Math.max(volume.length, 1) - 1);
  const bars = volume.map((p, i) => {
    const x = PAD + (i / Math.max(volume.length - 1, 1)) * (W - PAD * 2);
    const h = (p.value / maxV) * 22;
    return { x, h, y: H - h };
  });
  return { pricePath, bars };
}

export default function InstrumentChart({ card }: { card: InstrumentCard }) {
  const primary = card.series[0];
  const secondary = card.series[1];

  if (card.chart === 'print') {
    return (
      <div className="instrument-print">
        {card.series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <div key={s.label} className="instrument-print-row">
              <span>{s.label}</span>
              <b>{last ? last.value.toLocaleString('en-AU') : '—'}</b>
            </div>
          );
        })}
      </div>
    );
  }

  if (card.chart === 'stacked' && primary && secondary) {
    const area = stacked(primary.points, secondary.points);
    return (
      <svg className="instrument-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={card.title}>
        {area && <path d={area} fill="var(--verify)" opacity={0.35} />}
        {path(primary.points) && (
          <path d={path(primary.points)!.d} fill="none" stroke="var(--verify)" strokeWidth={1.4} />
        )}
      </svg>
    );
  }

  if (card.chart === 'spread' && primary) {
    const p = zeroPath(primary.points);
    if (!p) return null;
    return (
      <svg className="instrument-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={card.title}>
        <line x1={PAD} x2={W - PAD} y1={p.zeroY} y2={p.zeroY} stroke="var(--rule)" strokeWidth={1} />
        <path d={p.d} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
        <circle cx={p.last.x} cy={p.last.y} r={2.4} fill="var(--ink)" />
      </svg>
    );
  }

  if (card.chart === 'tape' && primary && card.volume) {
    const t = tape(primary.points, card.volume.points);
    return (
      <svg className="instrument-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={card.title}>
        {t.pricePath && (
          <>
            <path d={t.pricePath.d} fill="none" stroke="var(--ink)" strokeWidth={1.4} />
            <circle cx={t.pricePath.last.x} cy={t.pricePath.last.y} r={2.2} fill="var(--ink)" />
          </>
        )}
        {t.bars.map((b, i) => (
          <rect key={i} x={b.x - 1.5} y={b.y} width={3} height={b.h} fill="var(--ink-faint)" />
        ))}
      </svg>
    );
  }

  const p1 = primary ? path(primary.points) : null;
  const p2 = secondary ? path(secondary.points) : null;
  return (
    <svg className="instrument-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={card.title}>
      {p1 && <path d={p1.d} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
      {p2 && <path d={p2.d} fill="none" stroke="var(--verify)" strokeWidth={1.3} />}
      {p1 && <circle cx={p1.last.x} cy={p1.last.y} r={2.3} fill="var(--ink)" />}
    </svg>
  );
}
