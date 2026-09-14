import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import StartSessionForm from '@/components/StartSessionForm';
import { formatPeriodEnd, loadTrendingPage, type TrendSnapshot, type TrendTopic } from '@/lib/trending-topics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trending topics — Caveat' };

export default async function TrendingPage() {
  const data = await loadTrendingPage();
  const hasAny = data.rss_day || data.rss_week || data.x_au_day || data.x_global_day;

  return (
    <>
      <main className="article">
        <div className="card-kicker">Daily digest · Australia/Sydney</div>
        <h1>Trending topics</h1>
        <p className="measure">
          What news outlets and X were talking about. RSS rankings come from our daily feed sweep;
          X lists reflect platform trends at snapshot time. These are coverage signals, not verified findings.
        </p>

        {data.period_end && (
          <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem',
            color: 'var(--ink-soft)', marginBottom: '2rem' }}>
            Latest snapshot · period ending {formatPeriodEnd(data.period_end)}
          </p>
        )}

        {!hasAny && (
          <div className="caveat-box">
            <h3>Waiting for first daily run</h3>
            <p style={{ marginBottom: 0 }}>
              Run <code style={{ fontSize: '.8rem' }}>node scripts/run-trending-topics.mjs</code>
              {' '}in <code style={{ fontSize: '.8rem' }}>agent/</code>, or wait for the nightly GitHub Action
              (after RSS feeds load).
            </p>
          </div>
        )}

        {hasAny && (
          <>
            <section style={{ marginBottom: '2.5rem' }}>
              <h2>News · yesterday</h2>
              <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>
                Top 10 topics from RSS feeds for the previous Sydney calendar day.
              </p>
              <TopicList snapshot={data.rss_day} emptyLabel="No RSS snapshot for yesterday yet." />
            </section>

            <section style={{ marginBottom: '2.5rem' }}>
              <h2>News · past 7 days</h2>
              <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>
                Top 10 topics across the rolling seven-day window.
              </p>
              <TopicList snapshot={data.rss_week} emptyLabel="No 7-day RSS snapshot yet." />
            </section>

            <section style={{ marginBottom: '2.5rem' }}>
              <h2>X · Australia</h2>
              <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>
                Trending on X for Australia at the daily snapshot.
              </p>
              <TopicList snapshot={data.x_au_day} isX emptyLabel="X trends not available yet." />
              {data.x_au_week && (data.x_au_week.topics?.length ?? 0) > 0 && (
                <>
                  <h3 style={{ marginTop: '1.5rem', fontSize: '1rem' }}>Past 7 days on X</h3>
                  <TopicList snapshot={data.x_au_week} isX compact />
                </>
              )}
            </section>

            <section style={{ marginBottom: '2.5rem' }}>
              <h2>X · Global</h2>
              <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>
                Worldwide trending topics on X at the daily snapshot.
              </p>
              <TopicList snapshot={data.x_global_day} isX emptyLabel="X trends not available yet." />
              {data.x_global_week && (data.x_global_week.topics?.length ?? 0) > 0 && (
                <>
                  <h3 style={{ marginTop: '1.5rem', fontSize: '1rem' }}>Past 7 days on X</h3>
                  <TopicList snapshot={data.x_global_week} isX compact />
                </>
              )}
            </section>

            {!data.x_configured && (
              <div className="caveat-box">
                <h3>X API not configured</h3>
                <p style={{ marginBottom: 0 }}>
                  Add Twitter OAuth credentials to <code style={{ fontSize: '.8rem' }}>agent/.env</code>
                  {' '}(<code style={{ fontSize: '.8rem' }}>TWITTER_API_KEY</code>, etc.) to populate X sections.
                  RSS rankings work without X credentials.
                </p>
              </div>
            )}

            <div className="caveat-box">
              <h3>Caveats</h3>
              <ul style={{ marginBottom: 0, paddingLeft: '1.2rem', lineHeight: 1.6 }}>
                <li>RSS topics are derived from tier 3 news feeds — colour, not evidence.</li>
                <li>X trends reflect platform activity, not editorial judgment.</li>
                <li>Topic labels are summarised automatically; verify against primary sources.</li>
              </ul>
            </div>
          </>
        )}

        <p style={{ marginTop: '2rem' }}>
          <Link href="/">← Home</Link>
          {' · '}
          <StartSessionForm
            intent="investigate"
            prompt="Investigate the strongest trending topic from today's RSS feeds"
          >
            Investigate in Foundry →
          </StartSessionForm>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function TopicList({
  snapshot,
  isX = false,
  compact = false,
  emptyLabel,
}: {
  snapshot: TrendSnapshot | null;
  isX?: boolean;
  compact?: boolean;
  emptyLabel?: string;
}) {
  const topics = snapshot?.topics ?? [];
  if (!topics.length) {
    return <p style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>{emptyLabel ?? 'No topics.'}</p>;
  }

  return (
    <ol className="trend-list" style={{ listStyle: 'none', padding: 0, margin: compact ? '1rem 0 0' : '1rem 0' }}>
      {topics.map((t) => (
        <TopicRow key={`${t.rank}-${t.topic}`} topic={t} isX={isX} compact={compact} />
      ))}
    </ol>
  );
}

function TopicRow({
  topic,
  isX,
  compact,
}: {
  topic: TrendTopic;
  isX: boolean;
  compact: boolean;
}) {
  const meta = isX
    ? topic.tweet_volume != null
      ? `${topic.tweet_volume.toLocaleString()} posts`
      : topic.mention_count != null
        ? `${topic.mention_count} day${topic.mention_count === 1 ? '' : 's'} trending`
        : null
    : topic.mention_count != null
      ? `${topic.mention_count} headline${topic.mention_count === 1 ? '' : 's'}`
      : null;

  const content = (
    <>
      <span className="trend-rank" style={{ fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '.85rem', color: 'var(--ink-faint)', minWidth: '1.5rem' }}>
        {topic.rank}
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{topic.topic}</span>
        {!compact && topic.summary && (
          <span style={{ display: 'block', fontSize: '.85rem', color: 'var(--ink-soft)',
            marginTop: '.2rem' }}>{topic.summary}</span>
        )}
        {!compact && !isX && topic.sample_headlines && topic.sample_headlines.length > 0 && (
          <span style={{ display: 'block', fontSize: '.75rem', color: 'var(--ink-faint)',
            marginTop: '.35rem' }}>
            {topic.sample_headlines.slice(0, 2).map((h) => h.title).join(' · ')}
          </span>
        )}
      </span>
      {meta && (
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '.68rem',
          color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>{meta}</span>
      )}
    </>
  );

  if (isX && topic.url) {
    return (
      <li style={{ marginBottom: '.65rem' }}>
        <a href={topic.url} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start',
            textDecoration: 'none', color: 'inherit', padding: '.5rem 0',
            borderBottom: '1px solid var(--rule)' }}>
          {content}
        </a>
      </li>
    );
  }

  return (
    <li style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start',
      padding: '.5rem 0', borderBottom: '1px solid var(--rule)' }}>
      {content}
    </li>
  );
}
