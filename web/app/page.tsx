import Link from 'next/link';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import Ticker from '@/components/Ticker';
import InstrumentsDash from '@/components/InstrumentsDash';
import MarketsDash from '@/components/MarketsDash';
import LeadStory from '@/components/LeadStory';
import HomeSecondaries from '@/components/HomeSecondaries';
import TheRub from '@/components/TheRub';
import ExplainerTeaser from '@/components/ExplainerTeaser';
import IndexAgate from '@/components/IndexAgate';
import { buildHomeLayout } from '@/lib/home-layout';
import { loadAllStories } from '@/lib/stories-loader';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex } from '@/lib/trend-weight';
import { pickRub } from '@/lib/the-rub';
import { pickExplainer } from '@/lib/explainers';

export const revalidate = 900;

export default async function Home() {
  const [allStories, trendingData] = await Promise.all([
    loadAllStories(),
    loadTrendingPage(),
  ]);
  const trendIndex = buildTrendIndex(trendingData);
  const { hero, rest } = buildHomeLayout(allStories, trendIndex);
  const secondaries = rest.slice(0, 3);
  const more = rest.slice(3, 7);
  const rub = pickRub(trendingData);
  const explainer = pickExplainer();

  return (
    <>
      <main className="broadsheet">
        <Ticker />

        <div className="sheet-row sheet-row-lead">
          {hero ? (
            <LeadStory story={hero} wide={!secondaries.length} />
          ) : (
            <article className={secondaries.length ? 'lead' : 'lead lead-wide'}>
              <p className="lead-kicker">The Caveat</p>
              <h1 className="lead-headline">Nothing on the page yet.</h1>
              <p className="lead-deck">
                When a story clears the desk it will sit here, with the number
                that carries it and the objection printed underneath.
              </p>
            </article>
          )}
          <HomeSecondaries stories={secondaries} />
          <TheRub selection={rub} />
        </div>

        <IndexAgate />

        <div className="sheet-row sheet-row-below">
          <div className="sheet-more">
            {more.map((story) => (
              <article key={story.slug} className="brief brief-wide">
                <p className="brief-kicker">{story.kicker}</p>
                <h2 className="brief-headline">
                  <Link href={`/stories/${story.slug}`}>{story.title}</Link>
                </h2>
                <p className="brief-deck">{story.hook}</p>
              </article>
            ))}
          </div>
          <ExplainerTeaser explainer={explainer} />
        </div>

        <InstrumentsDash />
        <MarketsDash />
        <Capture />
      </main>
      <SiteFooter />
    </>
  );
}
