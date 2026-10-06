import type { VisualSpec } from '@/lib/visuals-data';
import { formatReading } from '@/lib/economy-dashboard';

/** Values as the chart labels them (compact; the takeaways carry the full figures). */
export function chartValue(v: number, unit: VisualSpec['unit']): string {
  if (unit === 'persons') return v >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : v >= 1e4 ? `${Math.round(v / 1e3).toLocaleString('en-AU')}k` : Math.round(v).toLocaleString('en-AU');
  if (unit === 'aud_m') return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}tn` : `$${(v / 1e3).toFixed(1)}bn`;
  if (unit === 'per_100k') return `${Math.round(v * 10) / 10}`;
  if (unit === 'points') return `${Math.round(v)}`;
  return formatReading(v, unit as never);
}

const PALETTE = ['#1d2a48', '#2e4170', '#4f8fd1', '#8db8e8', '#2f9e44', '#f07f1e', '#c2372d', '#8a5cc2', '#d9a21b', '#5b6b85', '#14837b', '#b04a7a', '#c3cad6'];

/** Thumbnails show the top rows only (plus the highlighted row if it falls below them), so their labels can be read. */
function thumbRows(s: VisualSpec, n = 8): VisualSpec {
  const top = s.rows.slice(0, n);
  const hl = s.rows.findIndex((r) => r.highlight);
  return { ...s, rows: hl >= n ? [...top.slice(0, n - 1), s.rows[hl]] : top };
}

function RankedBars({ s: full, thumb = false }: { s: VisualSpec; thumb?: boolean }) {
  const s = thumb ? thumbRows(full) : full;
  // Ranks are positions in the full list, even when a thumbnail skips rows.
  const place = (code: string) => full.rows.findIndex((r) => r.code === code) + 1;
  const W = 760, rowH = thumb ? 30 : 19, padL = 150, padR = 70, top = 8;
  // A line of its own below the bars for the median label, so it never sits on the last row.
  const H = top + s.rows.length * rowH + (s.median != null ? 26 : 8);
  const max = Math.max(...s.rows.map((r) => r.value), s.median ?? 0);
  const min = Math.min(0, ...s.rows.map((r) => r.value));
  const x = (v: number) => padL + ((v - min) / (max - min || 1)) * (W - padL - padR);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vz-svg" role="img" aria-label={`${s.measure}, ${s.period}`}>
      {s.median != null && (
        <g className="vz-median">
          <line x1={x(s.median)} x2={x(s.median)} y1={top - 4} y2={H - 20} />
          <text x={x(s.median)} y={H - 6} textAnchor="middle">OECD median {chartValue(s.median, s.unit)}</text>
        </g>
      )}
      {s.rows.map((r, i) => {
        const y = top + i * rowH;
        return (
          <g key={r.code} className={r.highlight ? 'vz-row hl' : 'vz-row'}>
            <text x={padL - 8} y={y + rowH / 2 + 4} textAnchor="end" className="vz-label">{place(r.code)}. {r.label}</text>
            <rect x={x(Math.min(0, r.value))} y={y + 3} width={Math.max(1, Math.abs(x(r.value) - x(0)))} height={rowH - 6} rx={2} />
            <text x={x(r.value) + 5} y={y + rowH / 2 + 4} className="vz-value">{chartValue(r.value, s.unit)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Squarified treemap (Bruls, Huizing and van Wijk): tiles close to square, largest first. */
function squarify(values: number[], x: number, y: number, w: number, h: number) {
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const area = values.map((v) => (v / total) * w * h);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let i = 0;
  let box = { x, y, w, h };
  while (i < area.length) {
    const side = Math.min(box.w, box.h);
    const row: number[] = [area[i]];
    const worst = (r: number[]) => { const s = r.reduce((a, b) => a + b, 0); return Math.max(...r.map((a) => Math.max((side * side * a) / (s * s), (s * s) / (side * side * a)))); };
    let j = i + 1;
    while (j < area.length && worst([...row, area[j]]) <= worst(row)) { row.push(area[j]); j++; }
    const sum = row.reduce((a, b) => a + b, 0);
    const thick = sum / side;
    let off = 0;
    for (const a of row) {
      const len = a / thick;
      out.push(box.w >= box.h ? { x: box.x, y: box.y + off, w: thick, h: len } : { x: box.x + off, y: box.y, w: len, h: thick });
      off += len;
    }
    box = box.w >= box.h ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    i = j;
  }
  return out;
}

function Treemap({ s }: { s: VisualSpec }) {
  const W = 760, H = 460;
  // Largest first, with the remainder ('All others') always last, so the named parts lead.
  const rows = [...s.rows].sort((a, b) => (a.code === 'OTHER' ? 1 : b.code === 'OTHER' ? -1 : b.value - a.value));
  const total = s.total ?? rows.reduce((t, r) => t + r.value, 0);
  // The remainder gets its own column on the right, sized to its share; the named parts fill the rest.
  const other = rows.find((r) => r.code === 'OTHER');
  const otherW = other ? (other.value / total) * W : 0;
  const named = rows.filter((r) => r.code !== 'OTHER');
  const tiles = [...squarify(named.map((r) => r.value), 0, 0, W - otherW, H), ...(other ? [{ x: W - otherW, y: 0, w: otherW, h: H }] : [])];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vz-svg" role="img" aria-label={`${s.measure}, ${s.period}`}>
      {rows.map((r, i) => {
        const t = tiles[i];
        const big = t.w > 90 && t.h > 46, mid = t.w > 54 && t.h > 30;
        const fill = r.code === 'OTHER' ? '#c3cad6' : PALETTE[i % (PALETTE.length - 1)];
        const dark = ['#8db8e8', '#c3cad6', '#d9a21b'].includes(fill);
        return (
          <g key={r.code} className="vz-tile">
            <title>{`${r.label}: ${chartValue(r.value, s.unit)} (${((r.value / total) * 100).toFixed(1)}%)`}</title>
            <rect x={t.x + 1} y={t.y + 1} width={Math.max(0, t.w - 2)} height={Math.max(0, t.h - 2)} fill={fill} rx={3} />
            {mid && (
              <text x={t.x + 8} y={t.y + 18} className={`vz-tile-label${dark ? ' dark' : ''}`}>
                <tspan className="vz-tile-share">{((r.value / total) * 100).toFixed(1)}%</tspan>
                {big && <tspan x={t.x + 8} dy={17}>{r.label.length > t.w / 7 ? `${r.label.slice(0, Math.floor(t.w / 7) - 1)}…` : r.label}</tspan>}
                {big && t.h > 64 && <tspan x={t.x + 8} dy={15} className="vz-tile-value">{chartValue(r.value, s.unit)}</tspan>}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ChangeBars({ s, thumb = false }: { s: VisualSpec; thumb?: boolean }) {
  const rows = s.rows.filter((r) => r.prior != null && r.prior > 0).sort((a, b) => b.value / b.prior! - a.value / a.prior!).slice(0, thumb ? 8 : undefined);
  const W = 760, rowH = 26, padL = 150, padR = 90, top = 22;
  const H = top + rows.length * rowH + 10;
  const max = Math.max(...rows.flatMap((r) => [r.value, r.prior!]));
  const x = (v: number) => padL + (v / max) * (W - padL - padR);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vz-svg" role="img" aria-label={`${s.measure}: ${s.priorPeriod} to ${s.period}`}>
      <g className="vz-legend"><circle cx={padL} cy={9} r={5} className="prior" /><text x={padL + 9} y={13}>{s.priorPeriod}</text><circle cx={padL + 200} cy={9} r={5} className="now" /><text x={padL + 209} y={13}>{s.period}</text></g>
      {rows.map((r, i) => {
        const y = top + i * rowH + rowH / 2;
        const up = r.value >= r.prior!;
        const chg = (r.value / r.prior! - 1) * 100;
        return (
          <g key={r.code} className={`vz-dumb ${up ? 'up' : 'down'}`}>
            <text x={padL - 8} y={y + 4} textAnchor="end" className="vz-label">{r.label}</text>
            <line x1={x(r.prior!)} x2={x(r.value)} y1={y} y2={y} />
            <circle cx={x(r.prior!)} cy={y} r={5} className="prior" />
            <circle cx={x(r.value)} cy={y} r={6} className="now" />
            <text x={Math.max(x(r.value), x(r.prior!)) + 10} y={y + 4} className="vz-value">{chg >= 0 ? '+' : '−'}{Math.abs(chg).toFixed(Math.abs(chg) < 10 ? 1 : 0)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

export function VisualChart({ spec, thumb = false }: { spec: VisualSpec; thumb?: boolean }) {
  // A race's page shows its final standings as ranked bars; the videos carry the motion.
  if (spec.template === 'ranked' || spec.template === 'race') return <RankedBars s={spec} thumb={thumb} />;
  if (spec.template === 'treemap') return <Treemap s={spec} />;
  return <ChangeBars s={spec} thumb={thumb} />;
}
