import Link from 'next/link';

export default function Masthead() {
  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <div>
          <Link href="/" className="wordmark">Caveat</Link>
          <div className="lector">Caveat lector · let the reader beware</div>
        </div>
        <nav className="nav">
          <Link href="/">Stories</Link>
          <Link href="/methodology">Method</Link>
        </nav>
      </div>
    </header>
  );
}
