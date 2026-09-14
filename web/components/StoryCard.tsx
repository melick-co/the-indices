import Link from 'next/link';
import type { Story } from '@/lib/story-types';
import { storyReceipt } from '@/lib/story-types';
import { resolveHeroImage } from '@/lib/story-art';

export default function StoryCard({ story }: { story: Story }) {
  const receipt = storyReceipt(story);
  const tierClass = receipt.tier === 1 ? 't1' : receipt.tier === 2 ? 't2' : 't3';
  const art = resolveHeroImage(story);

  return (
    <article className="card story-card">
      {art && (
        <Link href={`/stories/${story.slug}`} className="story-card-art-link">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="story-card-art" src={art.url} alt={art.alt} />
        </Link>
      )}
      <div className="card-kicker">{story.kicker}</div>
      <h3 className="card-title">
        <Link href={`/stories/${story.slug}`}>{story.title}</Link>
      </h3>
      <p className="card-hook">{story.hook}</p>
      <div className="card-caveat">
        <b>Caveat</b>
        {story.caveat}
      </div>
      <Link href={`/evidence/${story.slug}`} className="card-receipt">
        <span className={`tier ${tierClass}`}>Tier {receipt.tier}</span>
        <span className="card-receipt-orgs">{receipt.orgs}</span>
        <span className="card-receipt-check">Checkable →</span>
      </Link>
    </article>
  );
}
