'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryOneNumber } from '@/lib/story-types';

/**
 * Hero graphic (NEWS-STYLE.md §2.3, §4.2): the story's one number as a stat
 * card with its year-on-year comparison, both computed from stored data. The
 * real figure is what renders (server HTML, crawlers, link previews, no-JS);
 * the count-up is an enhancement that only zeroes it once the card is known to
 * be below the fold of a visible tab, and only ever animates back to the
 * figure. Reduced motion, a hidden tab or a card already on screen stay static.
 */
export default function HeroStat({ one }: { one: StoryOneNumber }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // An optional prefix ("A$"), the number, then any suffix ("%", " billion").
  const match = one.value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  const target = match ? Number(match[2].replace(/,/g, '')) : NaN;
  const decimals = match?.[2].split('.')[1]?.length ?? 0;
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || document.visibilityState !== 'visible'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || el.getBoundingClientRect().top < window.innerHeight) return;
    setShown(0);
    let raf = 0;
    const finish = () => { io.disconnect(); cancelAnimationFrame(raf); setShown(target); };
    // rAF stalls in a background tab: never leave the card at a partial figure.
    const onHide = () => { if (document.visibilityState !== 'visible') finish(); };
    document.addEventListener('visibilitychange', onHide);
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
    return () => { document.removeEventListener('visibilitychange', onHide); finish(); };
  }, [target]);

  const value = Number.isFinite(shown)
    ? `${match?.[1] ?? ''}${shown.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${match?.[3] ?? ''}`
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
