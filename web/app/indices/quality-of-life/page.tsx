import Link from 'next/link';
import { QOL_SECTIONS } from '@/content/dashboard/quality-of-life';
import { loadDashboard } from '@/lib/economy-dashboard';
import { DashboardView } from '@/components/dashboard/Views';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Quality of life dashboard — The Caveat’s Indices',
  description: 'How Australians are living: income, work, housing, health, skills, safety, life satisfaction and civic life, against the rest of the OECD.',
};

export default async function QualityOfLifeDashboard() {
  const sections = await loadDashboard(QOL_SECTIONS);
  const better = sections.filter((s) => s.headline.status === 'better').length;
  return (
    <DashboardView
      dash={{ base: IX.qol, name: 'Quality of life' }}
      kicker="Australia · quality of life dashboard"
      title="How are Australians living?"
      intro={<>
        Eight sections drawn from the OECD&apos;s How&apos;s Life? well-being indicators, which measure the same things
        the same way in every member country, plus Australia&apos;s own housing figures. Most are surveyed once a year or
        less, so each is judged against the OECD median rather than its own history. Australia is better than the
        median on {better} of {sections.length} headline readings. Open any number for the trend and the country
        comparison.
      </>}
      sections={sections}
      legendNote={<>Dates differ by measure: each tile shows the latest year available. See also the <Link href={IX.sentiment} className="studio-link">sentiment &amp; polls</Link> dashboard.</>}
    />
  );
}
