'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Stories' },
  { href: '/indices', label: 'Indices' },
  { href: '/indicators', label: 'Indicators' },
  { href: '/trending', label: 'Trending' },
  { href: '/methodology', label: 'Method' },
  { href: '/foundry', label: 'Foundry' },
  { href: '/foundry/work', label: 'Work' },
  { href: '/account', label: 'Account' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="site-sidebar">
      <div>
        <Link href="/" className="wordmark">caveat</Link>
        <div className="lector">Caveat lector</div>
      </div>
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
    </aside>
  );
}
