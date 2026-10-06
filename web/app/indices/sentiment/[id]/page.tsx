import { notFound } from 'next/navigation';
import { sentimentSectionById } from '@/content/dashboard/sentiment';
import { loadSection } from '@/lib/economy-dashboard';
import { SectionView } from '@/components/dashboard/Views';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';
export function generateMetadata({ params }: { params: { id: string } }) {
  const section = sentimentSectionById(params.id);
  return section ? { title: `${section.title} — Sentiment & polls — The Caveat’s Indices`, description: section.question } : {};
}

export default async function SentimentSectionPage({ params }: { params: { id: string } }) {
  const section = sentimentSectionById(params.id);
  if (!section) notFound();
  return <SectionView dash={{ base: IX.sentiment, name: 'Sentiment & polls' }} reading={await loadSection(section)} />;
}
