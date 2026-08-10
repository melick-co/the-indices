import Link from 'next/link';
import { notFound } from 'next/navigation';
import Masthead from '@/components/Masthead';
import SiteFooter from '@/components/SiteFooter';
import { ALL_INDICES, indexById } from '@/content/indices/registry';

export const dynamicParams = false;
export function generateStaticParams() {
  return ALL_INDICES.map((p) => ({ id: p.index.id }));
}
export function generateMetadata({ params }: { params: { id: string } }) {
  const p = indexById(params.id);
  return p ? { title: `${p.index.name} — Caveat`, description: p.index.concept } : {};
}

const TIER: Record<number, string> = { 1: 't1', 2: 't2', 3: 't3' };
const fmt = (n: number | null, d = 1) => (n == null ? '—' : n.toFixed(d));

export default function IndexPage({ params }: { params: { id: string } }) {
  const p = indexById(params.id);
  if (!p) notFound();

  const scored = p.results.filter((r) => r.scored).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const unscored = p.results.filter((r) => !r.scored);
  const aus = p.results.find((r) => r.entity === 'AUS');
  const max = scored[0]?.score ?? 100;
  const sens = p.sensitivity;
  const cite = `Caveat (${new Date(p.generated_at).getFullYear()}). ${p.index.name} (${p.index.id.toUpperCase()}), vintage ${p.index.vintage}. Retrieved from caveat.news/indices/${p.index.id}`;

  return (
    <>
      <Masthead />
      <main className="wrap article">
        <div className="card-kicker">Index · vintage {p.index.vintage}</div>
        <h1>{p.index.name}</h1>
        <p className="measure">{p.index.concept}. Scale {p.index.scale}; a higher score
          means greater pressure. Built to the {p.methodology.standard}.</p>
        <div className="byline">
          {scored.length} scored · {unscored.length} insufficient coverage ·
          {' '}{p.methodology.components.length} components · {p.methodology.weighting} weights
        </div>

        {aus?.score != null && (
          <div className="pull" style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
            <span style={{ fontSize: '3rem', fontFamily: 'Fraunces, Georgia, serif' }}>
              <span className="mark on">{aus.score}</span>
            </span>
            <span>Australia, on 100 % coverage. Rank {scored.findIndex((r) => r.entity === 'AUS') + 1} of {scored.length}.</span>
          </div>
        )}

        <h2>Scores</h2>
        <table className="data">
          <thead>
            <tr><th>#</th><th>Country</th><th className="num">Score</th>
              <th></th><th className="num">Coverage</th></tr>
          </thead>
          <tbody>
            {scored.map((r, i) => (
              <tr key={r.entity} style={r.entity === 'AUS'
                ? { background: 'var(--paper-deep)', fontWeight: 600 } : undefined}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td className="num">{fmt(r.score)}</td>
                <td style={{ width: '30%' }}>
                  <span style={{ display: 'block', height: 8,
                    width: `${((r.score ?? 0) / max) * 100}%`,
                    background: r.entity === 'AUS' ? 'var(--pen)' : 'var(--ink)' }} />
                </td>
                <td className="num">{r.coverage}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="caveat-box">
          <h3>Not scored — and not estimated</h3>
          <p style={{ fontSize: '.92rem', marginBottom: '.6rem' }}>
            {unscored.length} countries lack enough observed data to score. Under the standard
            they are reported, never imputed or quietly dropped:
          </p>
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem', marginBottom: 0 }}>
            {unscored.map((r) => `${r.name} (${r.coverage}%)`).join(' · ')}
          </p>
        </div>

        <h2>How it is built</h2>
        <p>
          Each component is normalised to 0–100 against fixed bounds set at creation,
          then combined with {p.methodology.weighting} weights. Bounds do not move with
          the sample, so a change in score over time is a real change rather than a
          shift in the peer group.
        </p>
        <table className="data">
          <thead>
            <tr><th>Component</th><th>Bounds</th><th className="num">Weight</th></tr>
          </thead>
          <tbody>
            {p.methodology.components.map((c) => (
              <tr key={c.metric_id}>
                <td>{c.label}</td>
                <td>{c.bounds[0]} to {c.bounds[1]}</td>
                <td className="num">{(c.weight / p.methodology.components
                  .reduce((s, x) => s + x.weight, 0)).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {aus && (
          <>
            <h2>Worked example: Australia</h2>
            <table className="data">
              <thead>
                <tr><th>Component</th><th className="num">Raw</th>
                  <th className="num">Normalised</th><th className="num">Weight</th><th>Status</th></tr>
              </thead>
              <tbody>
                {aus.components.map((c) => (
                  <tr key={c.metric_id}>
                    <td>{c.label}</td>
                    <td className="num">{c.raw ?? '—'}</td>
                    <td className="num">{fmt(c.normalised)}</td>
                    <td className="num">{c.weight.toFixed(3)}</td>
                    <td>{c.status}{c.winsorised ? ' · winsorised' : ''}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}><b>Score</b></td>
                  <td className="num"><b>{fmt(aus.score)}</b></td>
                  <td className="num">1.000</td><td>{aus.coverage}% coverage</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <h2>Sensitivity</h2>
        <p className="measure">
          Does the ranking depend on our choices? We re-run the index with each
          component&rsquo;s weight moved 25 % either way, and with each component removed
          in turn, and publish what happens.
        </p>
        <table className="data">
          <thead><tr><th>Test</th><th>Result</th><th>Reading</th></tr></thead>
          <tbody>
            <tr>
              <td>Weight perturbation, rank correlation</td>
              <td className="num">{sens.weightPerturbation.rankCorrelation.toFixed(3)}</td>
              <td>Strong. The order barely moves.</td>
            </tr>
            <tr>
              <td>Weight perturbation, max score change</td>
              <td className="num">{sens.weightPerturbation.maxScoreChange.toFixed(2)}</td>
              <td>Marginal against our 3.00 threshold.</td>
            </tr>
            <tr>
              <td>Weight perturbation, max rank change</td>
              <td className="num">{sens.weightPerturbation.maxRankChange}</td>
              <td>Overstated: scores cluster, so small moves shuffle ranks.</td>
            </tr>
            <tr>
              <td>Highest pairwise correlation</td>
              <td className="num">
                {Math.max(...sens.pairwiseCorrelation.map((c) => Math.abs(c.r))).toFixed(3)}
              </td>
              <td>Well under 0.90. Components measure different things.</td>
            </tr>
          </tbody>
        </table>

        <div className="caveat-box">
          <h3>Caveat</h3>
          <ul style={{ fontSize: '.92rem' }}>
            <li>
              This vintage does <b>not</b> fully pass our own acceptance battery. Rank
              correlation is strong at {sens.weightPerturbation.rankCorrelation.toFixed(3)},
              but maximum score change is {sens.weightPerturbation.maxScoreChange.toFixed(2)}
              {' '}against a 3.00 threshold. We publish it flagged rather than quietly
              loosening the threshold.
            </li>
            <li>
              Max rank change of {sens.weightPerturbation.maxRankChange} looks alarming but is
              an artefact: scores cluster tightly (Australia and Norway tie at 66.2), so a
              fraction of a point moves several places. The standard&rsquo;s use of rank change
              as an acceptance test is under revision.
            </li>
            <li>
              Years-to-buy-a-home is tier 3 and mixed basis: home prices in market USD from a
              crowd-sourced source, income in PPP USD. Treat that component as directional.
              It will be rebuilt on an official house price index.
            </li>
            <li>
              Household debt is published for only 20 countries, so coverage is thinner than
              the other components and several countries fall below the scoring threshold.
            </li>
          </ul>
        </div>

        <h2>Sources</h2>
        <table className="data">
          <thead><tr><th>Component</th><th>Publisher</th><th>Tier</th><th>Period</th><th>Basis</th></tr></thead>
          <tbody>
            {p.sources.filter((s) => p.methodology.components
              .some((c) => c.metric_id === s.metric_id)).map((s) => (
              <tr key={s.metric_id}>
                <td><a href={s.source.url} target="_blank" rel="noreferrer"
                  style={{ borderBottom: '1px solid var(--rule)' }}>{s.definition} ↗</a></td>
                <td>{s.source.org}</td>
                <td><span className={`tier ${TIER[s.source.tier]}`}>Tier {s.source.tier}</span></td>
                <td>{s.source.period}</td>
                <td style={{ fontSize: '.72rem' }}>{s.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Download and cite</h2>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.8rem' }}>
          <a href={`/data/${p.index.id}-${p.index.vintage}.json`} download
            style={{ borderBottom: '1px solid var(--pen)' }}>JSON (full payload)</a>
          {'  ·  '}
          <a href={`/data/${p.index.id}-${p.index.vintage}.csv`} download
            style={{ borderBottom: '1px solid var(--pen)' }}>CSV (scores)</a>
        </p>
        <p style={{ background: 'var(--paper-deep)', padding: '.9rem',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '.76rem', maxWidth: '100%' }}>
          {cite}
        </p>

        <h2>Vintage and revisions</h2>
        <p className="measure">
          This is vintage {p.index.vintage}, generated {new Date(p.generated_at)
            .toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.
          Published vintages are immutable. When a statistical agency restates a figure we
          use, the revision appears in the next vintage with a changelog entry, not
          retrospectively here. If a restatement moves any score by more than 2.0 points we
          say so in the release note.
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
