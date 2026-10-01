'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryOneNumber } from '@/lib/story-types';

/**
 * Hero graphic (NEWS-STYLE.md §2.3, §4.2): the story's one number as a stat
 * card with its year-on-year comparison, both computed from stored data. The
 * figure counts up once it scrolls into view; reduced motion shows it static.
 */
export default function HeroStat({ one }: { one: StoryOneNumber }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const match = one.value.match(/^(-?[\d,]*\.?\d+)(.*)$/);
  const target = match ? Number(match[1].replace(/,/g, '')) : NaN;
  const decimals = match?.[1].split('.')[1]?.length ?? 0;
  const [shown, setShown] = useState(Number.isFinite(target) ? 0 : NaN);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const el = ref.current;
    const finish = () => setShown(target);
    if (!el || typeof IntersectionObserver === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / 1200);
        setShown(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [target]);

  const value = Number.isFinite(shown)
    ? `${shown.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${match?.[2] ?? ''}`
    : one.value;
  const arrow = one.direction === 'up' ? '▲' : one.direction === 'down' ? '▼' : '';

  return (
    <div className="hero-stat" ref={ref} role="figure" aria-label={`${one.value}: ${one.label}${one.comparison ? `, ${one.comparison}` : ''}`}>
      <div className="hero-stat-value" aria-hidden="true">{value}</div>
      <div className="hero-stat-label">{one.label}{one.period ? ` (${one.period})` : ''}</div>
      {one.comparison && (
        <div className={`hero-stat-compare ${one.direction ?? ''}`}>{arrow} {one.comparison}</div>
      )}
      {one.footnote ? (
        <div className="hero-stat-source">
          Source: <a href={`#fn-${one.footnote}`}>note {one.footnote}</a>
        </div>
      ) : null}
    </div>
  );
}
