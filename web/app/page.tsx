import Link from 'next/link';
import Masthead from '@/components/Masthead';
import HeroFlip from '@/components/HeroFlip';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import Ticker from '@/components/Ticker';
import IndexDash from '@/components/IndexDash';
import { STORIES } from '@/content/stories';

export const revalidate = 900;   // ticker refreshes every 15 minutes

export default async function Home() {
  return (
    <>
      <Masthead />
      <main>
        <Ticker />
        <HeroFlip />
        <div className="wrap">
          <h2 className="section-head">Stories</h2>
          <div className="cards">
            {STORIES.map((s) => (
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
        </div>
        <div className="wrap"><IndexDash /></div>
        <Capture />
      </main>
      <SiteFooter />
    </>
  );
}
