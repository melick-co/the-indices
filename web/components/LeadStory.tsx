import Link from 'next/link';
import type { Story } from '@/lib/story-types';
import { storyReceipt } from '@/lib/story-types';
import { resolveHeroImage } from '@/lib/story-art';
import StoryHighlights from '@/components/StoryHighlights';

export default function LeadStory({ story, wide = false }: { story: Story; wide?: boolean }) {
  const receipt = storyReceipt(story);
  const art = resolveHeroImage(story);

  return (
    <article className={wide ? 'lead lead-wide' : 'lead'}>
      <p className="lead-kicker">
        {story.frameCheck ? `Frame check · ${story.kicker}` : story.kicker}
      </p>
      <h1 className="lead-headline">
        <Link href={`/stories/${story.slug}`}>{story.title}</Link>
      </h1>
      {/* The story in numbers, when it has them; otherwise its illustration. */}
      {story.body?.highlights?.items?.length ? (
        <StoryHighlights highlights={story.body.highlights} blocks={story.body.blocks}
          sources={[...new Set(story.evidence?.sources?.map((s) => s.org) ?? [])]} />
      ) : art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="lead-cut" src={art.url} alt={art.alt} />
      )}
      <p className="lead-deck">{story.hook}</p>
      <p className="lead-number">
        <strong>{story.oneNumber.value}</strong>
        <span>{story.oneNumber.label}</span>
      </p>
      <p className="lead-caveat">{story.caveat}</p>
      <p className="lead-foot">
        <Link href={`/stories/${story.slug}`}>Read the story</Link>
        <span aria-hidden="true"> · </span>
        <Link href={`/evidence/${story.slug}`}>Tier {receipt.tier} · {receipt.orgs}</Link>
      </p>
    </article>
  );
}
