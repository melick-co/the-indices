import type { StoryBlock, StoryHighlights as Highlights } from '@/lib/story-types';
import { chartFits, chartsOf } from '@/lib/story-highlights';

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

const SHORT: Record<string, string> = { 'united states': 'us', 'united kingdom': 'uk', 'new zealand': 'nz' };
/** Whether a highlight is about this row: its name (or the usual short form) appears in the highlight's words. */
function about(text: string, label: string) {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ')} `;
  const l = label.toLowerCase();
  return t.includes(` ${l} `) || (SHORT[l] != null && t.includes(` ${SHORT[l]} `));
}

/**
 * A ranking chart (countries, groups) as five bars, largest first. The row the highlight is about is in ink (the
 * chart's own highlight may be a different country, so it isn't used); if none matches, no row is singled out.
 */
function MiniBars({ series, subject }: { series: { label: string; value: number }[]; subject: string }) {
  const rows = [...series].sort((a, b) => b.value - a.value).map((r) => ({ ...r, highlight: about(subject, r.label) }));
  const hl = rows.findIndex((r) => r.highlight);
  const top = rows.slice(0, 5);
  if (hl >= 5) top[4] = rows[hl];
  const max = Math.max(...top.map((r) => Math.abs(r.value))) || 1;
  return (
    <div className="hl-bars">
      {top.map((r) => (
        <div key={r.label} className={`hl-bar${r.highlight ? ' is-hl' : ''}`}>
          <span className="hl-bar-label">{r.label}</span>
          <span className="hl-bar-track"><span style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

/** A series over time draws as a sparkline; a ranking (bars, rank swap) as bars. */
function MiniChart({ chart, direction, subject }: { chart: ReturnType<typeof chartsOf>[number]; direction?: string; subject: string }) {
  if (chart.kind === 'bars' || chart.kind === 'rank_swap') return <MiniBars series={chart.series} subject={subject} />;
  return <Spark values={chart.series.map((p) => p.value)} labels={chart.series.map((p) => p.label)} direction={direction} />;
}

/**
 * The story in three numbers, at the top of the story and as the home lead's graphic. Figures are the story's own
 * (checked when made, lib/story-highlights.ts); the sparklines are its own chart series.
 */
export default function StoryHighlights({ highlights, blocks, sources }: { highlights: Highlights; blocks: StoryBlock[]; sources?: string[] }) {
  const charts = chartsOf(blocks);
  // Three at most: a fourth crowds the columns (older highlights may have four).
  highlights = { ...highlights, items: highlights.items.slice(0, 3) };
  return (
    <figure className="hl" aria-label="The story in numbers">
      <div className="hl-head">
        <span className="ix-mark" aria-hidden="true"><i /><i /><i /></span>
        The story in {highlights.items.length === 3 ? 'three' : highlights.items.length === 2 ? 'two' : 'four'} numbers
      </div>
      <div className="hl-grid" style={{ ['--hl-n' as string]: highlights.items.length }}>
        {highlights.items.map((h, i) => {
          const c = h.chart != null && charts[h.chart] && chartFits(h, charts[h.chart]) ? charts[h.chart] : undefined;
          return (
            <div key={i} className="hl-item">
              <div className="hl-fig">
                {h.figure}
                {h.direction && <span className={`hl-arrow ${h.direction}`} aria-label={h.direction}>{ARROW[h.direction]}</span>}
              </div>
              <div className="hl-label">{h.label}</div>
              {c && <MiniChart chart={c} direction={h.direction} subject={`${h.label} ${h.note ?? ''}`} />}
              {h.note && <div className="hl-note">{h.note}</div>}
            </div>
          );
        })}
      </div>
      {sources?.length ? <figcaption className="hl-src">Source: {sources.join(', ')}. Every figure is in the story below.</figcaption> : null}
    </figure>
  );
}

/**
 * A story card's picture on the home page: its key highlight drawn large (figure, what it is, and its sparkline),
 * so the card explains the topic at a glance. Uses the first highlight that has a chart, else the first.
 */
export function HighlightThumb({ highlights, blocks }: { highlights: Highlights; blocks: StoryBlock[] }) {
  const charts = chartsOf(blocks);
  const fits = (i: typeof highlights.items[number]) => i.chart != null && charts[i.chart] != null && chartFits(i, charts[i.chart]);
  const h = highlights.items.find(fits) ?? highlights.items[0];
  if (!h) return null;
  const c = fits(h) ? charts[h.chart!] : undefined;
  return (
    <div className="hl-thumb" aria-hidden="true">
      <div className="hl-thumb-fig">
        {h.figure}
        {h.direction && <span className={`hl-arrow ${h.direction}`}>{ARROW[h.direction]}</span>}
      </div>
      <div className="hl-thumb-label">{h.label}</div>
      {c ? <MiniChart chart={c} direction={h.direction} subject={`${h.label} ${h.note ?? ''}`} /> : h.note ? <div className="hl-thumb-note">{h.note}</div> : null}
    </div>
  );
}
