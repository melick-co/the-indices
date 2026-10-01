'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryTimelineBlock } from '@/lib/story-types';
import Footnoted from '@/components/Footnoted';

/** Sequence of dated events (NEWS-STYLE.md §4.1); events step in on scroll, static under reduced motion. */
export default function StoryTimeline({ block }: { block: StoryTimelineBlock }) {
  const ref = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <figure className="figure story-timeline" ref={ref} aria-label={block.title}>
      <div className="story-chart-title">{block.title}</div>
      {block.subtitle && <div className="story-chart-subtitle">{block.subtitle}</div>}
      <ol>
        {block.events.map((ev, i) => (
          <li key={i} className={seen ? 'shown' : ''} style={{ transitionDelay: `${Math.min(i * 180, 1200)}ms` }}>
            <span className="story-timeline-date">{ev.date}</span>
            <span className="story-timeline-label">
              <Footnoted text={ev.footnote ? `${ev.label}[^${ev.footnote}]` : ev.label} />
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
