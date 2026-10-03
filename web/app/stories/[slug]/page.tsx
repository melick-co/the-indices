import Link from 'next/link';
import { notFound } from 'next/navigation';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import StoryBody from '@/components/StoryBody';
import ReelControls from '@/components/ReelControls';
import { loadPendingRevision, loadStoryBySlug, withRevision } from '@/lib/stories-loader';
import { clipsOf, resolveHeroImage } from '@/lib/story-art';
import Footnoted from '@/components/Footnoted';
import HeroStat from '@/components/HeroStat';

/** Link text for a source URL; null if it is not a valid URL. */
function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

// Rendered on request: every story lives in the database, and the page reads ?preview / ?revision. (With no
// static slugs, generateStaticParams returned [] and Next 14 treated the route as static, so reading
// searchParams failed with DYNAMIC_SERVER_USAGE.)
export const dynamic = 'force-dynamic';

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
  searchParams?: { preview?: string; revision?: string };
}) {
  const preview = searchParams?.preview === '1';
  const loaded = await loadStoryBySlug(params.slug, { allowDraft: preview });
  if (!loaded) notFound();
  if (loaded.status === 'draft' && !preview) notFound();
  // ?revision=1 shows a pending refresh (lib/refresh-story.ts) in place of the live copy.
  const revision = searchParams?.revision === '1' && loaded.storyId ? await loadPendingRevision(loaded.storyId) : null;
  const story = revision ? withRevision(loaded, revision.content) : loaded;
  const art = resolveHeroImage(story);
  // The daily hero story's narrated summary clip (hero-video.ts), newest first.
  const clip = clipsOf(story).filter((c) => c.generator === 'elevenlabs').at(-1);

  return (
    <>
      <main className="article">
        {revision && (
          <div className="draft-banner">
            Revision preview: not live.{' '}
            {revision.check?.ok ? 'Passed every check.' : `Held: ${(revision.check?.issues ?? []).slice(1, 4).join('; ')}`}
          </div>
        )}
        {story.status === 'draft' && (
          <div className="draft-banner">
            Draft preview — not on the home page yet. Edit and publish from the News Desk when ready.
          </div>
        )}
        <div className="card-kicker">{story.kicker}</div>
        <h1>{story.title}</h1>
        {story.body?.blocks?.length ? (
          <>
            {/* Deck and hero graphic directly under the headline (NEWS-STYLE.md §2.2-2.3). */}
            <p className="story-deck"><Footnoted text={story.hook} /></p>
            {story.oneNumber?.metric_id && <HeroStat one={story.oneNumber} />}
          </>
        ) : null}
        {clip ? (
          <figure className="story-hero-video">
            <video className="story-hero-art" src={clip.url} poster={art?.url} controls playsInline
              preload="none" aria-label={clip.alt ?? story.title} />
            <figcaption className="figure-cap">Eight-second summary. Illustration and narration generated with ElevenLabs.</figcaption>
          </figure>
        ) : art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="story-hero-art" src={art.url} alt={art.alt} />
        )}
        <div className="byline">
          {new Date(story.published).toLocaleDateString('en-AU',
            { day: 'numeric', month: 'long', year: 'numeric' })}
          {story.updatedOn && !revision && (
            <>
              {' · Updated '}
              {new Date(story.updatedOn).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </>
          )}
          {' · '}
          <Link href={`/evidence/${story.slug}${preview ? '?preview=1' : ''}`}
            style={{ borderBottom: '1px solid var(--pen)' }}>
            Evidence and sources
          </Link>
        </div>

        {story.updateNote && !revision && (
          <p className="story-update-note">
            {/* A note can point to the article that replaced this one ("Read the new article: /stories/…"). */}
            {story.updateNote.split(/(\/stories\/[a-z0-9-]+)/).map((part, i) => (/^\/stories\//.test(part)
              ? <Link key={i} href={part} style={{ borderBottom: '1px solid var(--pen)' }}>{part.replace('/stories/', '').replace(/-/g, ' ')}</Link>
              : part))}
          </p>
        )}

        <div className="story-video-row">
          <ReelControls
            slug={story.slug}
            preview={preview || story.status === 'draft'}
          />
        </div>

        {story.body?.blocks?.length ? <StoryBody body={story.body} /> : null}

        {story.evidence?.footnotes?.length ? (
          <section className="story-sources" aria-labelledby="sources-heading">
            <h2 id="sources-heading">Sources</h2>
            <ol>
              {[...story.evidence.footnotes].sort((a, b) => a.n - b.n).map((f) => (
                <li key={f.n} id={`fn-${f.n}`} value={f.n}>
                  {f.text}
                  {f.url && hostOf(f.url) ? <> <a href={f.url} target="_blank" rel="noreferrer">{hostOf(f.url)}</a></> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

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
