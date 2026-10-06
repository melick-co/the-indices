import Link from 'next/link';
import { PlayMark } from '@/components/visuals/RacePlayer';
import { VisualChart } from '@/components/visuals/VisualChart';
import { IX } from '@/lib/indices-paths';
import type { Visual } from '@/lib/visuals';

const day = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });

/** A visual laid out as a poster: brand, title, the graphic, key takeaways and sources. */
export function VisualPoster({ v, compact = false }: { v: Visual; compact?: boolean }) {
  return (
    <article className={`vz-poster${compact ? ' compact' : ''}`}>
      <header className="vz-head">
        <span className="vz-brand"><span className="ix-mark" aria-hidden="true"><i /><i /><i /></span>The Indices</span>
        <h1 className="vz-title">{v.title}</h1>
        {v.subtitle && <p className="vz-sub">{v.subtitle}</p>}
      </header>
      <div className="vz-chart" role="figure" aria-label={v.alt ?? v.title}><VisualChart spec={v.spec} /></div>
      {!compact && (
        <>
          <section className="vz-takeaways">
            <h2>Key takeaways</h2>
            <ul>{v.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </section>
          <footer className="vz-foot">
            <span>Source: {v.sources.map((s, i) => <span key={i}>{i ? '; ' : ''}{s.url ? <a href={s.url} rel="noopener">{s.org}, {s.dataset}</a> : `${s.org}, ${s.dataset}`}</span>)}. {v.spec.period}.</span>
            <span>Published {day(v.published_at)} · Every number checked against the source data</span>
          </footer>
        </>
      )}
    </article>
  );
}

const KIND: Record<Visual['template'], string> = { ranked: 'Ranking', treemap: 'Breakdown', change: 'Change', race: 'Video' };

/** A gallery card: a fixed-height thumbnail (a video frame for races), the title, a one-line teaser, kind and date. */
export function VisualCard({ v }: { v: Visual }) {
  const poster = v.videos?.poster;
  const video = v.videos?.['1:1'] ?? v.videos?.['16:9'];
  return (
    <Link href={`${IX.visuals}/${v.slug}`} className="vz-card">
      <span className="vz-thumb">
        {v.template === 'race' && (poster || video) ? (
          <>
            {poster
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={poster} alt="" />
              // Races rendered before posters: #t= shows a frame mid-race as the still; nothing plays in the gallery.
              : <video src={`${video}${video!.includes('#') ? '' : '#t=20'}`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />}
            <PlayMark />
          </>
        ) : (
          <span className="vz-thumb-chart"><VisualChart spec={v.spec} thumb /></span>
        )}
      </span>
      <span className="vz-card-body">
        <span className="vz-card-kind">{KIND[v.template]}</span>
        <span className="vz-card-title">{v.title}</span>
        {v.takeaways[0] && <span className="vz-card-teaser">{v.takeaways[0]}</span>}
        <span className="vz-card-meta">{day(v.published_at)}</span>
      </span>
    </Link>
  );
}
