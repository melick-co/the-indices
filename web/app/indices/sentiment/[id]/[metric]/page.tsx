import { notFound } from 'next/navigation';
import { IndicatorView } from '@/components/dashboard/Views';
import { sentimentSectionById } from '@/content/dashboard/sentiment';
import { loadIndicator } from '@/lib/economy-dashboard';
import { entityNames } from '@/lib/entity-names';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string; metric: string } }) {
  const section = sentimentSectionById(params.id);
  return section ? { title: `${section.title} — Sentiment & polls — Caveat Indices` } : {};
}

export default async function SentimentIndicatorPage({ params }: { params: { id: string; metric: string } }) {
  const section = sentimentSectionById(params.id);
  if (!section) notFound();
  const r = await loadIndicator(section, params.metric);
  if (!r || !r.latest) notFound();
  return <IndicatorView dash={{ base: IX.sentiment, name: 'Sentiment & polls' }} section={section} r={r} names={await entityNames()} />;
}
