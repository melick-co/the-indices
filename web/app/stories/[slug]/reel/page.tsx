import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import StoryChart from '@/components/StoryChart';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import { REEL_FORMAT, wordBudget, wordCount, type ReelScene } from '@/lib/reel-types';
import type { StoryChartBlock } from '@/lib/story-types';
import ReelActions from './ReelActions';
import ReelPayload from './ReelPayload';

export const dynamic = 'force-dynamic';

const spec9x16 = `${REEL_FORMAT.aspect} safe area`;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const story = await loadStoryBySlug(params.slug, { allowDraft: true });
  return story ? { title: `Reel brief: ${story.title} — Caveat` } : {};
}

/** The reel's chart frame is a story chart plus reveal direction, so it renders with the same component. */
function asStoryChart(scene: ReelScene): StoryChartBlock | null {
  if (!scene.chart) return null;
  const { reveal, unverified, unverified_note, ...chart } = scene.chart;
  return { type: 'chart', ...chart };
}

function SceneCard({ scene, index }: { scene: ReelScene; index: number }) {
  const words = wordCount(scene.narration);
  const budget = wordBudget(scene.seconds);
  const over = words > budget;
  const chart = asStoryChart(scene);

  return (
    <article className="reel-scene">
      <header className="reel-scene-head">
        <span className="reel-scene-n">{String(index + 1).padStart(2, '0')}</span>
        <span className="reel-scene-kind">{scene.kind.replace('_', ' ')}</span>
        <span className="reel-scene-secs">{scene.seconds}s</span>
      </header>

      <div className="reel-scene-body">
        <div className="reel-frame">
          <div className="reel-frame-inner">
            <p className="reel-on-screen">{scene.on_screen}</p>
            {chart && <p className="reel-frame-hold">chart holds this frame</p>}
            {scene.lower_third && <p className="reel-lower-third">{scene.lower_third}</p>}
          </div>
          <p className="reel-frame-cap">burned in · {spec9x16}</p>
        </div>

        <div className="reel-scene-text">
          <div className="reel-field">
            <span className="reel-field-label">
              Voiceover
              <span className={over ? 'reel-budget reel-budget-over' : 'reel-budget'}>
                {words} / {budget} words
              </span>
            </span>
            <p className="reel-vo">{scene.narration}</p>
          </div>

          <div className="reel-field">
            <span className="reel-field-label">Visual direction</span>
            <p className="reel-visual">{scene.visual_prompt}</p>
          </div>
        </div>
      </div>

      {chart && (
        <div className="reel-scene-chart">
          <span className="reel-field-label">
            Chart
            <span className="reel-budget">
              {scene.chart!.kind} · reveal {scene.chart!.reveal.replace(/_/g, ' ')}
            </span>
          </span>
          <StoryChart chart={chart} />
          {scene.chart!.unverified && (
            <p className="reel-untraced">{scene.chart!.unverified_note}</p>
          )}
        </div>
      )}
    </article>
  );
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

        <dl className="reel-meta">
          <div>
            <dt>Runtime</dt>
            <dd>{spec.total_seconds}s</dd>
          </div>
          <div>
            <dt>Scenes</dt>
            <dd>{spec.scenes.length}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{spec.format.aspect} · {spec.format.width}x{spec.format.height} · {spec.format.fps}fps</dd>
          </div>
          <div>
            <dt>Figures</dt>
            <dd>{warnings.length ? `${warnings.length} to check` : 'all traced'}</dd>
          </div>
        </dl>

        {warnings.length > 0 ? (
          <section className="reel-warnings">
            <h3>Checks outstanding</h3>
            <p>
              These have to clear before the brief can go to the generator. Regenerating usually
              fixes wording and budget breaches; an untraceable figure means the reel asserted
              something the story does not carry.
            </p>
            <ul>
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </section>
        ) : (
          <p className="reel-clear">
            Every figure on screen traces back to the story evidence, and every scene fits its read.
          </p>
        )}

        <div className="reel-actions">
          <ReelActions slug={params.slug} reel={{ status: reel.status }} />
        </div>

        <section className="reel-style">
          <h3>Held constant across every scene</h3>
          <dl>
            <div><dt>Presenter</dt><dd>{spec.style.presenter}</dd></div>
            <div><dt>Look</dt><dd>{spec.style.look}</dd></div>
            <div><dt>Voice</dt><dd>{spec.style.voice}</dd></div>
            <div><dt>Audio</dt><dd>{spec.style.audio}</dd></div>
          </dl>
        </section>

        <h2 className="reel-h2">Storyboard</h2>
        <div className="reel-scenes">
          {spec.scenes.map((scene, i) => (
            <SceneCard key={scene.id} scene={scene} index={i} />
          ))}
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
