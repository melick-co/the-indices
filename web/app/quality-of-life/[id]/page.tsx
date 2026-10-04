import { notFound } from 'next/navigation';
import { qolSectionById } from '@/content/dashboard/quality-of-life';
import { loadSection } from '@/lib/economy-dashboard';
import { SectionView } from '@/components/dashboard/Views';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: { id: string } }) {
  const section = qolSectionById(params.id);
  return section ? { title: `${section.title} — Quality of life — Caveat`, description: section.question } : {};
}

export default async function QolSectionPage({ params }: { params: { id: string } }) {
  const section = qolSectionById(params.id);
  if (!section) notFound();
  return <SectionView dash={{ base: '/quality-of-life', name: 'Quality of life' }} reading={await loadSection(section)} />;
}
