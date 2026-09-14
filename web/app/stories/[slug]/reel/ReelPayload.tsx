'use client';

import { useState } from 'react';
import type { ReelPromptPack } from '@/lib/reel-types';

type Tab = 'json' | 'shots' | 'scenes';

/**
 * The shapes a video generator is likely to want: structured JSON, one flat shot list,
 * and a prompt per scene once the prompt stage has run.
 */
export default function ReelPayload({
  json,
  shotList,
  promptPack,
}: {
  json: string;
  shotList: string;
  promptPack?: ReelPromptPack | null;
}) {
  const tabs: { id: Tab; label: string; body: string }[] = [
    { id: 'json', label: 'Scene JSON', body: json },
    { id: 'shots', label: 'Shot list', body: shotList },
  ];
  if (promptPack?.scenes.length) {
    tabs.push({
      id: 'scenes',
      label: 'Scene prompts',
      body: promptPack.scenes
        .map((s, i) => `—— SHOT ${i + 1} / ${s.id} / ${s.kind} / ${s.seconds}s ——\n\n${s.prompt}`)
        .join('\n\n\n'),
    });
  }

  const [tab, setTab] = useState<Tab>(promptPack?.scenes.length ? 'scenes' : 'json');
  const [copied, setCopied] = useState<string | null>(null);
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.body);
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
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`reel-tab${tab === t.id ? ' reel-tab-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="reel-copy" onClick={copy}>
          {copied ?? 'Copy'}
        </button>
      </div>
      <pre className="reel-code">{active.body}</pre>
    </section>
  );
}
