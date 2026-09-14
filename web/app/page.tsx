import HeroFlip from '@/components/HeroFlip';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import Ticker from '@/components/Ticker';
import IndexDash from '@/components/IndexDash';
import MarketsDash from '@/components/MarketsDash';
import StoryCard from '@/components/StoryCard';
import { buildHomeLayout } from '@/lib/home-layout';
import { loadAllStories } from '@/lib/stories-loader';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex } from '@/lib/trend-weight';

export const revalidate = 900;   // ticker refreshes every 15 minutes

export default async function Home() {
  const [allStories, trendingData] = await Promise.all([
    loadAllStories(),
    loadTrendingPage(),
  ]);
  const trendIndex = buildTrendIndex(trendingData);
  const { hero, frameChecks, stories } = buildHomeLayout(allStories, trendIndex);

  return (
    <>
      <main>
        <Ticker />
        <HeroFlip story={hero} />

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

        {stories.length > 0 && (
          <section className="home-section">
            <h2 className="section-head">Stories</h2>
            <div className="cards">
              {stories.map((s) => (
                <StoryCard key={s.slug} story={s} />
              ))}
            </div>
          </section>
        )}

        {!frameChecks.length && !stories.length && (
          <section className="home-section">
            <h2 className="section-head">Stories</h2>
            <p className="section-lede">Nothing on the home page yet.</p>
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
