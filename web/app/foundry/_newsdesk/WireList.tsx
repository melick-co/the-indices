'use client';

import { useState, useTransition } from 'react';
import { curate } from '../actions';

export type WireItem = {
  item_id: string; title: string; link: string | null; publisher: string; ago: string;
  curated: boolean; beat: string | null; status: string;
};

/** The latest wire items with the home-ticker toggle (the same curate action as the Pitches board) and a beat filter. */
export default function WireList({ items, beatItems, hasBeat }: { items: WireItem[]; beatItems: WireItem[]; hasBeat: boolean }) {
  const [beat, setBeat] = useState(false);
  const [curated, setCurated] = useState<Record<string, boolean>>(
    () => Object.fromEntries([...items, ...beatItems].map((i) => [i.item_id, i.curated])),
  );
  const [pending, start] = useTransition();
  const shown = beat ? beatItems : items;

  function toggle(id: string, on: boolean) {
    setCurated((c) => ({ ...c, [id]: on }));
    start(() => { curate(id, on).catch(() => setCurated((c) => ({ ...c, [id]: !on }))); });
  }

  return (
    <>
      {hasBeat && (
        <div className="nd-chips" role="group" aria-label="Filter the wire">
          <button type="button" className={beat ? 'nd-chip' : 'nd-chip is-on'} onClick={() => setBeat(false)}>All feeds</button>
          <button type="button" className={beat ? 'nd-chip is-on' : 'nd-chip'} onClick={() => setBeat(true)}>
            Australia Inc <span className="nd-chip-n">{beatItems.length}</span>
          </button>
        </div>
      )}
      {shown.length === 0
        ? <p className="nd-empty">{beat ? 'Nothing on the Australia Inc beat yet.' : 'The wire is quiet.'}</p>
        : (
          <ul className="nd-list">
            {shown.map((i) => (
              <li key={i.item_id} className="nd-row nd-row--wire">
                <label className="nd-tick" title="Show on the home-page ticker">
                  <input type="checkbox" checked={!!curated[i.item_id]} disabled={pending}
                    onChange={(e) => toggle(i.item_id, e.target.checked)} />
                  <span className="nd-sr">On the home ticker</span>
                </label>
                <div className="nd-row-main">
                  {i.link
                    ? <a href={i.link} target="_blank" rel="noreferrer" className="nd-row-title">{i.title}</a>
                    : <span className="nd-row-title">{i.title}</span>}
                  <span className="nd-meta">
                    {i.publisher}{i.ago ? ` · ${i.ago}` : ''}
                    {i.status !== 'fetched' ? ` · ${i.status.replace(/_/g, ' ')}` : ''}
                    {curated[i.item_id] ? ' · on ticker' : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
