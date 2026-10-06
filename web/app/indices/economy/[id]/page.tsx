import { notFound, redirect } from 'next/navigation';
import { sectionById } from '@/content/dashboard/economy';
import { loadSection } from '@/lib/economy-dashboard';
import { SectionView } from '@/components/dashboard/Views';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: { id: string } }) {
  const section = sectionById(params.id);
  return section ? { title: `${section.title} — Economy — Caveat Indices`, description: section.question } : {};
}

export default async function EconomySectionPage({ params }: { params: { id: string } }) {
  // Population has its own page.
  if (params.id === 'people') redirect(IX.population);
  const section = sectionById(params.id);
  if (!section) notFound();
  return <SectionView dash={{ base: IX.economy, name: 'Economy dashboard' }} reading={await loadSection(section)} />;
}
