import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import ReelStoryboard from '@/components/ReelStoryboard';
import VideoStepper from '@/components/VideoStepper';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import { VIDEO_STAGE_LABEL } from '@/lib/reel-types';
import ReelActions from './ReelActions';
import ReelPayload from './ReelPayload';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const story = await loadStoryBySlug(params.slug, { allowDraft: true });
  return story ? { title: `Video: ${story.title} — Caveat` } : {};
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
  const stage = reel?.stage ?? null;

  return (
    <>
      <main className="article reel-page">
        <div className="card-kicker">
          {reel ? `Video · ${VIDEO_STAGE_LABEL[reel.stage].toLowerCase()} · ${reel.status}` : 'Generate video'}
        </div>
        <h1>{story.title}</h1>
        <p className="reel-lede">
          {reel?.generationNote
            || 'Three locked passes: write the script, draw the storyboard, then emit the prompts for the generator. Later passes cannot rewrite an earlier one. Every figure has to trace back to the story evidence.'}
        </p>

        <VideoStepper stage={stage} />

        <div className="reel-actions">
          <ReelActions
            slug={params.slug}
            reel={reel ? { status: reel.status, stage: reel.stage } : null}
            warningCount={reel?.warnings.length ?? 0}
          />
        </div>

        {reel ? (
          <>
            <ReelStoryboard spec={reel.spec} warnings={reel.warnings} stage={reel.stage} />

            {reel.stage === 'prompts' && (
              <>
                <h2 className="reel-h2">Prompt output</h2>
                <p className="reel-lede">
                  Scene prompts are one shot each, with the locked script quoted so a generator
                  cannot rewrite the read. The shot list is the same brief flattened. Scene JSON
                  drives anything with an API.
                </p>
                <ReelPayload
                  json={JSON.stringify(
                    { story: { slug: story.slug, title: story.title, caveat: story.caveat }, ...reel.spec },
                    null,
                    2,
                  )}
                  shotList={reel.spec.shot_list}
                  promptPack={reel.spec.prompt_pack}
                />
              </>
            )}
          </>
        ) : (
          <p className="reel-lede">
            No script yet. Writing one cuts this story into a voiceover and burned-in text, with
            every spoken figure traced back to the evidence. The storyboard and prompt pack come
            after that script is locked.
          </p>
        )}

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
