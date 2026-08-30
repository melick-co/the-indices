'use client';

/** Hero claim with editorial underline emphasis — Spacelab style. */
export default function HeroFlip() {
  return (
    <section className="hero">
      <div className="eyebrow">The detail that changes the story</div>
      <h1 className="hero-claim">
        America takes the <span className="mark">most migrants</span> in the world.
      </h1>
      <div className="hero-rub on">
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
    </section>
  );
}
