'use client';
import { useEffect, useState } from 'react';

/** The signature element. The claim as everyone read it, then the correction
 *  in editor's red. The highlighter lands on the figure that actually matters. */
export default function HeroFlip() {
  const [on, setOn] = useState(false);
  const [rub, setRub] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setOn(true), 600);
    const b = setTimeout(() => setRub(true), 1500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  return (
    <section className="hero">
      <div className="wrap">
        <div className="eyebrow">The detail that changes the story</div>
        <h1 className="hero-claim">
          America takes the <span className={`mark${on ? ' on' : ''}`}>most migrants</span> in the world.
        </h1>
        <div className={`hero-rub${rub ? ' on' : ''}`}>
          <span className="rub-label">Here&rsquo;s the rub</span>
          <p>
            Per person, it ranks 26th of 38. Absolute intake measures the size of an
            economy. Openness is a per-person question, and almost every ranking you
            have seen answers the first one.
          </p>
        </div>
        <div className="hero-foot">
          <span>OECD, 2024</span>
          <span className="tier t1">Tier 1</span>
          <span>·</span>
          <span>Checkable in one click</span>
        </div>
      </div>
    </section>
  );
}
