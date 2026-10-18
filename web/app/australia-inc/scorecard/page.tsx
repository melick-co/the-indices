import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import { OutcomeList, PromiseList, ScorecardMethodology, TermToggle } from '@/components/AustraliaInc';
import { loadScorecard } from '@/lib/scorecard-loader';
import { TERMS, termOf } from '@/lib/scorecard';

export const revalidate = 900;

export const metadata = {
  title: 'The scorecard, Australia Inc. — The Caveat',
  description: 'The federal government\'s measurable promises, rated mechanically on pace, and the headline outcomes since the election, from official data.',
};

export default async function ScorecardPage({ searchParams }: { searchParams: { since?: string | string[] } }) {
  const term = termOf(searchParams?.since);
  const d = await loadScorecard(term);
  return (
    <>
      <div className="inc-page sc-page">
        <header className="inc-head">
          <p className="inc-head-flag"><Link href="/australia-inc">Australia Inc.</Link></p>
          <h1 className="inc-head-name">The scorecard</h1>
          <p className="inc-head-dek">The federal government&apos;s own measurable promises, and how the country has moved {TERMS[term].long}, from official data.</p>
          <TermToggle term={term} />
          {d.summary && <p className="sc-summary">{d.summary}</p>}
        </header>

        <section className="sc-section" aria-labelledby="sc-promises-title">
          <h2 id="sc-promises-title" className="inc-section-head">Promises</h2>
          <p className="inc-section-dek">Targets the government set itself, quoted from official documents and measured by official series. Ratings compare the pace achieved with the pace needed; they are mechanical, not judgements.</p>
          <PromiseList promises={d.promises} awaiting={d.awaiting} installed={d.installed} />
        </section>

        <section className="sc-section" aria-labelledby="sc-outcomes-title">
          <h2 id="sc-outcomes-title" className="inc-section-head">Outcomes</h2>
          <p className="inc-section-dek">Headline official measures {TERMS[term].long}, with how much of each the government controls. Not rated.</p>
          <OutcomeList outcomes={d.outcomes} />
        </section>

        <ScorecardMethodology />
      </div>
      <SiteFooter />
    </>
  );
}
