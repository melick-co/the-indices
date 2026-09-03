import Link from 'next/link';
import HeroFlip from '@/components/HeroFlip';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import Ticker from '@/components/Ticker';
import IndexDash from '@/components/IndexDash';
import IndicatorDash from '@/components/IndicatorDash';
import { STORIES } from '@/content/stories';
import { loadTrendingPage } from '@/lib/trending-topics';
import { buildTrendIndex, sortStoriesByTrend } from '@/lib/trend-weight';

export const revalidate = 900;   // ticker refreshes every 15 minutes

export default async function Home() {
  const trendingData = await loadTrendingPage();
  const stories = sortStoriesByTrend(STORIES, buildTrendIndex(trendingData));

  return (
    <>
      <main>
        <Ticker />
        <HeroFlip />
        <h2 className="section-head">Stories</h2>
        <div className="cards">
            {stories.map((s) => (
              <Link key={s.slug} href={`/stories/${s.slug}`} className="card">
                <div className="card-kicker">{s.kicker}</div>
                <h3 className="card-title">{s.title}</h3>
                <p className="card-hook">{s.hook}</p>
                <div className="card-caveat">
                  <b>Caveat</b>
                  {s.caveat}
                </div>
              </Link>
            ))}
        </div>
        <IndexDash />
        <IndicatorDash />
        <Capture />
      </main>
      <SiteFooter />
    </>
  );
}
