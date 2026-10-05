'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export type TileGroup = { key: string; title: string; href: string; linkLabel: string; tiles: { id: string; node: React.ReactNode }[] };

/**
 * The home page grid: small tiles grouped by dashboard. Clicking a tile opens its detail below the grid (rendered on
 * the server with the page, so it opens instantly); the open tile is kept in the address (?tile=) for sharing.
 */
export default function TileBoard({ groups, details, initial }: { groups: TileGroup[]; details: Record<string, React.ReactNode>; initial: string | null }) {
  const [active, setActive] = useState<string | null>(initial && details[initial] ? initial : null);
  const panel = useRef<HTMLDivElement | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (active) url.searchParams.set('tile', active); else url.searchParams.delete('tile');
    window.history.replaceState(null, '', url);
    // Bring the detail into view when a tile is opened (not on first load unless the link named a tile).
    if (active && (!first.current || initial)) panel.current?.scrollIntoView({ behavior: first.current ? 'auto' : 'smooth', block: 'start' });
    first.current = false;
  }, [active, initial]);

  const label = (id: string) => groups.flatMap((g) => g.tiles).find((t) => t.id === id);
  return (
    <>
      <div className="ix-groups">
        {groups.map((g) => (
          <section key={g.key} className="ix-group" aria-labelledby={`ix-g-${g.key}`}>
            <div className="ix-group-head">
              <h2 id={`ix-g-${g.key}`}>{g.title}</h2>
              <Link href={g.href} className="ix-group-link">{g.linkLabel} →</Link>
            </div>
            <div className="ix-tiles">
              {g.tiles.map((t) => (
                <button key={t.id} type="button" className={`ix-tile${active === t.id ? ' is-active' : ''}`}
                  aria-expanded={active === t.id} aria-controls="ix-detail" onClick={() => setActive(active === t.id ? null : t.id)}>
                  {t.node}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div id="ix-detail" ref={panel} className="ix-detail" hidden={!active}>
        {active && label(active) && (
          <>
            <div className="ix-detail-bar">
              <span>Detail</span>
              <button type="button" className="ix-detail-close" onClick={() => setActive(null)}>Close ✕</button>
            </div>
            {details[active]}
          </>
        )}
      </div>
    </>
  );
}
