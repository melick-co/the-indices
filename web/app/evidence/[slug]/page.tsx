import Link from 'next/link';
import { notFound } from 'next/navigation';
import Masthead from '@/components/Masthead';
import SiteFooter from '@/components/SiteFooter';
import { STORIES, bySlug } from '@/content/stories';

export const dynamicParams = false;
export function generateStaticParams() {
  return STORIES.map((s) => ({ slug: s.slug }));
}
export function generateMetadata({ params }: { params: { slug: string } }) {
  const s = bySlug(params.slug);
  return s ? { title: `Evidence — ${s.title}` } : {};
}

const TIER_CLASS: Record<number, string> = { 1: 't1', 2: 't2', 3: 't3' };

export default function Evidence({ params }: { params: { slug: string } }) {
  const s = bySlug(params.slug);
  if (!s) notFound();

  return (
    <>
      <Masthead />
      <main className="wrap article">
        <div className="card-kicker">Evidence</div>
        <h1 style={{ fontSize: '1.9rem' }}>{s.title}</h1>
        <div className="byline">
          <Link href={`/stories/${s.slug}`} style={{ borderBottom: '1px solid var(--pen)' }}>
            ← Back to the story
          </Link>
        </div>

        <p className="measure">
          Everything this story rests on. If a figure is not here, we did not publish it.
        </p>

        <h2>The one number</h2>
        <p style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: '2rem', marginBottom: '.2rem' }}>
          <span className="mark on">{s.oneNumber.value}</span>
        </p>
        <p style={{ color: 'var(--ink-soft)', fontSize: '.95rem' }}>{s.oneNumber.label}</p>

        {s.evidence.table && (
          <>
            <h2>The data</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>{s.evidence.table.head.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {s.evidence.table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className={j > 0 ? 'num' : undefined}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h2>Sources</h2>
        <table className="data">
          <thead>
            <tr><th>Series</th><th>Publisher</th><th>Tier</th><th>Period</th><th>Basis</th></tr>
          </thead>
          <tbody>
            {s.evidence.sources.map((src, i) => (
              <tr key={i}>
                <td>
                  <a href={src.url} target="_blank" rel="noreferrer"
                    style={{ borderBottom: '1px solid var(--rule)' }}>{src.metric} ↗</a>
                </td>
                <td>{src.org}</td>
                <td><span className={`tier ${TIER_CLASS[src.tier]}`}>Tier {src.tier}</span></td>
                <td>{src.period}</td>
                <td style={{ fontSize: '.72rem', lineHeight: 1.5 }}>{src.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="caveat-box">
          <h3>Caveat</h3>
          <p style={{ marginBottom: 0, fontSize: '.95rem' }}>{s.caveat}</p>
        </div>

        <h2>How to check this yourself</h2>
        <p>
          Follow the source links above. Each goes to the published series, not to our
          copy of it. Where we computed a figure rather than quoting one, the
          calculation is stated in the basis column. If you find an error, it gets a
          correction on the story.
        </p>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem' }}>
          <Link href="/methodology" style={{ borderBottom: '1px solid var(--pen)' }}>
            How Caveat works →
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
