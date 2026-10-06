'use client';

import { useState } from 'react';

/** The play mark over a race's poster: tells the reader the picture plays. */
export function PlayMark({ size = 64 }: { size?: number }) {
  return (
    <span className="vz-play" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}><circle cx="32" cy="32" r="31" /><path d="M26 20 L46 32 L26 44 Z" /></svg>
    </span>
  );
}

/** The square video: its poster with a play mark until clicked, then the video itself, playing with controls. */
export function RacePlayer({ src, poster, title }: { src: string; poster?: string; title: string }) {
  const [playing, setPlaying] = useState(!poster);
  if (playing) return <video className="vz-player-video" src={src} poster={poster} controls autoPlay={!!poster} playsInline preload="metadata" />;
  return (
    <button type="button" className="vz-player-poster" onClick={() => setPlaying(true)} aria-label={`Play: ${title}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={poster} alt="" />
      <PlayMark size={88} />
    </button>
  );
}
