import Link from 'next/link';
import type { Story } from '@/lib/story-types';
import { storyReceipt } from '@/lib/story-types';

/** Hero claim driven by the latest Frame check story, with a static fallback. */
export default function HeroFlip({ story }: { story?: Story | null }) {
  if (!story) {
    return (
      <section className="hero">
        <div className="eyebrow">The detail that changes the story</div>
        <h1 className="hero-claim">
          America takes the <span className="mark">most migrants</span> in the world.
        </h1>
        <div className="hero-rub on">
          <span className="rub-label">Here&rsquo;s the rub</span>
          <p>
            Per person, it ranks 26th of 38. Absolute intake measures the size of an
            economy. Openness is a per-person question, and almost every ranking you
            have seen answers the first one.
          </p>
        </div>
        <div className="hero-foot">
          <span>OECD, 2024</span>
          <span className="tier t1">Tier 1</span>
          <span>·</span>
          <span>Checkable in one click</span>
        </div>
      </section>
    );
  }

  const receipt = storyReceipt(story);
  const tierClass = receipt.tier === 1 ? 't1' : receipt.tier === 2 ? 't2' : 't3';

  return (
    <section className="hero">
      <div className="eyebrow">Frame check · {story.kicker}</div>
      <h1 className="hero-claim">{story.title}</h1>
      <p className="hero-one">
        <span className="mark">{story.oneNumber.value}</span>
        <span className="hero-one-label">{story.oneNumber.label}</span>
      </p>
      <div className="hero-rub on">
        <span className="rub-label">Here&rsquo;s the rub</span>
        <p>{story.hook}</p>
      </div>
      <div className="hero-foot">
        <span>{receipt.orgs}</span>
        <span className={`tier ${tierClass}`}>Tier {receipt.tier}</span>
        <span>·</span>
        <Link href={`/stories/${story.slug}`} className="hero-story-link">
          Read the story
        </Link>
      </div>
    </section>
  );
}
