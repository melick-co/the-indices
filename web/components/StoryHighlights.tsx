import type { StoryBlock, StoryHighlights as Highlights } from '@/lib/story-types';
import { chartsOf } from '@/lib/story-highlights';

/** Year (or year and quarter) from a series label, for the sparkline's ends. */
const when = (label: string) => label.match(/^(\d{4})(?:-Q(\d))?/)?.slice(1).filter(Boolean).join(' Q') ?? label;

function Spark({ values, labels, direction }: { values: number[]; labels: string[]; direction?: string }) {
  const W = 240, H = 64, pad = 4;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <div className="hl-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${line} L${x(last)},${H} L${x(0)},${H} Z`} className="hl-area" />
        <path d={line} className="hl-line" vectorEffect="non-scaling-stroke" />
        <circle cx={x(last)} cy={y(values[last])} r="4" className={`hl-dot ${direction ?? ''}`} />
      </svg>
      <div className="hl-spark-ends"><span>{when(labels[0])}</span><span>{when(labels[last])}</span></div>
    </div>
  );
}

const ARROW: Record<string, string> = { up: '▲', down: '▼', flat: '▶' };

/**
 * The story in three numbers, at the top of the story and as the home lead's graphic. Figures are the story's own
 * (checked when made, lib/story-highlights.ts); the sparklines are its own chart series.
 */
export default function StoryHighlights({ highlights, blocks, sources }: { highlights: Highlights; blocks: StoryBlock[]; sources?: string[] }) {
  const charts = chartsOf(blocks);
  return (
    <figure className="hl" aria-label="The story in numbers">
      <div className="hl-head">
        <span className="ix-mark" aria-hidden="true"><i /><i /><i /></span>
        The story in {highlights.items.length === 3 ? 'three' : highlights.items.length === 2 ? 'two' : 'four'} numbers
      </div>
      <div className="hl-grid" style={{ ['--hl-n' as string]: highlights.items.length }}>
        {highlights.items.map((h, i) => {
          const c = h.chart != null ? charts[h.chart] : undefined;
          return (
            <div key={i} className="hl-item">
              <div className="hl-fig">
                {h.figure}
                {h.direction && <span className={`hl-arrow ${h.direction}`} aria-label={h.direction}>{ARROW[h.direction]}</span>}
              </div>
              <div className="hl-label">{h.label}</div>
              {c && <Spark values={c.series.map((p) => p.value)} labels={c.series.map((p) => p.label)} direction={h.direction} />}
              {h.note && <div className="hl-note">{h.note}</div>}
            </div>
          );
        })}
      </div>
      {sources?.length ? <figcaption className="hl-src">Source: {sources.join(', ')}. Every figure is in the story below.</figcaption> : null}
    </figure>
  );
}
