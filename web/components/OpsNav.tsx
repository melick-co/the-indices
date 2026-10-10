'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The Foundry: one tool, five tabs (Studio and Brainstorm were folded in; their old links redirect here). */
const PRIMARY = [
  { href: '/foundry/make', label: 'Make' },
  { href: '/foundry', label: 'Pitches' },
  { href: '/foundry/work', label: 'Research' },
  { href: '/foundry/desk', label: 'Desk' },
  { href: '/foundry/queue', label: 'Queue' },
  { href: '/indices', label: 'Caveat Indices' },
] as const;

const SECONDARY = [
  { href: '/account', label: 'Account' },
  { href: '/', label: "Today's paper" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return false;
  if (href === '/foundry') {
    return pathname === '/foundry' || (pathname.startsWith('/foundry/')
      && !pathname.startsWith('/foundry/desk')
      && !pathname.startsWith('/foundry/work')
      && !pathname.startsWith('/foundry/queue')
      && !pathname.startsWith('/foundry/make'));
  }
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
