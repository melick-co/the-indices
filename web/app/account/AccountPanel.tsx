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
    <div className="acct ops-card">
      <h2 className="section-head">What you get</h2>
      <p className="measure">
        Stories, indices, methodology and every source are public and always will be.
        Registering adds alerts: a note when an index publishes a new vintage, when a
        story goes out, or when we cover a topic you follow. No daily digest.
      </p>

      <h2 className="section-head">Alerts</h2>
      <div className="acct-row">
        <span>New index vintages</span>
        <input type="checkbox" checked={indices} onChange={(e) => setIndices(e.target.checked)} />
      </div>
      <div className="acct-row">
        <span>New stories</span>
        <input type="checkbox" checked={stories} onChange={(e) => setStories(e.target.checked)} />
      </div>

      <h2 className="section-head">Topics you follow</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
        {topics.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)} className={alertTopics.includes(t) ? 'studio-tab is-active' : 'studio-tab'}>
            {t}
          </button>
        ))}
        {!topics.length && <span className="measure">No topics published yet.</span>}
      </div>

      <h2 className="section-head">Display name</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional"
        className="studio-field" />

      <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="studio-btn-accent" disabled={pending} onClick={() => start(async () => {
          await updatePreferences({ display_name: name, alert_topics: alertTopics,
            alert_indices: indices, alert_stories: stories });
          setSaved(true);
        })}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="measure">Saved.</span>}
        <button type="button" className="studio-link" onClick={() => start(async () => { await signOut(); })}>
          Sign out
        </button>
      </div>
    </div>
  );
}
