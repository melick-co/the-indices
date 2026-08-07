import Masthead from '@/components/Masthead';
import SiteFooter from '@/components/SiteFooter';

export const metadata = { title: 'Method — Caveat' };

export default function Methodology() {
  return (
    <>
      <Masthead />
      <main className="wrap article">
        <h1>How Caveat works</h1>
        <div className="byline">Published in full · Version 1.0</div>

        <p className="measure">
          Caveat reads the same data as everyone else. The difference is what we do
          before publishing: check the denominator, check the basis, and print the
          objection a hostile reader would raise rather than burying it.
        </p>

        <h2>Every figure carries its source</h2>
        <p>
          Each number we publish exists as a row with its definition, unit, basis,
          publication date and a link to the series it came from. Every story has an
          evidence page listing those rows. If you cannot check a claim in about a
          minute, it does not run.
        </p>

        <h2>Sources are tiered</h2>
        <table className="data">
          <thead>
            <tr><th>Tier</th><th>What</th><th>Use</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="tier t1">Tier 1</span></td>
              <td>Official statistical agencies: OECD, World Bank, IMF, Eurostat, ABS, RBA</td>
              <td>Carries headlines</td>
            </tr>
            <tr>
              <td><span className="tier t2">Tier 2</span></td>
              <td>Sector bodies, exchanges, central bank tables</td>
              <td>Acceptable where no tier 1 series exists</td>
            </tr>
            <tr>
              <td><span className="tier t3">Tier 3</span></td>
              <td>Commercial and crowd-sourced aggregators</td>
              <td>Context only. Never carries a headline</td>
            </tr>
          </tbody>
        </table>

        <h2>Nothing is estimated into existence</h2>
        <p>
          Missing values are never modelled, imputed or carried forward. Where a country
          lacks the data, it is reported as insufficient coverage rather than filled in.
          Figures we compute ourselves are marked derived, and the calculation is shown.
        </p>

        <h2>Indices are built to a published standard</h2>
        <p>
          Composite indices use fixed bounds set at creation, so a change in score over
          time means something rather than merely reflecting a change in the peer group.
          Equal weights are the default. Every index publishes its components, weights,
          coverage and a sensitivity test showing the ranking does not depend on our
          choices.
        </p>

        <h2>Published figures do not change quietly</h2>
        <p>
          Statistical agencies restate prior periods routinely. When that happens the
          revision lands in the next vintage with a changelog, not retrospectively into
          something already published. If a restatement moves a score materially, we say so.
        </p>

        <h2>We correct ourselves in public</h2>
        <p>
          A finding that contradicts something we published earlier is a story, not a
          threat. Corrections appear on the story they correct.
        </p>

        <p className="signoff">Caveat lector. Just saying.</p>
      </main>
      <SiteFooter />
    </>
  );
}
