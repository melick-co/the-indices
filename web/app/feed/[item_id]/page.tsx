import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import { createClient } from '@/lib/supabase-server';
import { buildAskPrompt, buildBrainstormPrompt, feedSessionTitle } from '@/lib/feed-prompts';

export const dynamic = 'force-dynamic';
export const revalidate = 900;

type Props = { params: { item_id: string } };

export async function generateMetadata({ params }: Props) {
  try {
    const supabase = createClient();
    const { data } = await supabase.from('rss_items')
      .select('title, summary')
      .eq('item_id', params.item_id)
      .eq('curated', true)
      .maybeSingle();
    if (!data) return { title: 'Feed item — Caveat' };
    return {
      title: `${data.title} — Caveat`,
      description: data.summary?.slice(0, 160) ?? 'Curated headline from the news wire.',
    };
  } catch {
    return { title: 'Feed item — Caveat' };
  }
}

export default async function FeedItemPage({ params }: Props) {
  const supabase = createClient();
  const { data: item } = await supabase.from('rss_items')
    .select('item_id, title, link, summary, published_at, curated_note, matched_keywords')
    .eq('item_id', params.item_id)
    .eq('curated', true)
    .maybeSingle();

  if (!item) notFound();

  const askPrompt = buildAskPrompt(item);
  const brainstormPrompt = buildBrainstormPrompt(item);
  const sessionTitle = feedSessionTitle(item);
  const askHref = `/studio/ask?q=${encodeURIComponent(askPrompt)}`;
  const brainstormHref = `/studio/brainstorm/start?title=${encodeURIComponent(sessionTitle)}&prompt=${encodeURIComponent(brainstormPrompt)}`;

  const published = item.published_at
    ? new Date(item.published_at).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    : null;

  return (
    <>
      <main className="article">
        <div className="card-kicker">{item.curated_note?.trim() || 'On the wire'}</div>
        <h1>{item.title}</h1>
        <div className="byline">
          {published && <span>{published}</span>}
          {published && item.link && ' · '}
          {item.link && (
            <a href={item.link} target="_blank" rel="noreferrer" style={{ borderBottom: '1px solid var(--pen)' }}>
              Read original
            </a>
          )}
        </div>

        <section className="feed-synopsis">
          <h2>Synopsis</h2>
          {item.summary?.trim() ? (
            <p>{item.summary.trim()}</p>
          ) : (
            <p style={{ color: 'var(--ink-soft)' }}>
              No excerpt was captured from the source feed. Open the original article for full context.
            </p>
          )}
        </section>

        {item.matched_keywords?.length ? (
          <p className="feed-keywords">
            Matched: {item.matched_keywords.join(' · ')}
          </p>
        ) : null}

        <div className="feed-actions">
          <Link href={askHref} className="btn-accent">Ask about this</Link>
          <Link href={brainstormHref} className="studio-btn-outline">Brainstorm angles</Link>
        </div>

        <div className="caveat-box">
          <h3>Caveat</h3>
          <p style={{ marginBottom: 0, fontSize: '.95rem' }}>
            This is a curated headline from an external source — a lead, not evidence.
            Ask or brainstorm to test the claim against our data before treating it as a story.
          </p>
        </div>

        <p style={{ marginTop: 'var(--spacing-42)' }}>
          <Link href="/" style={{ borderBottom: '1px solid var(--pen)' }}>← Back to stories</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
