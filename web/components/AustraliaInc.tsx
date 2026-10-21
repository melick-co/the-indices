import Link from 'next/link';
import { linkify, longDay, type BottomLine, type IncItem, type IncLink } from '@/lib/australia-inc';
import { TERMS, THRESHOLDS, longDate, monthYear, type TermKey } from '@/lib/scorecard';
import type { CommitmentRow, OutcomeRow, ScoredCommitment } from '@/lib/scorecard-loader';
import type { SeriesRef } from '@/lib/scorecard-outcomes';

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

/** How many items the wire shows before "Earlier on the wire": about the height of The Bottom Line beside it. */
const WIRE_SHOWN = 4;

function WireItem({ it }: { it: IncItem }) {
  const checked = it.claims.filter((c) => VERDICT[c.verdict]);
  const others = it.links.filter((l) => l.url !== it.url);
  return (
    <li className="inc-item">
      <p className="inc-item-kicker">
        {[it.publisher, KIND[it.kind] ?? it.kind].filter(Boolean).join(' · ')}
        {it.published_at ? <span className="inc-item-date"> · {shortDate(it.published_at)}</span> : null}
      </p>
      <h3 className="inc-item-hed"><a href={it.url} target="_blank" rel="noreferrer">{it.title}</a></h3>
      {/* The first lines show; "More" opens the rest of the summary, the checks and the links in place. */}
      {it.summary && <p className="inc-item-summary">{it.summary}</p>}
      <details className="inc-item-more">
        <summary>More<span className="inc-item-less">Less</span></summary>
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
        <p className="inc-item-links">
          <a href={it.url} target="_blank" rel="noreferrer">Read it at {it.publisher || 'the source'}</a>
          {others.map((l) => (
            <span key={l.url}> · <Anchor link={l}>{l.label}</Anchor></span>
          ))}
        </p>
      </details>
    </li>
  );
}

export function IncItemList({ items }: { items: IncItem[] }) {
  if (!items.length) {
    return (
      <p className="inc-empty">
        Nothing on the wire yet. Announcements from the Prime Minister, the Treasurer, the Finance Minister, the
        Parliamentary Budget Office and Parliament land here as they are read and checked.
      </p>
    );
  }
  const shown = items.slice(0, WIRE_SHOWN);
  const earlier = items.slice(WIRE_SHOWN);
  return (
    <>
      <ol className="inc-items">
        {shown.map((it) => <WireItem key={it.id} it={it} />)}
      </ol>
      {earlier.length > 0 && (
        <details className="inc-earlier">
          <summary>Earlier on the wire ({earlier.length})</summary>
          <ol className="inc-items">
            {earlier.map((it) => <WireItem key={it.id} it={it} />)}
          </ol>
        </details>
      )}
    </>
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

// ---------------------------------------------------------------------------------------------------- the scorecard

/** The baseline toggle: two links styled as a segmented control, so it works without JavaScript. */
export function TermToggle({ term, path = '/australia-inc/scorecard' }: { term: TermKey; path?: string }) {
  return (
    <nav className="sc-toggle" aria-label="Baseline">
      {(['2025', '2022'] as TermKey[]).map((k) => (
        <Link key={k} href={k === '2025' ? path : `${path}?since=2022`} className={`sc-toggle-opt${k === term ? ' is-on' : ''}`}
          aria-current={k === term ? 'page' : undefined} scroll={false}>
          {TERMS[k].label}
        </Link>
      ))}
    </nav>
  );
}

const nf = (v: number, d: number) => v.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), d)}`;

/** A reading in its unit: 3.6%, $24,971, −$12.1b. */
function fmtValue(v: number | null | undefined, unit: string, d: number) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (unit === '%') return `${nf(v, d)}%`;
  if (unit === 'pp') return `${signed(v, d)} pts`;
  if (unit === '$') return `$${nf(v, d)}`;
  if (unit === '$bn') return `${v < 0 ? '−' : ''}$${nf(Math.abs(v), d)}b`;
  if (unit === 'index') return nf(v, 1);
  return nf(v, d);
}

function fmtChange(c: number | null, kind: OutcomeRow['def']['change'], unit: string, d: number) {
  if (c == null) return '–';
  if (kind === 'pp') return `${signed(c, d)} pts`;
  if (kind === 'pct') return `${signed(c, 1)}%`;
  if (unit === '$bn') return `${c < 0 ? '−' : '+'}$${nf(Math.abs(c), d)}b`;
  return signed(c, d);
}

const ratingClass = (r: string) => `sc-chip sc-chip-${r.replace(/\s+/g, '-')}`;

/** Big counts as a reader takes them in: 1,200,000 as "1.2 million". */
function fmtTarget(v: number, unit: string) {
  const n = Math.abs(v) >= 1e6 ? `${nf(v / 1e6, v % 1e6 === 0 ? 0 : 1)} million` : nf(v, Number.isInteger(v) ? 0 : 1);
  return unit.startsWith('%') ? `${n}${unit}` : `${n} ${unit}`.trim();
}

const paceText = (v: number) => nf(v, Math.abs(v) >= 100 ? 0 : 2);

function PromiseCard({ p }: { p: ScoredCommitment }) {
  const a = p.a;
  const pct = a.pct == null ? null : Math.max(0, Math.min(100, a.pct));
  const unit = p.target_unit ?? '';
  const progressText = a.progress == null ? 'No readings yet'
    : p.method === 'cumulative_sum' ? `${fmtTarget(Math.round(a.progress), unit)} so far`
      : p.method === 'change' ? `${nf(a.progress, 1)}% so far` : `${nf(a.progress, 1)} at the latest reading`;
  const external = p.seriesHref && !p.seriesHref.startsWith('/');
  return (
    <li className="sc-promise">
      <div className="sc-promise-top">
        <h3 className="sc-promise-hed">{p.title}</h3>
        <span className={ratingClass(a.rating)}>{a.rating}</span>
      </div>
      <blockquote className="sc-quote">
        <p>&ldquo;{p.quote}&rdquo;</p>
        <footer><a href={p.source_url} target="_blank" rel="noreferrer">{p.source_title ?? 'Source'}</a>{p.source_date ? `, ${longDate(p.source_date)}` : ''}</footer>
      </blockquote>
      <dl className="sc-facts">
        <div><dt>Target</dt><dd>{fmtTarget(p.target_value, unit)} by {monthYear(p.target_date)}</dd></div>
        <div><dt>Progress</dt><dd>{progressText}{a.pct != null ? ` (${nf(a.pct, 0)}% of the way)` : ''}{a.latestPeriod ? <span className="sc-faint"> to {a.latestPeriod}</span> : null}</dd></div>
        {a.paceNeeded != null && a.paceAchieved != null && (
          <div><dt>Pace</dt><dd>{paceText(a.paceAchieved)} a year achieved; {paceText(a.paceNeeded)} a year needed</dd></div>
        )}
      </dl>
      {pct != null && (
        <div className="sc-bar" role="img" aria-label={`${nf(pct, 0)} per cent of the way to the target`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="sc-promise-foot">
        {p.check?.basis?.start_basis ? <>Pace counted from {longDate(p.start_date)}. {p.check.basis.start_basis}{' '}</> : null}
        {p.check?.verified_against === 'cache' && p.check.document_fetched_at ? <>Quote checked against the copy of the source stored on {longDate(p.check.document_fetched_at)}.{' '}</> : null}
        {a.note}{' '}
        Series: {p.seriesHref
          ? (external ? <a href={p.seriesHref} target="_blank" rel="noreferrer">{p.seriesName}</a> : <Link href={p.seriesHref}>{p.seriesName}</Link>)
          : <span>{p.seriesName}</span>}
      </p>
    </li>
  );
}

export function PromiseList({ promises, awaiting, installed }: { promises: ScoredCommitment[]; awaiting: CommitmentRow[]; installed: boolean }) {
  if (!promises.length && !awaiting.length) {
    return (
      <p className="inc-empty">
        {installed
          ? 'No commitment has passed the check yet. Each one appears here once its target is found word for word in an official document and an official series measures it.'
          : 'The promises will appear here once the scorecard is set up.'}
      </p>
    );
  }
  return (
    <>
      {promises.length > 0 ? <ol className="sc-promises">{promises.map((p) => <PromiseCard key={p.id} p={p} />)}</ol> : (
        <p className="inc-empty">No commitment can be rated yet: none has an official series in our store that measures it.</p>
      )}
      {awaiting.length > 0 && (
        <section className="sc-awaiting" aria-labelledby="sc-awaiting-title">
          <h3 id="sc-awaiting-title" className="sc-sub">Awaiting official data</h3>
          <p className="inc-section-dek">These targets are quoted from official documents, but no official series we can load measures them yet. Each is rated once one does.</p>
          <ul>
            {awaiting.map((c) => (
              <li key={c.id}>
                <strong>{c.title}.</strong> &ldquo;{c.quote}&rdquo; <a href={c.source_url} target="_blank" rel="noreferrer">{c.source_title ?? 'Source'}</a>
                {c.data_note ? <span className="sc-faint"> {c.data_note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

type Reading = { value: number; period: string } | null;

function SeriesValues({ s, base, latest, change, mark, kind, decimals }: {
  s: SeriesRef; base: Reading; latest: Reading; change: number | null; mark: string; kind: OutcomeRow['def']['change']; decimals: number;
}) {
  return (
    <div className="sc-series">
      <span className="sc-label">{s.label}</span>
      <dl className="sc-vals">
        <div><dt>Baseline</dt><dd>{fmtValue(base?.value, s.unit, decimals)}<span className="sc-faint"> {base?.period ?? ''}</span></dd></div>
        <div><dt>Latest</dt><dd>{fmtValue(latest?.value, s.unit, decimals)}<span className="sc-faint"> {latest?.period ?? ''}</span></dd></div>
        <div><dt>Change</dt><dd><span className="sc-mark" aria-hidden="true">{mark}</span> {fmtChange(change, kind, s.unit, decimals)}</dd></div>
      </dl>
    </div>
  );
}

export function OutcomeList({ outcomes }: { outcomes: OutcomeRow[] }) {
  return (
    <ol className="sc-outcomes">
      {outcomes.map((o) => (
        <li key={o.def.key} className="sc-outcome">
          <h3 className="sc-outcome-hed">{o.def.title}</h3>
          <SeriesValues s={o.def.primary} base={o.base} latest={o.latest} change={o.change} mark={o.mark} kind={o.def.change} decimals={o.def.decimals} />
          {o.def.secondary && o.second && (
            <SeriesValues s={o.def.secondary} base={o.second.base} latest={o.second.latest} change={o.second.change} mark={o.second.mark} kind={o.def.change} decimals={o.def.decimals} />
          )}
          {o.issue && <p className="sc-faint sc-issue">{o.issue}</p>}
          {o.oecd && (
            <p className="sc-oecd">OECD average over the same period: {fmtChange(o.oecd.change, o.def.change, o.def.primary.unit, o.def.decimals)} ({o.oecd.base?.period} to {o.oecd.latest?.period}).</p>
          )}
          {o.def.note && <p className="sc-note">{o.def.note}</p>}
          <p className="sc-control"><span className="sc-control-label">How much the government controls this:</span> {o.def.control}</p>
          <p className="sc-source">
            {o.def.link.href.startsWith('/') ? <Link href={o.def.link.href}>{o.def.link.label}</Link> : <a href={o.def.link.href} target="_blank" rel="noreferrer">{o.def.link.label}</a>}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ScorecardMethodology() {
  return (
    <section className="sc-method" aria-labelledby="sc-method-title">
      <h2 id="sc-method-title" className="inc-section-head">How the scorecard works</h2>
      <h3 className="sc-sub">Promises</h3>
      <ul>
        <li>A promise is listed only when its target is quoted word for word from an official document (a minister&apos;s release, budget papers, legislation or a department&apos;s program page), the quote is found in the document&apos;s own text, and a separate check confirms the target as we read it. Anything short of that is held back, not shown. When an official page cannot be reached, the quote is checked against the copy we stored when it last could be, and the promise says so.</li>
        <li>The start date used for pace is our choice, not the document&apos;s, unless the document states one: each promise gives its start date and the reason for it.</li>
        <li>Each promise is measured by an official statistical series. Where none can be loaded yet, the promise is listed as awaiting data and the series is requested.</li>
        <li>Our agent keeps the list each week and after relevant releases. Every addition, change, removal and rating change is logged.</li>
        <li>Pace achieved is the average progress per year since the promise started counting. Pace needed is the distance left to the target divided by the time left to the deadline.</li>
        <li>The rating is pace achieved divided by pace needed: {THRESHOLDS.ahead} or more is &ldquo;ahead&rdquo;; {THRESHOLDS.onTrack} up to {THRESHOLDS.ahead} is &ldquo;on track&rdquo;; {THRESHOLDS.behind} up to {THRESHOLDS.onTrack} is &ldquo;behind&rdquo;; below {THRESHOLDS.behind} is &ldquo;off track&rdquo;. Once the data covers the deadline the rating is &ldquo;met&rdquo; or &ldquo;missed&rdquo;. A promise with fewer than two readings since its start is &ldquo;not yet rated&rdquo;.</li>
        <li>&ldquo;This term&rdquo; lists promises whose deadline falls after 3 May 2025; &ldquo;since taking office&rdquo; adds those whose deadline fell in the first term. Each promise is always measured from its own start date.</li>
      </ul>
      <h3 className="sc-sub">Outcomes</h3>
      <ul>
        <li>The baseline is the reading for the period that covers the election date: 3 May 2025 for this term, 21 May 2022 since taking office. For the cash rate it is the rate in force on election day.</li>
        <li>Changes are in percentage points for rates and per cent for levels. Arrows show direction only.</li>
        <li>Each measure carries a fixed note on how much the government controls it. Outcomes are not rated: many are set by the Reserve Bank, the states, businesses or the world economy.</li>
        <li>OECD averages appear only where an OECD aggregate for the same measure is in our store.</li>
        <li>Any inflation figure is shown as headline CPI with the trimmed mean beside it. The trimmed mean is the RBA&apos;s preferred measure of underlying inflation.</li>
      </ul>
      <h3 className="sc-sub">What is left out, and why</h3>
      <ul>
        <li>Grades and judgements: the scorecard reports pace and direction, nothing more.</li>
        <li>Private indices, surveys and opinion polls: official data only (Australian Bureau of Statistics, Reserve Bank, government finance statistics, OECD).</li>
        <li>Promises without a number and a deadline, forecasts, and targets no official series measures (program counts reported by departments).</li>
        <li>The budget balance against the budget&apos;s own forecast: the budget forecasts the underlying cash balance, while the official quarterly series is government finance statistics on an accrual basis. Comparing the two would mix measures, so the balance appears under Outcomes instead.</li>
      </ul>
    </section>
  );
}

/** The scorecard's line on /australia-inc. */
export function ScorecardTeaser({ summary }: { summary: string | null }) {
  return (
    <p className="sc-teaser">
      <span className="sc-teaser-flag">The scorecard</span>{' '}
      {summary ?? 'The federal government’s measurable promises and the headline outcomes, from official data.'}{' '}
      <Link href="/australia-inc/scorecard">See the scorecard</Link>
    </p>
  );
}
