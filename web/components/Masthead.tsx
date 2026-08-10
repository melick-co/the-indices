import Link from 'next/link';
import { getProfile } from '@/lib/auth';

export default async function Masthead() {
  let profile = null;
  try { profile = await getProfile(); } catch { /* public pages render signed out */ }
  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <div>
          <Link href="/" className="wordmark">Caveat</Link>
          <div className="lector">Caveat lector · let the reader beware</div>
        </div>
        <nav className="nav">
          <Link href="/">Stories</Link>
          <Link href="/indices">Indices</Link>
          <Link href="/methodology">Method</Link>
          {profile?.role === 'admin' && <Link href="/studio" style={{ color: 'var(--pen)' }}>Studio</Link>}
          {profile && profile.role !== 'admin' && <Link href="/account">Account</Link>}
          {!profile && <Link href="/login">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}
