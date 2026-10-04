import Link from 'next/link';
import { loadEconomyDashboard } from '@/lib/economy-dashboard';
import { Change, Sparkline, StatusBadge, Value } from '@/components/dashboard/DashParts';
import { periodLabel } from '@/lib/economy-dashboard';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Economy dashboard — Caveat',
  description: 'The health of the Australian economy on one page: growth, jobs, prices, rates, housing, population and public finances.',
};

export default async function EconomyDashboard() {
  const sections = await loadEconomyDashboard();
  const good = sections.filter((s) => ['on-target', 'better'].includes(s.headline.status)).length;

  return (
    <main className="article econ-dash">
      <p className="desk-kicker">Australia · economy dashboard</p>
      <h1 className="section-head econ-dash-title">How is the economy doing?</h1>
      <p className="measure econ-dash-intro">
        Seven sections, each led by the number economists watch, with the indicators that explain it alongside.
        Every reading is official data, judged against its target where there is one and otherwise against its own
        ten-year average. {good} of {sections.length} headline readings are on target or better than usual.
        Open any section or number for what it means and how Australia compares.
      </p>

      <div className="econ-grid">
        {sections.map(({ section, headline, others }) => (
          <section key={section.id} className="econ-card">
            <Link href={`/indices/${section.id}`} className="econ-card-head">
              <h2>{section.title}</h2>
              <span className="econ-card-q">{section.question}</span>
            </Link>

            <Link href={`/indices/${section.id}/${headline.key}`} className="econ-headline">
              <span className="econ-headline-label">{headline.indicator.short ?? headline.indicator.label}</span>
              <span className="econ-headline-row">
                <Value reading={headline} big />
                <Sparkline points={headline.history.slice(-24)} step={headline.indicator.step} width={140} height={40} />
              </span>
              <span className="econ-headline-meta">
                <StatusBadge reading={headline} />
                <Change reading={headline} />
                {headline.latest && <span className="econ-period">{periodLabel(headline.latest.period)}</span>}
              </span>
            </Link>

            <ul className="econ-tiles">
              {others.map((r) => (
                <li key={r.key}>
                  <Link href={`/indices/${section.id}/${r.key}`} className="econ-tile">
                    <span className="econ-tile-label">{r.indicator.short ?? r.indicator.label}</span>
                    <Value reading={r} />
                    <span className={`econ-dot ${r.status}`} title={r.verdict} />
                    <Change reading={r} />
                  </Link>
                </li>
              ))}
              {(section.composites ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/indices/${c.id}`} className="econ-tile composite">
                    <span className="econ-tile-label">{c.label}</span>
                    <span className="econ-composite-tag">Caveat composite →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="ops-quiet-note econ-legend">
        <span className="econ-dot better" /> on target or better than usual
        <span className="econ-dot worse" /> outside target or worse than usual
        <span className="econ-dot neutral" /> neither better nor worse (a level, not a goal)
        · Quality of life and public mood dashboards are coming next.
      </p>
    </main>
  );
}
