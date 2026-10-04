import Link from 'next/link';
import { SENTIMENT_SECTIONS } from '@/content/dashboard/sentiment';
import { loadDashboard } from '@/lib/economy-dashboard';
import { loadPolls } from '@/lib/polls';
import { DashboardView } from '@/components/dashboard/Views';
import { PollsPanel } from '@/components/dashboard/Polls';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sentiment & polls dashboard — Caveat',
  description: 'How Australians and businesses feel, what the polls say, and whether the official numbers back the mood.',
};

export default async function SentimentDashboard() {
  const [sections, polls] = await Promise.all([loadDashboard(SENTIMENT_SECTIONS), loadPolls()]);
  const consumers = sections.find((s) => s.section.id === 'consumers')!;
  return (
    <DashboardView
      dash={{ base: '/sentiment', name: 'Sentiment & polls' }}
      kicker="Australia · sentiment & polls dashboard"
      title="How does Australia feel?"
      intro={<>
        Consumer and business confidence from the OECD&apos;s harmonised indices, where 100 is each country&apos;s
        long-run average, beside the official numbers that test the mood. Below, what published polls say, labelled
        as private context and checked against the data.
      </>}
      sections={sections}
      legendNote={<>See also the <Link href="/indices" className="studio-link">economy</Link> and <Link href="/quality-of-life" className="studio-link">quality of life</Link> dashboards.</>}
    >
      <PollsPanel polls={polls} consumers={consumers} />
    </DashboardView>
  );
}
