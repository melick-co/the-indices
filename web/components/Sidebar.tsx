'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Stories' },
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
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <header className="site-sidebar">
      <div className="mast-bar">
        <Link href="/" className="wordmark">Caveat</Link>
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
        <div className="mast-meta">
          <span>{today}</span>
          <span>Australia</span>
        </div>
      </div>
      <p className="lector">Caveat lector · The detail that changes the story</p>
    </header>
  );
}
