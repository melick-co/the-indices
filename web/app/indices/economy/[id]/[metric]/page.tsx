import { notFound } from 'next/navigation';
import { IndicatorView } from '@/components/dashboard/Views';
import { sectionById } from '@/content/dashboard/economy';
import { loadIndicator } from '@/lib/economy-dashboard';
import { entityNames } from '@/lib/entity-names';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string; metric: string } }) {
  const section = sectionById(params.id);
  return section ? { title: `${section.title} — Economy dashboard — The Caveat’s Indices` } : {};
}

export default async function IndicatorPage({ params }: { params: { id: string; metric: string } }) {
  const section = sectionById(params.id);
  if (!section) notFound();
  const r = await loadIndicator(section, params.metric);
  if (!r || !r.latest) notFound();
  return <IndicatorView dash={{ base: IX.economy, name: 'Economy dashboard' }} section={section} r={r} names={await entityNames()} />;
}
