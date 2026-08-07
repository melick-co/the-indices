import Link from 'next/link';
import Masthead from '@/components/Masthead';
import HeroFlip from '@/components/HeroFlip';
import Capture from '@/components/Capture';
import SiteFooter from '@/components/SiteFooter';
import { STORIES } from '@/content/stories';

export default function Home() {
  return (
    <>
      <Masthead />
      <main>
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
        <Capture />
      </main>
      <SiteFooter />
    </>
  );
}
