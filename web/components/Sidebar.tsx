'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The broadsheet's sections: the reader's navigation, set as tracked capitals between hairlines. */
const SECTIONS = [
  { href: '/', label: 'Today' },
  { href: '/explainers', label: 'Explainers' },
  { href: '/the-rub', label: 'The Rub' },
  { href: '/indices', label: 'Caveat Indices' },
  { href: '/instruments', label: 'Instruments' },
  { href: '/trending', label: 'Trending' },
  { href: '/methodology', label: 'Method' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The broadsheet masthead: a white utility bar (the one yellow button on the page is Subscribe), the wordmark on the
 * cream page between the edition flag and the motto, then the section row. Desk tools sit behind "Newsroom"
 * (the Foundry pages have their own navigation).
 */
export default function Sidebar() {
  const pathname = usePathname();
  // Sydney's date, on the server and in the browser alike. Without a time zone the server (UTC) and a reader's
  // browser disagree for much of the day, and the mismatch makes React abandon hydration for the whole page.
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  return (
    <header className="bs-head">
      <div className="bs-util">
        <div className="bs-util-inner">
          <nav className="bs-util-links" aria-label="Sections">
            <Link href="/explainers">Explainers</Link>
            <Link href="/indices">Indices</Link>
            <Link href="/methodology">Method</Link>
          </nav>
          <div className="bs-util-right">
            <Link href="/foundry" className="bs-util-quiet">Newsroom</Link>
            <Link href="/account">Account</Link>
            <Link href="/#subscribe" className="bs-subscribe">Subscribe</Link>
          </div>
        </div>
      </div>
      <div className="bs-mast">
        <div className="bs-flag">
          <span>{today}</span>
          <span>Australian edition</span>
        </div>
        <Link href="/" className="bs-wordmark" aria-label="The Caveat, home">The Caveat</Link>
        <div className="bs-motto">
          <span>Caveat lector.</span>
          <span>The detail that changes the story.</span>
        </div>
      </div>
      <nav className="bs-nav" aria-label="Primary">
        {SECTIONS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
