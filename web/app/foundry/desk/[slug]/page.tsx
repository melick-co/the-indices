import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadDeskStories, loadPendingRevision, withRevision } from '@/lib/stories-loader';
import { loadSucceededRenders } from '../actions';
import StoryEditor from './StoryEditor';

export const dynamic = 'force-dynamic';
// Re-check runs the claim audit, which can take a minute or two.
export const maxDuration = 300;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  return { title: `Edit ${params.slug} — News Desk` };
}

export default async function DeskStoryPage({
  params, searchParams,
}: { params: { slug: string }; searchParams?: { revision?: string } }) {
  const stories = await loadDeskStories();
  const story = stories.find((s) => s.slug === params.slug);
  if (!story) notFound();
  const renders = await loadSucceededRenders(story.slug);
  const pending = story.storyId && story.status === 'published' ? await loadPendingRevision(story.storyId) : null;
  const editing = Boolean(pending && searchParams?.revision === '1');
  const revision = pending ? { check: pending.check, createdAt: pending.created_at, editing } : null;

  return (
    <main className="desk-page">
      <p className="desk-kicker">
        <Link href="/foundry/desk">News Desk</Link>
        {' · '}
        {story.slug}
      </p>
      {/* Keyed so switching between live copy and the revision resets the form. */}
      <StoryEditor key={editing ? 'revision' : 'live'} story={editing && pending ? withRevision(story, pending.content) : story}
        renders={renders} revision={revision} />
    </main>
  );
}
