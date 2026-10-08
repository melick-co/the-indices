import Link from 'next/link';
import type { Story } from '@/lib/story-types';
import { HighlightThumb } from '@/components/StoryHighlights';

export default function HomeSecondaries({ stories }: { stories: Story[] }) {
  if (!stories.length) return null;
  return (
    <div className="sheet-secondaries">
      {stories.map((story) => {
        return (
        <article key={story.slug} className="brief">
          {/* The card's picture explains the topic: its key number and how it has moved. */}
          {story.body?.highlights?.items?.length ? (
            <Link href={`/stories/${story.slug}`} className="cut-link" tabIndex={-1} aria-hidden="true">
              <HighlightThumb highlights={story.body.highlights} blocks={story.body.blocks} />
            </Link>
          ) : null}
          <p className="brief-kicker">{story.kicker}</p>
          <h2 className="brief-headline">
            <Link href={`/stories/${story.slug}`}>{story.title}</Link>
          </h2>
          <p className="brief-deck">{story.hook.replace(/\[\^\d+\]/g, '')}</p>
        </article>
        );
      })}
    </div>
  );
}
