import Link from 'next/link';
import { loadEconomyDashboard } from '@/lib/economy-dashboard';
import { DashboardView } from '@/components/dashboard/Views';
import { Icon } from '@/components/dashboard/Icons';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Economy dashboard — The Indices',
  description: 'The health of the Australian economy on one page: growth, jobs, prices, rates, housing, population and public finances.',
};

export default async function EconomyDashboard() {
  const sections = await loadEconomyDashboard();
  const good = sections.filter((s) => ['on-target', 'better'].includes(s.headline.status)).length;
  return (
    <DashboardView
      dash={{ base: IX.economy, name: 'Economy dashboard' }}
      kicker="Australia · economy dashboard"
      title="How is the economy doing?"
      intro={<>
        Seven sections, each led by the number economists watch, with the indicators that explain it alongside.
        Every reading is official data, judged against its target where there is one and otherwise against its own
        ten-year average. {good} of {sections.length} headline readings {good === 1 ? 'is' : 'are'} on target or better than usual.
        Open any section or number for what it means and how Australia compares.
      </>}
      sections={sections}
      legendNote={<>See also the <Link href={IX.qol} className="studio-link">quality of life dashboard</Link>.</>}
    >
      <Link href={IX.pnl} className="dx-band dx-band-link">
        <span className="dx-band-icon"><Icon name="chart" size={18} /></span>
        <div>
          <h2>Australia Inc.: the country&apos;s profit and loss →</h2>
          <p>The national accounts read as a business: what the country earns, pays abroad, spends and keeps, and how it pays for its investment</p>
        </div>
      </Link>
    </DashboardView>
  );
}
