import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div style={{ marginBottom: '.8rem' }}>
          <strong style={{ letterSpacing: '.1em' }}>CAVEAT</strong> · Caveat lector. Just saying.
        </div>
        <div>
          Every figure resolves to a named source with its tier, basis and publication date.
          Methodology and index construction are <Link href="/methodology">published in full</Link>.
        </div>
        <div style={{ marginTop: '.6rem' }}>
          Data as published by the cited statistical agencies. Where we compute a figure it is
          marked derived; where a source is exploratory it is marked tier 3 and never carries a headline.
        </div>
      </div>
    </footer>
  );
}
