'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/explainers', label: 'Explainers' },
  { href: '/the-rub', label: 'The Rub' },
  { href: '/indices', label: 'Indices' },
  { href: '/instruments', label: 'Instruments' },
  { href: '/markets', label: 'Markets' },
  { href: '/trending', label: 'Trending' },
  { href: '/methodology', label: 'Method' },
  { href: '/foundry', label: 'Foundry' },
  { href: '/foundry/desk', label: 'Desk' },
  { href: '/foundry/work', label: 'Work' },
  { href: '/account', label: 'Account' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/foundry') {
    return pathname === '/foundry' || (pathname.startsWith('/foundry/')
      && !pathname.startsWith('/foundry/desk')
      && !pathname.startsWith('/foundry/work'));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <header className="site-sidebar">
      <div className="mast-top">
        <div className="mast-meta mast-meta-left">
          <span>{today}</span>
          <span>Australia</span>
        </div>
        <Link href="/" className="wordmark">
          <span className="wordmark-the">The</span>
          Caveat
        </Link>
        <div className="mast-meta mast-meta-right">
          <span>Data journalism</span>
          <span>Checkable claims</span>
        </div>
      </div>
      <p className="lector">Caveat lector. The detail that changes the story.</p>
      <nav className="nav" aria-label="Primary">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(pathname, l.href) ? 'page' : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
