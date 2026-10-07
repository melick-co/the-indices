import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';

export const metadata = { title: 'Privacy — Caveat', description: 'What Caveat and Caveat Indices collect, why, and how to have it removed.' };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
const UPDATED = '8 October 2026';

export default function Privacy() {
  return (
    <>
      <main className="article">
        <h1>Privacy</h1>
        <div className="byline">The Caveat and Caveat Indices · Last updated {UPDATED}</div>

        <p className="measure">
          You can read everything on The Caveat and Caveat Indices without an account. We collect very little, and only
          to run the site. We do not sell personal information, show advertising, or use analytics or advertising
          trackers.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Your email address, if you sign up for email or sign in.</strong> Sign-up addresses are kept in
            our email provider&apos;s list (Resend) so we can send what you asked for. Sign-in uses a one-time link sent
            to your email; your account (email address and role) is kept in our database (Supabase).</li>
          <li><strong>A sign-in cookie</strong>, only if you sign in, so the site knows it is you. There are no other
            cookies.</li>
          <li><strong>Server logs.</strong> Our host (Vercel) records requests, including IP address and browser, for
            security and to keep the site running.</li>
        </ul>

        <h2>How we use it</h2>
        <p>Only to send the email you signed up for, to let you sign in, and to keep the site secure and working. We
          do not share it with anyone except the providers named here, who process it for us.</p>

        <h2>YouTube</h2>
        <p>
          Caveat Indices publishes its data videos to its own YouTube channel using the YouTube API Services. It uses
          them only to upload and schedule videos on that channel. It does not read, collect or store information about
          YouTube viewers or any other YouTube user. If you watch our videos on YouTube, YouTube&apos;s own terms apply:
          the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a> and
          the <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>.
          The channel owner can withdraw this site&apos;s access at any time from{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google account permissions</a>.
        </p>

        <h2>How long we keep it</h2>
        <p>Email addresses until you unsubscribe or ask us to delete them. Accounts until you ask us to close them.
          Server logs for as long as our host keeps them.</p>

        <h2>Your choices</h2>
        <p>
          Every email has an unsubscribe link. To see, correct or delete what we hold about you, or to ask anything
          about this policy, {CONTACT ? <>email <a href={`mailto:${CONTACT}`}>{CONTACT}</a></> : 'contact us through the site'}.
        </p>

        <p className="measure" style={{ marginTop: '2rem' }}>See also the <Link href="/terms">terms of use</Link>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
