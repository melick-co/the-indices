import Link from 'next/link';
import { loadEconomyDashboard } from '@/lib/economy-dashboard';
import { DashboardView } from '@/components/dashboard/Views';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Economy dashboard — Caveat',
  description: 'The health of the Australian economy on one page: growth, jobs, prices, rates, housing, population and public finances.',
};

export default async function EconomyDashboard() {
  const sections = await loadEconomyDashboard();
  const good = sections.filter((s) => ['on-target', 'better'].includes(s.headline.status)).length;
  return (
    <DashboardView
      dash={{ base: '/indices', name: 'Economy dashboard' }}
      kicker="Australia · economy dashboard"
      title="How is the economy doing?"
      intro={<>
        Seven sections, each led by the number economists watch, with the indicators that explain it alongside.
        Every reading is official data, judged against its target where there is one and otherwise against its own
        ten-year average. {good} of {sections.length} headline readings {good === 1 ? 'is' : 'are'} on target or better than usual.
        Open any section or number for what it means and how Australia compares.
      </>}
      sections={sections}
      legendNote={<>See also the <Link href="/quality-of-life" className="studio-link">quality of life dashboard</Link>.</>}
    />
  );
}
