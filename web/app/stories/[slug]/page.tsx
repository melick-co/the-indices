import Link from 'next/link';
import { notFound } from 'next/navigation';
import Masthead from '@/components/Masthead';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import RankSwap from '@/components/RankSwap';
import SpiralTimeline from '@/components/SpiralTimeline';
import { STORIES, bySlug } from '@/content/stories';
import Migration from './bodies/migration';
import WageSpiral from './bodies/wage-spiral';

export const dynamicParams = false;
export function generateStaticParams() {
  return STORIES.map((s) => ({ slug: s.slug }));
}
export function generateMetadata({ params }: { params: { slug: string } }) {
  const s = bySlug(params.slug);
  return s ? { title: `${s.title} — Caveat`, description: s.hook } : {};
}

export default function StoryPage({ params }: { params: { slug: string } }) {
  const story = bySlug(params.slug);
  if (!story) notFound();

  return (
    <>
      <Masthead />
      <main className="wrap article">
        <div className="card-kicker">{story.kicker}</div>
        <h1>{story.title}</h1>
        <div className="byline">
          {new Date(story.published).toLocaleDateString('en-AU',
            { day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}
          <Link href={`/evidence/${story.slug}`} style={{ borderBottom: '1px solid var(--pen)' }}>
            Evidence and sources
          </Link>
        </div>

        {story.slug === 'migration-denominator' && <Migration Figure={RankSwap} />}
        {story.slug === 'wage-spiral' && <WageSpiral Figure={SpiralTimeline} />}

        <div className="caveat-box">
          <h3>Caveat</h3>
          <p style={{ marginBottom: 0, fontSize: '.95rem' }}>{story.caveat}</p>
        </div>

        <p className="signoff">Just saying.</p>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem' }}>
          <Link href={`/evidence/${story.slug}`} style={{ borderBottom: '1px solid var(--pen)' }}>
            See the data behind this story →
          </Link>
        </p>
      </main>
      <Capture />
      <SiteFooter />
    </>
  );
}
