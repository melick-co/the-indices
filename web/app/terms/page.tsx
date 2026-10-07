import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';

export const metadata = { title: 'Terms of use — Caveat', description: 'The terms for using The Caveat and Caveat Indices.' };

const UPDATED = '8 October 2026';

export default function Terms() {
  return (
    <>
      <main className="article">
        <h1>Terms of use</h1>
        <div className="byline">The Caveat and Caveat Indices · Last updated {UPDATED}</div>

        <h2>What this is</h2>
        <p className="measure">
          The Caveat and Caveat Indices publish journalism, dashboards, graphics and videos built from official data.
          Every figure names its source; how we work is set out in our <Link href="/methodology">method</Link>.
        </p>

        <h2>Not advice</h2>
        <p>Nothing here is financial, investment, legal or other professional advice. Check the original source before
          relying on a figure, and get advice for your own circumstances.</p>

        <h2>Accuracy</h2>
        <p>We check every number against its source before publishing and correct mistakes openly. Data is shown as the
          source published it and can be revised by that source. We provide the site as it is, without any promise that
          it is complete, current or free of errors.</p>

        <h2>Using our work</h2>
        <p>You may link to and quote our articles and share our graphics and videos with credit to The Caveat or Caveat
          Indices and a link back. The underlying data belongs to its publishers and is subject to their terms.</p>

        <h2>Our videos on YouTube</h2>
        <p>Our videos on YouTube are also subject to the{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>. How we
          use the YouTube API Services is described in our <Link href="/privacy">privacy policy</Link>.</p>

        <h2>Changes</h2>
        <p>We may update these terms; the date above shows when they last changed.</p>
      </main>
      <SiteFooter />
    </>
  );
}
