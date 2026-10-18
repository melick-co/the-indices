import Link from 'next/link';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase-server';
import { loadTrendingPage, type TrendingPageData, type TrendTopic } from '@/lib/trending-topics';
import { buildTrendIndex, sortPitchesByTrend } from '@/lib/trend-weight';
import { recentRuns, type RunSummary } from '@/lib/github-dispatch';
import { sydneyDay } from '@/lib/dates';
import { IX } from '@/lib/indices-paths';
import {
  bottomLineToday, checkIssues, countBy, feedHealth, hostOf, isGateHold, newestFirst, rowTitle, rowTime,
  sydneyDateLabel, sydneyWhen, timeAgo, type FeedRow,
} from '@/lib/newsdesk';
import WireList, { type WireItem } from './_newsdesk/WireList';
import SourceDecision from './_newsdesk/SourceDecision';
import './_newsdesk/newsdesk.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Newsdesk — Caveat' };

type Row = Record<string, any>;
/** A query's rows, or null when it failed (most often: the table is not installed yet). Never throws. */
type Result = { rows: Row[] | null; count: number | null };

async function q(p: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>): Promise<Result> {
  try {
    const { data, error, count } = await p;
    if (error) return { rows: null, count: null };
    return { rows: (Array.isArray(data) ? data : data ? [data] : []) as Row[], count: count ?? null };
  } catch {
    return { rows: null, count: null };
  }
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

/** rss_feeds, with the beat column when it exists. */
async function loadFeeds(db: ReturnType<typeof createClient>): Promise<{ feeds: FeedRow[] | null; hasBeat: boolean }> {
  const cols = 'feed_id, name, publisher, url, active, last_fetched, last_item_at, error_count';
  const withBeat = await q(db.from('rss_feeds').select(`${cols}, beat`));
  if (withBeat.rows) return { feeds: withBeat.rows as FeedRow[], hasBeat: true };
  const plain = await q(db.from('rss_feeds').select(cols));
  return { feeds: plain.rows as FeedRow[] | null, hasBeat: false };
}

const PITCH_STATES = ['pitched', 'candidate', 'approved', 'watchlist', 'dormant', 'published', 'rejected'];
const PITCH_LABEL: Record<string, string> = {
  pitched: 'Pitched', candidate: 'Awaiting ranking', approved: 'Approved', watchlist: 'Watchlist',
  dormant: 'Dormant', published: 'Published', rejected: 'Rejected',
};

export default async function NewsdeskPage() {
  const db = createClient();
  const now = new Date();
  const today = sydneyDay(now);
  const nowIso = now.toISOString();
  const in14 = new Date(now.getTime() + 14 * 864e5).toISOString();

  const [
    runs, ghRuns, wire, feedsRes, queueNext, queueFlagged, drafts, published, revisions,
    bottomLines, rubs, incNew, sourceSugs, topicSugs, econNotes, inboxNew, trending, pitches, calendar,
    scLog, scHeld,
  ] = await Promise.all([
    q(db.from('agent_runs').select('ran_at, quiet_day, pitched, candidates, notes').order('ran_at', { ascending: false }).limit(3)),
    safe<RunSummary[]>(recentRuns(6), []),
    q(db.from('rss_items').select('item_id, feed_id, title, link, published_at, fetched_at, status, curated')
      .neq('status', 'discarded').order('published_at', { ascending: false, nullsFirst: false }).limit(8)),
    safe(loadFeeds(db), { feeds: null, hasBeat: false }),
    q(db.from('content_queue').select('id, kind, ref_slug, title, status, scheduled_at, scheduled_by')
      .in('status', ['scheduled', 'ready']).order('scheduled_at', { ascending: true, nullsFirst: false }).limit(6)),
    q(db.from('content_queue').select('id, kind, ref_slug, title, status, error, created_at')
      .in('status', ['held', 'failed']).order('created_at', { ascending: false }).limit(6)),
    q(db.from('stories').select('slug, title, status, updated_at, check_hash').eq('status', 'draft')
      .order('updated_at', { ascending: false }).limit(8)),
    q(db.from('stories').select('slug, title, status, published, updated_at').eq('status', 'published')
      .order('published', { ascending: false }).order('updated_at', { ascending: false }).limit(5)),
    q(db.from('story_revisions').select('revision_id, created_at, check, note, stories(slug, title)')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(8)),
    q(db.from('bottom_lines').select('*').order('day', { ascending: false }).limit(5)),
    q(db.from('rubs').select('*').limit(60)),
    q(db.from('inc_items').select('*', { count: 'exact', head: true }).eq('status', 'new')),
    q(db.from('source_suggestions').select('suggestion_id, action, summary, payload, created_at', { count: 'exact' })
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(5)),
    q(db.from('topic_suggestions').select('suggestion_id, summary, created_at', { count: 'exact' })
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(3)),
    q(db.from('economist_notes').select('id, status')
      .in('status', ['new', 'reviewed']).limit(200)),
    q(db.from('inbox').select('id, kind, title, url, created_at', { count: 'exact' })
      .eq('status', 'new').order('created_at', { ascending: false }).limit(3)),
    safe<TrendingPageData | null>(loadTrendingPage(), null),
    q(db.from('pitches').select('id, headline, hook, state, rank_value, first_seen, metric_ids')),
    q(db.from('events').select('event_id, title, institution, series, kind, scheduled_at, status, source_url')
      .gte('scheduled_at', nowIso).lte('scheduled_at', in14).in('status', ['scheduled', 'due'])
      .order('scheduled_at', { ascending: true }).limit(8)),
    // The government scorecard (migration 49): the week's changes and anything held by the strict check. Visibility,
    // not approval: the agent keeps the list.
    q(db.from('scorecard_log').select('slug, kind, from_value, to_value, created_at', { count: 'exact' })
      .gte('created_at', new Date(now.getTime() - 7 * 864e5).toISOString()).order('created_at', { ascending: false }).limit(3)),
    q(db.from('scorecard_commitments').select('slug, title', { count: 'exact' }).eq('status', 'held').limit(3)),
  ]);

  // The Australia Inc beat: its own latest items, when feeds carry a beat.
  const feeds = feedsRes.feeds ?? [];
  const feedById = new Map(feeds.map((f) => [f.feed_id, f]));
  const beatFeedIds = feeds.filter((f) => f.beat === 'australia_inc').map((f) => f.feed_id);
  const beatWire = feedsRes.hasBeat && beatFeedIds.length
    ? await q(db.from('rss_items').select('item_id, feed_id, title, link, published_at, fetched_at, status, curated')
      .in('feed_id', beatFeedIds).neq('status', 'discarded')
      .order('published_at', { ascending: false, nullsFirst: false }).limit(8))
    : { rows: [], count: 0 };
  const toWire = (r: Row): WireItem => {
    const f = feedById.get(r.feed_id);
    return {
      item_id: r.item_id, title: r.title, link: r.link ?? null,
      publisher: f?.publisher || f?.name || hostOf(r.link) || 'Feed',
      ago: timeAgo(r.published_at ?? r.fetched_at, now), curated: !!r.curated,
      beat: f?.beat ?? null, status: r.status ?? 'fetched',
    };
  };

  // Pitches: counts and the top of the list as the board orders it.
  const trendIndex = trending ? buildTrendIndex(trending) : [];
  const pitchRows = pitches.rows ?? [];
  const pitchCounts = countBy(pitchRows, (p) => p.state);
  const topPitches = sortPitchesByTrend(
    pitchRows.filter((p) => p.state === 'pitched' || p.state === 'approved') as Array<Row & { headline: string }>,
    trendIndex,
  ).slice(0, 5);

  // Australia Inc and The Rub (tables added in parallel; quiet until installed).
  const bl = bottomLines.rows ? bottomLineToday(bottomLines.rows, today) : null;
  const blIssues = bl?.row ? checkIssues(bl.row.check) : [];
  const rubRows = rubs.rows ? newestFirst(rubs.rows) : null;
  const rubPending = rubRows?.filter((r) => r.status === 'pending') ?? [];
  const rubLatest = rubRows?.[0] ?? null;

  const health = feedsRes.feeds ? feedHealth(feeds, now) : null;
  const econ = econNotes.rows ? countBy(econNotes.rows, (n) => n.status) : null;
  const lastRun = runs.rows?.[0];
  const ghFailed = ghRuns.filter((r) => r.conclusion === 'failure');
  const ghActive = ghRuns.filter((r) => r.status === 'in_progress' || r.status === 'queued');
  const nextSlot = queueNext.rows?.find((r) => r.scheduled_at);
  const nextEvent = calendar.rows?.[0];
  const rssDay = trending?.rss_day?.topics ?? [];
  const xDay = trending?.x_au_day?.topics ?? [];

  // Needs you: everything waiting on an editor's decision, most pressing first.
  const revisionRows = revisions.rows ?? [];
  const draftRows = drafts.rows ?? [];
  const flagged = queueFlagged.rows ?? [];
  const needs: Array<{ key: string; label: string; title: ReactNode; meta?: string; href: string; issues?: string[]; action?: ReactNode }> = [];
  if (bl && bl.status === 'held') {
    needs.push({ key: 'bl', label: 'Bottom Line held', title: rowTitle(bl.row ?? {}), meta: `Australia Inc · ${today}`,
      href: '/australia-inc', issues: blIssues });
  }
  for (const r of rubPending.slice(0, 3)) {
    needs.push({ key: `rub-${r.id ?? rowTitle(r)}`, label: 'The Rub · pending', title: rowTitle(r),
      meta: timeAgo(rowTime(r), now), href: '/foundry/rub', issues: checkIssues(r.check) });
  }
  for (const r of revisionRows) {
    const story = Array.isArray(r.stories) ? r.stories[0] : r.stories;
    const issues = checkIssues(r.check);
    needs.push({ key: `rev-${r.revision_id}`, label: r.check?.ok ? 'Revision · passed check' : 'Revision · pending',
      title: story?.title ?? 'Story revision', meta: [r.note, timeAgo(r.created_at, now)].filter(Boolean).join(' · '),
      href: story?.slug ? `/foundry/desk/${story.slug}` : '/foundry/desk', issues });
  }
  for (const r of flagged) {
    needs.push({ key: `q-${r.id}`, label: isGateHold(r.error) ? 'Held by the publish gate' : `Queue · ${r.status}`,
      title: r.title, meta: `${r.kind} · ${timeAgo(r.created_at, now)}`, href: '/foundry/queue',
      issues: r.error ? [String(r.error)] : [] });
  }
  for (const r of draftRows.slice(0, 4)) {
    needs.push({ key: `d-${r.slug}`, label: r.check_hash ? 'Draft · passed check' : 'Draft · not passed',
      title: r.title, meta: `updated ${timeAgo(r.updated_at, now)}`, href: `/foundry/desk/${r.slug}` });
  }
  for (const s of sourceSugs.rows ?? []) {
    const p = (s.payload ?? {}) as Row;
    // A series a reviewer asked the source scout for, because a claim could not be checked: show where and which claim.
    const origin = p.origin === 'australia_inc' ? 'Australia Inc' : p.origin === 'economists' ? 'Economists' : null;
    const claim = origin && p.claim ? `Claim: "${String(p.claim).slice(0, 140)}${String(p.claim).length > 140 ? '…' : ''}"` : null;
    needs.push({ key: `s-${s.suggestion_id}`,
      label: s.action === 'register_rss_feed' ? 'New feed suggested' : origin ? `Series requested · ${origin}` : 'New source suggested',
      title: s.summary || p.name || p.url || 'Suggestion',
      meta: [claim, origin && p.org, hostOf(p.url ?? p.feed_url), timeAgo(s.created_at, now)].filter(Boolean).join(' · '),
      href: p.origin === 'australia_inc' ? '/australia-inc' : '/foundry/pitches', action: <SourceDecision id={s.suggestion_id} /> });
  }
  const needsCount = needs.length
    + Math.max(0, (sourceSugs.count ?? 0) - (sourceSugs.rows?.length ?? 0))
    + (topicSugs.count ?? 0) + (econ?.reviewed ?? 0) + (inboxNew.count ?? 0) + (incNew.count ?? 0);

  return (
    <main className="desk-page nd-page">
      <header className="nd-pulse">
        <div className="nd-pulse-main">
          <p className="desk-kicker">Foundry · Newsdesk</p>
          <h1 className="nd-title">{sydneyDateLabel(now)}</h1>
        </div>
        <dl className="nd-pulse-stats">
          <div>
            <dt>Agent</dt>
            <dd>
              {lastRun
                ? <>{timeAgo(lastRun.ran_at, now)}{lastRun.quiet_day ? ' · quiet day' : ''}{lastRun.pitched != null ? ` · ${lastRun.pitched} pitched` : ''}</>
                : <span className="nd-faint">no runs</span>}
            </dd>
          </div>
          <div>
            <dt>Runner</dt>
            <dd>
              {ghRuns.length === 0
                ? <Link href="/foundry/make" className="nd-faint">see Make</Link>
                : <a href={ghRuns[0].url} target="_blank" rel="noreferrer">
                    <span className={ghFailed.length ? 'nd-dot is-bad' : 'nd-dot is-ok'} aria-hidden />
                    {ghFailed.length ? `${ghFailed.length} failed` : 'all passing'}
                    {ghActive.length ? ` · ${ghActive.length} running` : ''}
                  </a>}
            </dd>
          </div>
          <div>
            <dt>Next slot</dt>
            <dd>{nextSlot ? <Link href="/foundry/queue">{sydneyWhen(nextSlot.scheduled_at)}</Link> : <span className="nd-faint">none</span>}</dd>
          </div>
          <div>
            <dt>Next release</dt>
            <dd>{nextEvent ? <>{nextEvent.institution} · {sydneyWhen(nextEvent.scheduled_at)}</> : <span className="nd-faint">none in 14 days</span>}</dd>
          </div>
        </dl>
      </header>

      <section className="nd-panel nd-panel--needs" aria-labelledby="nd-needs">
        <PanelHead id="nd-needs" title="Needs you" status={needsCount ? `${needsCount} waiting` : 'Nothing waiting'} />
        <div className="nd-needs-chips">
          <Chip href="/foundry/pitches" n={topicSugs.count} label="topic suggestions" />
          <Chip href="/foundry/pitches" n={econ?.reviewed ?? null} label="economist notes to pitch" />
          <Chip href="/foundry/pitches" n={inboxNew.count} label="inbox" />
          <Chip href="/australia-inc" n={incNew.count} label="Australia Inc items" />
          <Chip href="/foundry/desk" n={draftRows.length} label="drafts" />
          <Chip href="/foundry/desk" n={revisions.rows ? revisionRows.length : null} label="revisions" />
        </div>
        {needs.length === 0
          ? <p className="nd-empty">No held pieces, pending revisions or suggestions.</p>
          : (
            <ul className="nd-list nd-list--needs">
              {needs.slice(0, 12).map((n) => (
                <li key={n.key} className="nd-row">
                  <div className="nd-row-main">
                    <span className="nd-label">{n.label}</span>
                    <Link href={n.href} className="nd-row-title">{n.title}</Link>
                    {n.meta && <span className="nd-meta">{n.meta}</span>}
                    {!!n.issues?.length && (
                      <ul className="nd-issues">
                        {n.issues.slice(0, 3).map((i, k) => <li key={k}>{i}</li>)}
                        {n.issues.length > 3 && <li>+{n.issues.length - 3} more</li>}
                      </ul>
                    )}
                  </div>
                  {n.action}
                </li>
              ))}
            </ul>
          )}
      </section>

      <div className="nd-grid">
        <Panel title="Wire" status={wire.rows ? `${wire.rows.length} latest` : undefined} missing={!wire.rows}
          links={[{ href: '/foundry/pitches#news', label: 'All news' }]}>
          <WireList items={(wire.rows ?? []).map(toWire)} beatItems={(beatWire.rows ?? []).map(toWire)} hasBeat={feedsRes.hasBeat && beatFeedIds.length > 0} />
        </Panel>

        <Panel title="Publishing queue" missing={!queueNext.rows}
          status={queueNext.rows ? `${queueNext.rows.length} next · ${flagged.length} held or failed` : undefined}
          links={[{ href: '/foundry/queue', label: 'Open queue' }]}>
          <ul className="nd-list">
            {flagged.map((r) => (
              <li key={r.id} className="nd-row">
                <div className="nd-row-main">
                  <span className="nd-label is-bad">{isGateHold(r.error) ? 'Publish gate' : r.status}</span>
                  <Link href="/foundry/queue" className="nd-row-title">{r.title}</Link>
                  <span className="nd-meta">{r.kind}{r.error ? ` · ${String(r.error).slice(0, 90)}` : ''}</span>
                </div>
              </li>
            ))}
            {(queueNext.rows ?? []).map((r) => (
              <li key={r.id} className="nd-row">
                <div className="nd-row-main">
                  <Link href="/foundry/queue" className="nd-row-title">{r.title}</Link>
                  <span className="nd-meta">{r.kind} · {r.scheduled_at ? sydneyWhen(r.scheduled_at) : 'ready, no slot'}{r.scheduled_by ? ` · by ${r.scheduled_by}` : ''}</span>
                </div>
              </li>
            ))}
          </ul>
          {queueNext.rows && !queueNext.rows.length && !flagged.length && <p className="nd-empty">Nothing scheduled.</p>}
        </Panel>

        <Panel title="Trending" missing={!trending}
          status={trending?.period_end ? `day to ${trending.period_end}` : 'no snapshot yet'}
          links={[{ href: '/trending', label: 'Trending page' }, { href: '/foundry/work', label: 'Research' }]}>
          {rssDay.length === 0 && xDay.length === 0 && <p className="nd-empty">No trending snapshot for today.</p>}
          <ul className="nd-list">
            {[...rssDay.slice(0, 6), ...xDay.slice(0, 2)].map((t: TrendTopic, i) => (
              <li key={`${t.topic}-${i}`} className="nd-row">
                <span className="nd-rank">{t.rank ?? i + 1}</span>
                <div className="nd-row-main">
                  <span className="nd-row-title">{t.topic}</span>
                  <span className="nd-meta">
                    {i >= Math.min(rssDay.length, 6) ? 'X · ' : 'News · '}
                    {t.mention_count != null ? `${t.mention_count} mentions` : ''}
                    {t.score != null ? `${t.mention_count != null ? ' · ' : ''}weight ${Number(t.score).toFixed(1)}` : ''}
                  </span>
                </div>
                <form action="/foundry/work/start" method="post" className="nd-inline-form">
                  <input type="hidden" name="title" value={t.topic} />
                  <input type="hidden" name="prompt" value={`Investigate the trending topic "${t.topic}": is there an Australian data story in it?`} />
                  <input type="hidden" name="intent" value="investigate" />
                  <button type="submit" className="nd-btn nd-btn--quiet">Research</button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Pitches" missing={!pitches.rows}
          status={pitches.rows ? `${pitchCounts.pitched ?? 0} pitched · ${pitchCounts.candidate ?? 0} awaiting ranking` : undefined}
          links={[{ href: '/foundry/pitches', label: 'Pitches board' }]}>
          <div className="nd-counts">
            {PITCH_STATES.filter((s) => pitchCounts[s]).map((s) => (
              <Link key={s} href={s === 'pitched' ? '/foundry/pitches' : `/foundry/pitches?tab=${s}`} className="nd-count">
                <b>{pitchCounts[s]}</b> {PITCH_LABEL[s]}
              </Link>
            ))}
          </div>
          <ul className="nd-list">
            {topPitches.map((p) => (
              <li key={p.id} className="nd-row">
                <div className="nd-row-main">
                  <Link href={p.state === 'pitched' ? '/foundry/pitches' : `/foundry/pitches?tab=${p.state}`} className="nd-row-title">{p.headline}</Link>
                  <span className="nd-meta">{PITCH_LABEL[p.state] ?? p.state}{p.rank_value != null ? ` · rank ${p.rank_value}` : ''} · {timeAgo(p.first_seen, now)}</span>
                </div>
              </li>
            ))}
          </ul>
          {pitches.rows && !topPitches.length && <p className="nd-empty">Nothing pitched or approved.</p>}
        </Panel>

        <Panel title="Stories" missing={!drafts.rows && !published.rows}
          status={`${draftRows.length} draft${draftRows.length === 1 ? '' : 's'} · ${revisionRows.length} revision${revisionRows.length === 1 ? '' : 's'}`}
          links={[{ href: '/foundry/desk', label: 'Desk' }, { href: '/foundry/make', label: 'Make' }]}>
          <ul className="nd-list">
            {draftRows.slice(0, 4).map((s) => (
              <li key={s.slug} className="nd-row">
                <div className="nd-row-main">
                  <span className="nd-label">Draft</span>
                  <Link href={`/foundry/desk/${s.slug}`} className="nd-row-title">{s.title}</Link>
                  <span className="nd-meta">{s.check_hash ? 'passed check' : 'not yet passed'} · {timeAgo(s.updated_at, now)}</span>
                </div>
              </li>
            ))}
            {(published.rows ?? []).map((s) => (
              <li key={s.slug} className="nd-row">
                <div className="nd-row-main">
                  <Link href={`/foundry/desk/${s.slug}`} className="nd-row-title">{s.title}</Link>
                  <span className="nd-meta">Published {s.published} · <Link href={`/stories/${s.slug}`}>read</Link></span>
                </div>
              </li>
            ))}
          </ul>
          <div className="nd-quick">
            <Link href="/foundry/make" className="nd-btn">Article</Link>
            <Link href="/foundry/make" className="nd-btn nd-btn--quiet">Graphic</Link>
            <Link href="/foundry/make" className="nd-btn nd-btn--quiet">Race video</Link>
          </div>
        </Panel>

        <Panel title="Indices" status="Build and inspect" links={[{ href: IX.home, label: 'Caveat Indices' }]}>
          <ul className="nd-list nd-list--links">
            <li><Link href="/foundry/make">Make a graphic or race video</Link></li>
            <li><Link href="/foundry/work">Research a new index</Link></li>
            <li><Link href={IX.economy}>Economy dashboard</Link></li>
            <li><Link href={IX.qol}>Quality of life</Link></li>
            <li><Link href={IX.sentiment}>Sentiment and polls</Link></li>
            <li><Link href={IX.population}>Population</Link></li>
            <li><Link href={IX.pnl}>Australia Inc P&amp;L</Link></li>
            <li><Link href={IX.visuals}>Visuals</Link></li>
          </ul>
        </Panel>

        <Panel title="Calendar" missing={!calendar.rows}
          status={calendar.rows ? `${calendar.rows.length} in the next 14 days` : undefined}>
          <ul className="nd-list">
            {(calendar.rows ?? []).map((e) => (
              <li key={e.event_id} className="nd-row">
                <div className="nd-row-main">
                  {e.source_url
                    ? <a href={e.source_url} target="_blank" rel="noreferrer" className="nd-row-title">{e.title}</a>
                    : <span className="nd-row-title">{e.title}</span>}
                  <span className="nd-meta">{e.institution} · {sydneyWhen(e.scheduled_at)} · {timeAgo(e.scheduled_at, now)}</span>
                </div>
              </li>
            ))}
          </ul>
          {calendar.rows && !calendar.rows.length && <p className="nd-empty">No releases scheduled in the next 14 days.</p>}
        </Panel>

        <Panel title="Feeds health" missing={!health}
          status={health ? `${health.active} active · ${health.failing} failing · ${health.neverFetched} never fetched` : undefined}>
          {health && (
            <>
              <p className="nd-meta">Last fetch {health.lastFetched ? timeAgo(health.lastFetched, now) : 'never'}{health.stale ? ` · ${health.stale} stale (36h+)` : ''}</p>
              {health.problems.length === 0
                ? <p className="nd-empty">Every active feed is fetching.</p>
                : (
                  <ul className="nd-list">
                    {health.problems.slice(0, 8).map(({ feed, reason }) => (
                      <li key={feed.feed_id} className="nd-row">
                        <div className="nd-row-main">
                          <span className={reason === 'failing' ? 'nd-label is-bad' : 'nd-label'}>{reason}{reason === 'failing' ? ` · ${feed.error_count} errors` : ''}</span>
                          <a href={feed.url} target="_blank" rel="noreferrer" className="nd-row-title">{feed.name || feed.publisher || hostOf(feed.url)}</a>
                          <span className="nd-meta">{feed.last_fetched ? `fetched ${timeAgo(feed.last_fetched, now)}` : 'never fetched'}{feed.beat ? ` · ${feed.beat.replace(/_/g, ' ')}` : ''}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </>
          )}
        </Panel>

        <Panel title="Australia Inc & The Rub" status={bl ? `Bottom Line: ${bl.status}` : undefined}
          links={[{ href: '/australia-inc', label: 'Australia Inc' }, { href: '/foundry/rub', label: 'The Rub' }]}>
          <ul className="nd-list">
            <li className="nd-row">
              <div className="nd-row-main">
                <span className={bl?.status === 'held' || bl?.status === 'missing' ? 'nd-label is-bad' : 'nd-label'}>Bottom Line · today</span>
                {bl
                  ? <Link href="/australia-inc" className="nd-row-title">{bl.row ? rowTitle(bl.row) : 'Not written yet'}</Link>
                  : <span className="nd-faint">Not set up yet</span>}
                {bl && <span className="nd-meta">{bl.status}{blIssues.length ? ` · ${blIssues.length} issue${blIssues.length === 1 ? '' : 's'}` : ''}{incNew.count ? ` · ${incNew.count} new commentary items` : ''}</span>}
              </div>
            </li>
            <li className="nd-row">
              <div className="nd-row-main">
                <span className={scHeld.count ? 'nd-label is-bad' : 'nd-label'}>Scorecard changes</span>
                {scLog.rows
                  ? <Link href="/australia-inc/scorecard" className="nd-row-title">{scLog.rows[0] ? scorecardChange(scLog.rows[0]) : 'No changes this week'}</Link>
                  : <span className="nd-faint">Not set up yet (migration 49)</span>}
                {scLog.rows && <span className="nd-meta">{scLog.count ?? scLog.rows.length} this week{scHeld.count ? ` · ${scHeld.count} held by the check` : ''}</span>}
              </div>
            </li>
            <li className="nd-row">
              <div className="nd-row-main">
                <span className={rubPending.length ? 'nd-label is-bad' : 'nd-label'}>The Rub</span>
                {rubRows
                  ? <Link href="/foundry/rub" className="nd-row-title">{rubLatest ? rowTitle(rubLatest) : 'No columns yet'}</Link>
                  : <span className="nd-faint">Not set up yet</span>}
                {rubRows && <span className="nd-meta">{rubLatest ? `${rubLatest.status} · ${timeAgo(rowTime(rubLatest), now)} · ` : ''}{rubPending.length} pending</span>}
              </div>
            </li>
          </ul>
        </Panel>
      </div>
    </main>
  );
}

/** One scorecard log line: "housing-accord…: rating on track -> behind". */
function scorecardChange(r: Row): string {
  const what = r.kind === 'rating' ? 'rating' : r.kind;
  const move = r.from_value || r.to_value ? `: ${r.from_value ?? 'none'} -> ${r.to_value ?? 'none'}` : '';
  return `${r.slug} ${what}${r.kind === 'rating' || r.kind === 'held' || r.kind === 'activated' ? move : ''}`.slice(0, 140);
}

function PanelHead({ id, title, status }: { id?: string; title: string; status?: string }) {
  return (
    <div className="nd-panel-head">
      <h2 id={id} className="nd-panel-title">{title}</h2>
      {status && <span className="nd-status">{status}</span>}
    </div>
  );
}

function Panel({ title, status, links = [], missing = false, children }: {
  title: string; status?: string; links?: Array<{ href: string; label: string }>; missing?: boolean; children?: ReactNode;
}) {
  return (
    <section className="nd-panel">
      <PanelHead title={title} status={missing ? 'not set up yet' : status} />
      <div className="nd-panel-body">
        {missing ? <p className="nd-empty">Nothing to show: the data isn&apos;t available yet.</p> : children}
      </div>
      {links.length > 0 && (
        <div className="nd-panel-foot">
          {links.map((l) => <Link key={l.href + l.label} href={l.href} className="nd-go">{l.label} →</Link>)}
        </div>
      )}
    </section>
  );
}

function Chip({ href, n, label }: { href: string; n: number | null; label: string }) {
  if (n == null) return null;
  return (
    <Link href={href} className={n > 0 ? 'nd-chip is-on' : 'nd-chip'}>
      <b>{n}</b> {label}
    </Link>
  );
}
