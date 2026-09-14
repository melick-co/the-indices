import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadDeskStories } from '@/lib/stories-loader';
import { loadSucceededRenders } from '../actions';
import StoryEditor from './StoryEditor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  return { title: `Edit ${params.slug} — News Desk` };
}

export default async function DeskStoryPage({ params }: { params: { slug: string } }) {
  const stories = await loadDeskStories();
  const story = stories.find((s) => s.slug === params.slug);
  if (!story) notFound();
  const renders = await loadSucceededRenders(story.slug);

  return (
    <main className="desk-page">
      <p className="desk-kicker">
        <Link href="/foundry/desk">News Desk</Link>
        {' · '}
        {story.slug}
      </p>
      <StoryEditor story={story} renders={renders} />
    </main>
  );
}
