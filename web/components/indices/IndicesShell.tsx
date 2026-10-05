'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IX } from '@/lib/indices-paths';

const NAV = [
  { href: IX.home, label: 'Overview', exact: true },
  { href: IX.economy, label: 'Economy' },
  { href: IX.qol, label: 'Quality of life' },
  { href: IX.sentiment, label: 'Sentiment & polls' },
  { href: IX.population, label: 'Population' },
  { href: IX.pnl, label: 'Australia Inc.' },
  { href: IX.visuals, label: 'Visuals' },
] as const;

/** The Indices' own chrome: masthead and section navigation, no newsroom or desk sidebar. */
export default function IndicesShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div className="site-shell site-shell--ops site-shell--ix">
      <header className="ix-mast">
        <div className="ix-mast-row">
          <Link href={IX.home} className="ix-brand">
            <span className="ix-mark" aria-hidden="true"><i /><i /><i /></span>
            The Indices
          </Link>
          <Link href="/" className="ix-by">by Caveat</Link>
        </div>
        <nav className="ix-nav" aria-label="The Indices">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`ix-nav-link${active(n.href, 'exact' in n && n.exact) ? ' is-active' : ''}`}>{n.label}</Link>
          ))}
        </nav>
      </header>
      <div className="site-main">{children}</div>
    </div>
  );
}
