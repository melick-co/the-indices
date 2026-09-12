import Link from 'next/link';
import { notFound } from 'next/navigation';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import StoryBody from '@/components/StoryBody';
import RankSwap from '@/components/RankSwap';
import SpiralTimeline from '@/components/SpiralTimeline';
import { STORIES } from '@/content/stories';
import { loadStoryBySlug } from '@/lib/stories-loader';
import Migration from './bodies/migration';
import WageSpiral from './bodies/wage-spiral';

export const revalidate = 900;
export const dynamicParams = true;

export function generateStaticParams() {
  return STORIES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { preview?: string };
}) {
  const s = await loadStoryBySlug(params.slug, { allowDraft: searchParams?.preview === '1' });
  return s ? { title: `${s.title} — Caveat`, description: s.hook } : {};
}

export default async function StoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { preview?: string };
}) {
  const preview = searchParams?.preview === '1';
  const story = await loadStoryBySlug(params.slug, { allowDraft: preview });
  if (!story) notFound();
  if (story.status === 'draft' && !preview) notFound();

  return (
    <>
      <main className="article">
        {story.status === 'draft' && (
          <div className="draft-banner">
            Draft preview — not on the home page yet. Go live from Foundry or Studio when ready.
          </div>
        )}
        <div className="card-kicker">{story.kicker}</div>
        <h1>{story.title}</h1>
        <div className="byline">
          {new Date(story.published).toLocaleDateString('en-AU',
            { day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}
          <Link href={`/evidence/${story.slug}${preview ? '?preview=1' : ''}`}
            style={{ borderBottom: '1px solid var(--pen)' }}>
            Evidence and sources
          </Link>
        </div>

        {story.body ? (
          <StoryBody body={story.body} />
        ) : (
          <>
            {story.slug === 'migration-denominator' && <Migration Figure={RankSwap} />}
            {story.slug === 'wage-spiral' && <WageSpiral Figure={SpiralTimeline} />}
          </>
        )}

        <div className="caveat-box">
          <h3>Caveat</h3>
          <p style={{ marginBottom: 0, fontSize: '.95rem' }}>{story.caveat}</p>
        </div>

        <p className="signoff">Just saying.</p>
        <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem' }}>
          <Link href={`/evidence/${story.slug}${preview ? '?preview=1' : ''}`}
            style={{ borderBottom: '1px solid var(--pen)' }}>
            See the data behind this story →
          </Link>
        </p>
      </main>
      <Capture />
      <SiteFooter />
    </>
  );
}
