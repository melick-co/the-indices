import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import ReelStoryboard from '@/components/ReelStoryboard';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import ReelActions from './ReelActions';
import ReelPayload from './ReelPayload';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const story = await loadStoryBySlug(params.slug, { allowDraft: true });
  return story ? { title: `Reel brief: ${story.title} — Caveat` } : {};
}

export default async function ReelPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { preview?: string };
}) {
  const [story, reel] = await Promise.all([
    loadStoryBySlug(params.slug, { allowDraft: true }),
    loadReel(params.slug, { allowDraft: true }),
  ]);
  if (!story) notFound();

  const preview = searchParams?.preview === '1' || story.status === 'draft';
  const storyHref = `/stories/${story.slug}${preview ? '?preview=1' : ''}`;

  if (!reel) {
    return (
      <>
        <main className="article reel-page">
          <div className="card-kicker">Reel brief</div>
          <h1>{story.title}</h1>
          <p className="reel-lede">
            No reel brief yet. Generating one cuts this story into a vertical news explainer, with
            every figure on screen traced back to the evidence the story already publishes.
          </p>
          <div className="reel-actions">
            <ReelActions slug={params.slug} reel={null} />
          </div>
          <p className="reel-back">
            <Link href={storyHref}>← Back to the story</Link>
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const { spec, warnings } = reel;
  const payload = JSON.stringify(
    { story: { slug: story.slug, title: story.title, caveat: story.caveat }, ...spec },
    null,
    2,
  );

  return (
    <>
      <main className="article reel-page">
        <div className="card-kicker">Reel brief · {reel.status}</div>
        <h1>{story.title}</h1>

        <p className="reel-lede">
          {reel.generationNote || 'Vertical news explainer cut from this story.'}
        </p>

        <ReelStoryboard spec={spec} warnings={warnings} />

        <div className="reel-actions">
          <ReelActions slug={params.slug} reel={{ status: reel.status }} />
        </div>

        <h2 className="reel-h2">Hand to the generator</h2>
        <p className="reel-lede">
          The scene list drives anything with an API. The shot list is the same brief flattened for
          a generator that takes one prompt.
        </p>
        <ReelPayload json={payload} shotList={spec.shot_list} />

        <p className="reel-back">
          <Link href={storyHref}>← Back to the story</Link>
          {' · '}
          <Link href={`/evidence/${story.slug}${preview ? '?preview=1' : ''}`}>
            Evidence and sources
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
