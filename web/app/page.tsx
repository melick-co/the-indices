import HeroFlip from '@/components/HeroFlip';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import Ticker from '@/components/Ticker';
import IndexDash from '@/components/IndexDash';
import MarketsDash from '@/components/MarketsDash';
import StoryCard from '@/components/StoryCard';
import { loadAllStories } from '@/lib/stories-loader';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex, sortStoriesByTrend } from '@/lib/trend-weight';

export const revalidate = 900;   // ticker refreshes every 15 minutes

export default async function Home() {
  const [allStories, trendingData] = await Promise.all([
    loadAllStories(),
    loadTrendingPage(),
  ]);
  const trendIndex = buildTrendIndex(trendingData);
  const stories = sortStoriesByTrend(allStories, trendIndex);
  const frameChecks = sortStoriesByTrend(
    stories.filter((s) => s.frameCheck),
    trendIndex,
  );
  const otherStories = sortStoriesByTrend(
    stories.filter((s) => !s.frameCheck),
    trendIndex,
  );
  const heroStory = frameChecks[0] ?? null;

  return (
    <>
      <main>
        <Ticker />
        <HeroFlip story={heroStory} />

        {frameChecks.length > 0 && (
          <section className="home-section">
            <h2 className="section-head">Frame checks</h2>
            <p className="section-lede">
              Stories that correct a widely shared frame — denominator flips, rank
              surprises, and claim checks — with the objection printed next to the claim.
            </p>
            <div className="cards">
              {frameChecks.map((s) => (
                <StoryCard key={s.slug} story={s} />
              ))}
            </div>
          </section>
        )}

        {otherStories.length > 0 && (
          <section className="home-section">
            <h2 className="section-head">Stories</h2>
            <div className="cards">
              {otherStories.map((s) => (
                <StoryCard key={s.slug} story={s} />
              ))}
            </div>
          </section>
        )}

        {!frameChecks.length && !otherStories.length && (
          <section className="home-section">
            <h2 className="section-head">Stories</h2>
            <div className="cards">
              {stories.map((s) => (
                <StoryCard key={s.slug} story={s} />
              ))}
            </div>
          </section>
        )}

        <IndexDash />
        <MarketsDash />
        <Capture />
      </main>
      <SiteFooter />
    </>
  );
}
