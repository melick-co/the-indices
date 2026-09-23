import Link from 'next/link';
import type { Story } from '@/lib/story-types';

export default function HomeSecondaries({ stories }: { stories: Story[] }) {
  if (!stories.length) return null;
  return (
    <div className="sheet-secondaries">
      {stories.map((story) => (
        <article key={story.slug} className="brief">
          <p className="brief-kicker">{story.kicker}</p>
          <h2 className="brief-headline">
            <Link href={`/stories/${story.slug}`}>{story.title}</Link>
          </h2>
          <p className="brief-deck">{story.hook}</p>
        </article>
      ))}
    </div>
  );
}
