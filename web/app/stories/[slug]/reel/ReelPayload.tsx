'use client';

import { useState } from 'react';

/**
 * The two shapes a video generator is likely to want: the structured scene list for anything
 * driven by an API, and the flat shot list for anything that takes a single prompt.
 */
export default function ReelPayload({ json, shotList }: { json: string; shotList: string }) {
  const [tab, setTab] = useState<'json' | 'shots'>('json');
  const [copied, setCopied] = useState<string | null>(null);
  const body = tab === 'json' ? json : shotList;

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied('Copied');
    } catch {
      setCopied('Copy failed, select and copy by hand');
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section className="reel-payload">
      <div className="reel-payload-head">
        <div className="reel-tabs">
          <button
            type="button"
            className={`reel-tab${tab === 'json' ? ' reel-tab-on' : ''}`}
            onClick={() => setTab('json')}
          >
            Scene JSON
          </button>
          <button
            type="button"
            className={`reel-tab${tab === 'shots' ? ' reel-tab-on' : ''}`}
            onClick={() => setTab('shots')}
          >
            Shot list
          </button>
        </div>
        <button type="button" className="reel-copy" onClick={copy}>
          {copied ?? 'Copy'}
        </button>
      </div>
      <pre className="reel-code">{body}</pre>
    </section>
  );
}
