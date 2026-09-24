'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PRIMARY = [
  { href: '/foundry', label: 'Foundry' },
  { href: '/foundry/desk', label: 'Desk' },
  { href: '/foundry/work', label: 'Work' },
  { href: '/studio', label: 'Studio' },
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
      && !pathname.startsWith('/foundry/work'));
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
