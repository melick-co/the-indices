'use client';
import { useState, useTransition } from 'react';
import { updatePreferences, signOut } from './actions';
import type { Profile } from '@/lib/auth';

export default function AccountPanel({ profile, topics }:
  { profile: Profile; topics: string[] }) {
  const [name, setName] = useState(profile.display_name ?? '');
  const [alertTopics, setAlertTopics] = useState<string[]>(profile.alert_topics ?? []);
  const [indices, setIndices] = useState(profile.alert_indices);
  const [stories, setStories] = useState(profile.alert_stories);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const toggle = (t: string) =>
    setAlertTopics((a) => a.includes(t) ? a.filter((x) => x !== t) : [...a, t]);

  return (
    <div className="acct">
      <h2>What you get</h2>
      <p className="measure">
        Stories, indices, methodology and every source are public and always will be.
        Registering adds alerts: a note when an index publishes a new vintage, when a
        story goes out, or when we cover a topic you follow. No daily digest.
      </p>

      <h2>Alerts</h2>
      <div className="acct-row">
        <span>New index vintages</span>
        <input type="checkbox" checked={indices} onChange={(e) => setIndices(e.target.checked)} />
      </div>
      <div className="acct-row">
        <span>New stories</span>
        <input type="checkbox" checked={stories} onChange={(e) => setStories(e.target.checked)} />
      </div>

      <h2>Topics you follow</h2>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', margin: '.6rem 0 1rem' }}>
        {topics.map((t) => (
          <button key={t} onClick={() => toggle(t)} style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '.7rem', padding: '.35rem .7rem',
            cursor: 'pointer', borderRadius: 0,
            border: `1px solid ${alertTopics.includes(t) ? 'var(--ink)' : 'var(--rule)'}`,
            background: alertTopics.includes(t) ? 'var(--ink)' : 'transparent',
            color: alertTopics.includes(t) ? 'var(--paper)' : 'var(--ink-soft)',
          }}>{t}</button>
        ))}
        {!topics.length && <span className="note">No topics published yet.</span>}
      </div>

      <h2>Display name</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional"
        style={{ width: '100%', padding: '.6rem', border: '1px solid var(--rule)',
          background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.85rem' }} />

      <div style={{ display: 'flex', gap: '.6rem', marginTop: '1.2rem', alignItems: 'center' }}>
        <button disabled={pending} onClick={() => start(async () => {
          await updatePreferences({ display_name: name, alert_topics: alertTopics,
            alert_indices: indices, alert_stories: stories });
          setSaved(true);
        })} style={{ padding: '.6rem 1.2rem', background: 'var(--ink)', color: 'var(--paper)',
          border: 'none', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.75rem',
          letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="note" style={{ color: 'var(--verify)' }}>Saved.</span>}
        <button onClick={() => start(async () => { await signOut(); })} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '.72rem',
          letterSpacing: '.08em', textTransform: 'uppercase' }}>Sign out</button>
      </div>
    </div>
  );
}
