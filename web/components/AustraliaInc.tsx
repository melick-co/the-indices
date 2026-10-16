import Link from 'next/link';
import { linkify, longDay, type BottomLine, type IncItem, type IncLink } from '@/lib/australia-inc';

/** Australia Inc. pieces for the broadsheet: The Bottom Line, the running commentary, and the home teaser. */

function Anchor({ link, children }: { link: IncLink; children: React.ReactNode }) {
  if (link.url.startsWith('/')) return <Link href={link.url} className={`inc-link inc-link-${link.kind}`}>{children}</Link>;
  return <a href={link.url} className={`inc-link inc-link-${link.kind}`} target="_blank" rel="noreferrer">{children}</a>;
}

/** A paragraph with its links inline; links whose words aren't in the text follow it. */
function LinkedParagraph({ text, links }: { text: string; links: IncLink[] }) {
  const { parts, extra } = linkify(text, links);
  return (
    <p className="inc-bl-p">
      {parts.map((p, i) => (p.link ? <Anchor key={i} link={p.link}>{p.text}</Anchor> : <span key={i}>{p.text}</span>))}
      {extra.map((l) => (
        <span key={l.url} className="inc-bl-extra"> <Anchor link={l}>{l.label}</Anchor></span>
      ))}
    </p>
  );
}

export function BottomLineView({ bl, heading = 'h2' }: { bl: BottomLine; heading?: 'h1' | 'h2' }) {
  const H = heading;
  return (
    <section className="inc-bl" aria-labelledby="inc-bl-title">
      <p className="inc-flag">The Bottom Line</p>
      <H id="inc-bl-title" className="inc-bl-hed">{bl.headline}</H>
      <p className="inc-bl-date">Updated {longDay(bl.day)}</p>
      {bl.paragraphs.map((p, i) => <LinkedParagraph key={i} text={p.text} links={p.links} />)}
      <p className="inc-bl-foot">
        Every figure is checked against official data or attributed to the body that announced it.{' '}
        <Link href="/australia-inc/bottom-line">Past editions</Link>
      </p>
    </section>
  );
}

export function BottomLineEmpty() {
  return (
    <section className="inc-bl inc-bl-empty" aria-labelledby="inc-bl-title">
      <p className="inc-flag">The Bottom Line</p>
      <h2 id="inc-bl-title" className="inc-bl-hed">The first edition is on its way.</h2>
      <p className="inc-bl-p">
        Each morning The Bottom Line reads what government announced and what made news about the nation&apos;s
        accounts, and sets it against the official numbers. It appears here once every figure in it has been checked.
      </p>
    </section>
  );
}

const VERDICT: Record<string, string> = {
  agrees: 'Data agrees', disagrees: 'Data disagrees', partly: 'Partly', 'too early': 'Too early', unclear: 'Unclear',
};
const KIND: Record<string, string> = { announcement: 'Announcement', release: 'Release', news: 'In the news' };
const shortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' }) : '');

export function IncItemList({ items }: { items: IncItem[] }) {
  if (!items.length) {
    return (
      <p className="inc-empty">
        Nothing on the wire yet. Announcements from the Prime Minister, the Treasurer, the Finance Minister, the
        Parliamentary Budget Office and Parliament land here as they are read and checked.
      </p>
    );
  }
  return (
    <ol className="inc-items">
      {items.map((it) => {
        const checked = it.claims.filter((c) => VERDICT[c.verdict]);
        const others = it.links.filter((l) => l.url !== it.url);
        return (
          <li key={it.id} className="inc-item">
            <p className="inc-item-kicker">
              {[it.publisher, KIND[it.kind] ?? it.kind].filter(Boolean).join(' · ')}
              {it.published_at ? <span className="inc-item-date"> · {shortDate(it.published_at)}</span> : null}
            </p>
            <h3 className="inc-item-hed"><a href={it.url} target="_blank" rel="noreferrer">{it.title}</a></h3>
            {it.summary && <p className="inc-item-summary">{it.summary}</p>}
            {checked.length > 0 && (
              <ul className="inc-claims">
                {checked.map((c, i) => (
                  <li key={i}>
                    <span className={`inc-chip inc-chip-${c.verdict.replace(' ', '-')}`}>{VERDICT[c.verdict]}</span>{' '}
                    {c.text}
                    {c.note && <span className="inc-claim-note"> {c.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {others.length > 0 && (
              <p className="inc-item-links">
                {others.map((l, i) => (
                  <span key={l.url}>{i > 0 ? ' · ' : ''}<Anchor link={l}>{l.label}</Anchor></span>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The home page's compact pointer to today's Bottom Line. */
export function BottomLineTeaser({ bl }: { bl: BottomLine | null }) {
  return (
    <aside className="inc-teaser" aria-labelledby="inc-teaser-title">
      <p className="inc-flag">Australia Inc.</p>
      <h2 id="inc-teaser-title" className="inc-teaser-name"><Link href="/australia-inc">The Bottom Line</Link></h2>
      {bl ? (
        <>
          <p className="inc-teaser-hed">{bl.headline}</p>
          <p className="inc-teaser-p">{bl.paragraphs[0]?.text}</p>
          <p className="inc-teaser-more"><Link href="/australia-inc">Read today&apos;s brief</Link> <span className="inc-teaser-date">· {longDay(bl.day)}</span></p>
        </>
      ) : (
        <>
          <p className="inc-teaser-p">How the country is being run: what government announced and what made news about the nation&apos;s bottom line, checked against the numbers each morning.</p>
          <p className="inc-teaser-more"><Link href="/australia-inc">Australia Inc.</Link></p>
        </>
      )}
    </aside>
  );
}
