'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The Foundry: the Newsdesk dashboard first, then the desks it links into (Studio and Brainstorm were folded in; their old links redirect here). */
const PRIMARY = [
  { href: '/foundry', label: 'Newsdesk' },
  { href: '/foundry/pitches', label: 'Pitches' },
  { href: '/foundry/make', label: 'Make' },
  { href: '/foundry/work', label: 'Research' },
  { href: '/foundry/desk', label: 'Desk' },
  { href: '/foundry/queue', label: 'Queue' },
  { href: '/foundry/rub', label: 'The Rub' },
  { href: '/indices', label: 'Caveat Indices' },
] as const;

const SECONDARY = [
  { href: '/account', label: 'Account' },
  { href: '/', label: "Today's paper" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return false;
  // The Newsdesk is only itself; every desk under /foundry has its own tab.
  if (href === '/foundry') return pathname === '/foundry';
  if (href === '/indices') {
    return pathname === '/indices' || pathname.startsWith('/indices/')
      || pathname === '/metrics' || pathname.startsWith('/metrics/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function OpsNav() {
  const pathname = usePathname();

  return (
    <aside className="ops-nav" aria-label="Desk">
      <Link href="/foundry" className="ops-brand">Caveat</Link>
      <p className="ops-brand-kicker">Desk</p>
      <nav className="ops-nav-links">
        {PRIMARY.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={isActive(pathname, l.href) ? 'ops-nav-link is-active' : 'ops-nav-link'}
            aria-current={isActive(pathname, l.href) ? 'page' : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ops-nav-foot">
        {SECONDARY.map((l) => (
          <Link key={l.href} href={l.href} className="ops-nav-quiet">
            {l.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
