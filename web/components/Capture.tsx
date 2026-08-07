'use client';
import { useState } from 'react';

export default function Capture() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (!email.includes('@')) return;
    try {
      await fetch('/api/subscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* capture is best-effort; never block the reader */ }
    setDone(true);
  }

  return (
    <section className="capture">
      <div className="wrap">
        <h2>One email when something doesn&rsquo;t add up.</h2>
        <p>
          No daily digest, no roundup. A story goes out when the data actually says
          something, with the sources attached. Unsubscribe in one click.
        </p>
        {done ? (
          <p style={{ color: 'var(--pen)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.85rem' }}>
            You&rsquo;re on the list. Just saying.
          </p>
        ) : (
          <div className="capture-form">
            <input
              type="email" value={email} placeholder="you@example.com"
              aria-label="Email address"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button onClick={submit}>Subscribe</button>
          </div>
        )}
      </div>
    </section>
  );
}
