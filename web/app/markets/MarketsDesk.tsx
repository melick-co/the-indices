'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sparkline from '@/components/Sparkline';
import {
  formatChange,
  formatWatchValue,
  type MarketKind,
  type MarketWatch,
} from '@/lib/market-types';
import {
  addMarketWatch,
  dropMarketWatch,
  inspectSourceUrl,
  proposeMarketWatch,
  refreshMarketWatches,
  type InspectedSource,
} from './actions';

const KIND_LABEL: Record<MarketKind, string> = {
  bond: 'Bonds',
  equity: 'Equities',
  forex: 'Foreign exchange',
  other: 'Other series',
};

const KIND_BLURB: Record<MarketKind, string> = {
  bond: 'Sovereign 10-year yields. Australia is already in the data store; the rest are desk quotes.',
  equity: 'Benchmark indices. Scratch prints for the desk, not Caveat figures.',
  forex: 'AUD crosses against the majors. Spot quotes for tracking, not for headlines.',
  other: 'Anything else you are testing as a candidate source.',
};

export default function MarketsDesk({ watches }: { watches: MarketWatch[] }) {
  const byKind = useMemo(() => {
    const groups: Record<MarketKind, MarketWatch[]> = { bond: [], equity: [], forex: [], other: [] };
    for (const w of watches) groups[w.kind].push(w);
    return groups;
  }, [watches]);

  return (
    <>
      {(['bond', 'equity', 'forex', 'other'] as const).map((kind) => (
        byKind[kind].length > 0 && (
          <section key={kind} className="markets-section">
            <h2>{KIND_LABEL[kind]}</h2>
            <p className="measure markets-blurb">{KIND_BLURB[kind]}</p>
            <WatchTable watches={byKind[kind]} />
          </section>
        )
      ))}
      <SourceIntake />
    </>
  );
}

function WatchTable({ watches }: { watches: MarketWatch[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  function propose(id: string) {
    start(async () => {
      const r = await proposeMarketWatch(id);
      setNote(r.ok
        ? 'Proposed. It now sits on Foundry → source suggestions, waiting to be approved into the data store.'
        : r.error);
      if (r.ok) router.refresh();
    });
  }

  function drop(id: string) {
    start(async () => {
      const r = await dropMarketWatch(id);
      setNote(r.ok ? 'Dropped from the desk.' : r.error);
      if (r.ok) router.refresh();
    });
  }

  return (
    <>
      <table className="data readings-table markets-table">
        <thead>
          <tr>
            <th>Series</th>
            <th className="num">Latest</th>
            <th>As at</th>
            <th>Change</th>
            <th>History</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {watches.map((w) => (
            <tr key={w.watch_id}>
              <td>
                <div className="markets-label">{w.label}</div>
                <div className="markets-meta">
                  {w.org ?? w.provider}
                  {w.symbol ? ` · ${w.symbol}` : ''}
                  {w.source_url && (
                    <>
                      {' · '}
                      <a href={w.source_url} target="_blank" rel="noreferrer">source</a>
                    </>
                  )}
                </div>
              </td>
              <td className="num">
                {formatWatchValue(w)}
                {w.unit && w.unit !== 'percent' && w.unit !== 'index' && (
                  <span className="readings-unit"> {w.unit}</span>
                )}
              </td>
              <td className="readings-period">{w.last_period ?? '—'}</td>
              <td className={`readings-change${(w.last_change_pct ?? 0) > 0 ? ' up' : (w.last_change_pct ?? 0) < 0 ? ' down' : ''}`}>
                {formatChange(w.last_change_pct)}
              </td>
              <td>
                {w.history.length > 1
                  ? <Sparkline points={w.history} label={w.label} />
                  : <span className="markets-meta">—</span>}
              </td>
              <td>
                <span className={`markets-status markets-status-${w.status}`}>
                  {statusLabel(w)}
                </span>
              </td>
              <td className="markets-actions">
                {w.status !== 'proposed' && w.status !== 'in_store' && (
                  <button type="button" className="cc-link" disabled={pending}
                    onClick={() => propose(w.watch_id)}>
                    propose
                  </button>
                )}
                {!w.builtin && (
                  <button type="button" className="cc-link" disabled={pending}
                    onClick={() => drop(w.watch_id)}>
                    drop
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="markets-note">{note}</p>}
    </>
  );
}

function statusLabel(w: MarketWatch): string {
  if (w.status === 'in_store') return 'In the data store';
  if (w.status === 'proposed') return 'Proposed';
  return 'Watching';
}

function SourceIntake() {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [org, setOrg] = useState('');
  const [kind, setKind] = useState<MarketKind>('other');
  const [why, setWhy] = useState('');
  const [inspected, setInspected] = useState<InspectedSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function inspect() {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await inspectSourceUrl(url);
      if (!r.ok) {
        setInspected(null);
        setError(r.error);
        return;
      }
      setInspected(r.data);
      if (!label.trim()) setLabel(r.data.title.slice(0, 80));
    });
  }

  function add() {
    setError(null);
    start(async () => {
      const r = await addMarketWatch({
        kind,
        label: label || inspected?.title || url,
        url,
        org,
        why,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone('On the desk. Propose it when it is worth farming into the data store.');
      setUrl('');
      setLabel('');
      setOrg('');
      setWhy('');
      setInspected(null);
      router.refresh();
    });
  }

  function refresh() {
    start(async () => {
      await refreshMarketWatches();
      router.refresh();
    });
  }

  return (
    <section className="markets-section" id="source">
      <h2>Source a series</h2>
      <p className="measure markets-blurb">
        Paste a publisher URL, a CSV endpoint, or a statistical table. Inspect it here,
        watch the print, then propose it onto Foundry. Approval is what creates a{' '}
        <code>data_sources</code> row. Watching does not.
      </p>
      <div className="markets-form">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https:// — CSV, SDMX, HTML table, or publisher page"
          className="markets-input"
          aria-label="Source URL"
        />
        <div className="markets-form-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Series name"
            className="markets-input"
            aria-label="Series name"
          />
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Publisher"
            className="markets-input"
            aria-label="Publisher"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as MarketKind)}
            className="markets-input" aria-label="Kind">
            <option value="bond">Bond</option>
            <option value="equity">Equity</option>
            <option value="forex">Forex</option>
            <option value="other">Other</option>
          </select>
        </div>
        <textarea
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          rows={2}
          placeholder="Why this might belong in the data store"
          className="markets-input"
          aria-label="Why it belongs"
        />
        <div className="markets-form-actions">
          <button type="button" className="studio-btn-outline" disabled={pending || !url.trim()}
            onClick={inspect}>
            {pending ? 'Working…' : 'Inspect URL'}
          </button>
          <button type="button" className="btn-accent" disabled={pending || !url.trim()}
            onClick={add}>
            Watch this series
          </button>
          <button type="button" className="cc-link" disabled={pending} onClick={refresh}>
            refresh quotes
          </button>
        </div>
      </div>
      {inspected && (
        <div className="markets-inspect">
          <div className="markets-meta">{inspected.url}</div>
          <b>{inspected.title}</b>
          <p>{inspected.snippet}</p>
          {inspected.csvPoints > 0 && (
            <p className="markets-meta">
              Parsed {inspected.csvPoints} observations
              {inspected.samplePeriod && inspected.sampleValue != null
                ? ` · last ${inspected.sampleValue} on ${inspected.samplePeriod}`
                : ''}
            </p>
          )}
        </div>
      )}
      {error && <p className="markets-error">{error}</p>}
      {done && <p className="markets-note">{done}</p>}
      <p className="markets-blurb" style={{ marginTop: '1.4rem' }}>
        Proposed series appear on{' '}
        <Link href="/foundry">Foundry → source suggestions</Link>
        {' '}for approval. The RBA hike odds remain a derived series at{' '}
        <Link href="/markets/rba-rate-rise">RBA rate rise</Link>.
      </p>
    </section>
  );
}
