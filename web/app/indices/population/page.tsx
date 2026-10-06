import { sectionById } from '@/content/dashboard/economy';
import { loadSection } from '@/lib/economy-dashboard';
import { PopulationView } from '@/components/dashboard/Population';
import { loadPopulation } from '@/lib/population';
import { IX } from '@/lib/indices-paths';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Population — The Caveat’s Indices',
  description: 'How fast the population is growing and why: births, deaths, migration by visa and country, who is leaving, and travel.',
};

export default async function PopulationPage() {
  const [reading, d] = await Promise.all([loadSection(sectionById('people')!), loadPopulation()]);
  return <PopulationView dash={{ base: IX.economy, name: 'Economy dashboard' }} reading={reading} d={d} />;
}
