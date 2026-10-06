import { notFound } from 'next/navigation';
import { IndicatorView } from '@/components/dashboard/Views';
import { qolSectionById } from '@/content/dashboard/quality-of-life';
import { loadIndicator } from '@/lib/economy-dashboard';
import { entityNames } from '@/lib/entity-names';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string; metric: string } }) {
  const section = qolSectionById(params.id);
  return section ? { title: `${section.title} — Quality of life — The Caveat’s Indices` } : {};
}

export default async function QolIndicatorPage({ params }: { params: { id: string; metric: string } }) {
  const section = qolSectionById(params.id);
  if (!section) notFound();
  const r = await loadIndicator(section, params.metric);
  if (!r || !r.latest) notFound();
  return <IndicatorView dash={{ base: IX.qol, name: 'Quality of life' }} section={section} r={r} names={await entityNames()} />;
}
