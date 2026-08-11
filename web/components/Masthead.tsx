import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Stories' },
  { href: '/indices', label: 'Indices' },
  { href: '/methodology', label: 'Method' },
  { href: '/studio', label: 'Studio' },
  { href: '/studio/ask', label: 'Ask' },
  { href: '/account', label: 'Account' },
] as const;

export default function Masthead() {
  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <div>
          <Link href="/" className="wordmark">Caveat</Link>
          <div className="lector">Caveat lector · let the reader beware</div>
        </div>
        <nav className="nav">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
