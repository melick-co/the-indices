import Link from 'next/link';
import type { Story } from '@/lib/story-types';
import { resolveHeroImage } from '@/lib/story-art';

export default function HomeSecondaries({ stories }: { stories: Story[] }) {
  if (!stories.length) return null;
  return (
    <div className="sheet-secondaries">
      {stories.map((story) => {
        const art = resolveHeroImage(story);
        return (
        <article key={story.slug} className="brief">
          {art && (
            <Link href={`/stories/${story.slug}`} className="cut-link" tabIndex={-1} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="brief-cut" src={art.url} alt="" loading="lazy" />
            </Link>
          )}
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
