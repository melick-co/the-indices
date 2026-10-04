/**
 * Published Australian federal polls, read from Wikipedia's polling tables through the MediaWiki API.
 *
 * Polls are private sources (tier-3 context). A poll is kept only when the compilation cites a published release
 * for it and its numbers add up; everything rejected is reported with the reason. No dependencies: MediaWiki's
 * table HTML is regular enough for the small grid parser below (rowspan and colspan aware).
 */
export const POLL_PAGE = 'Opinion_polling_for_the_next_Australian_federal_election';
const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'CaveatBot/1.0 (https://the-indices.vercel.app; polling tables for a public dashboard)';

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`MediaWiki API ${res.status} for ${params.action}`);
  const json = await res.json();
  if (json.error) throw new Error(`MediaWiki API: ${json.error.info}`);
  return json.parse;
}

/**
 * The whole page in one request: its sections and HTML. Tables are found by section anchor in the full HTML,
 * because named references are defined once per page and do not resolve when a section is parsed on its own.
 */
export async function fetchPage(page = POLL_PAGE) {
  const p = await api({ action: 'parse', page, prop: 'text|sections|revid' });
  return {
    revid: p.revid, html: p.text,
    sections: p.sections.map((s) => ({ line: cellText(s.line), anchor: s.anchor, level: Number(s.level) })),
  };
}

/** The first wikitable after a section heading, before the next heading of the same or higher level. */
export function sectionTable(html, anchor) {
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<h([1-6])[^>]*id="${esc}"`).exec(html);
  if (!m) return null;
  const end = new RegExp(`<h[1-${m[1]}][^>]*id="`, 'g');
  end.lastIndex = m.index + m[0].length;
  const next = end.exec(html);
  return tables(html.slice(m.index, next ? next.index : undefined))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------- HTML → grid

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', minus: '−' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** Visible text of a cell: no styles, footnote markers or screen-reader-only "N/a". */
export function cellText(html) {
  return decode(html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<sup[^>]*class="reference"[\s\S]*?<\/sup>/g, '')
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Footnote ids cited in a cell ("cite_note-2"). */
const citedNotes = (html) => [...decode(html).matchAll(/href="#(cite_note-[^"]+)"/g)].map((m) => m[1]);
/** External links in a cell. */
const externalLinks = (html) => [...html.matchAll(/<a[^>]*class="external[^"]*"[^>]*href="([^"]+)"/g)].map((m) => decode(m[1]));

/** The first external link of each reference in the page's reference list, by footnote id. */
export function referenceUrls(html) {
  const out = new Map();
  for (const m of html.matchAll(/<li id="(cite(?:&#95;|_)note-[^"]+)">([\s\S]*?)<\/li>/g)) {
    const id = decode(m[1]);
    const links = [...m[2].matchAll(/<a[^>]*rel="nofollow"[^>]*class="external text"[^>]*href="([^"]+)"/g)]
      .map((x) => decode(x[1]))
      .filter((u) => !/web\.archive\.org|archive\.(is|ph|today)/.test(u));
    if (links.length) out.set(id, links[0]);
  }
  return out;
}

/** Every wikitable in the HTML as a grid of cells; a cell spanning rows or columns is the same object in each slot. */
export function tables(html) {
  return [...html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g)].map((t) => {
    const grid = [];
    const rows = [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    rows.forEach((r, ri) => {
      grid[ri] ??= [];
      let col = 0;
      for (const c of r[1].matchAll(/<(td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
        while (grid[ri][col]) col++;
        const attrs = c[2] ?? '';
        const span = (name) => Number((attrs.match(new RegExp(`${name}="(\\d+)"`)) ?? [])[1] ?? 1);
        const cell = { header: c[1] === 'th', html: c[3], text: cellText(c[3]) };
        for (let dr = 0; dr < span('rowspan'); dr++) {
          for (let dc = 0; dc < span('colspan'); dc++) {
            (grid[ri + dr] ??= [])[col + dc] = cell;
          }
        }
        col += span('colspan');
      }
    });
    return grid.filter(Boolean);
  });
}

// ---------------------------------------------------------------------------------------------------- fields

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const month = (s) => (s ? MONTHS[s.slice(0, 3).toLowerCase()] : undefined);
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "28 Sept–2 Oct", "23–28 Sept", "22–28 Jun 2026", "29 Dec 2025 – 4 Jan 2026", "3 Oct" → ISO start and end. */
export function fieldDates(text, defaultYear) {
  const parts = text.split(/\s*[–—-]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const endM = parts.at(-1).match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?$/);
  if (!endM || !month(endM[2])) return null;
  const endY = Number(endM[3] ?? defaultYear);
  if (!endY) return null;
  const end = iso(endY, month(endM[2]), Number(endM[1]));
  if (parts.length === 1) return { start: end, end };
  const startM = parts[0].match(/^(\d{1,2})(?:\s+([A-Za-z]+)\.?)?(?:\s+(\d{4}))?$/);
  if (!startM) return null;
  const sm = month(startM[2]) ?? month(endM[2]);
  const sy = Number(startM[3] ?? (sm > month(endM[2]) ? endY - 1 : endY));
  return { start: iso(sy, sm, Number(startM[1])), end };
}

/** "28%", "52.5", "<b>29%</b>" → number; "—", "N/a", "" → null. */
export function pct(text) {
  const m = text.replace(/,/g, '').match(/^[−-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0].replace('−', '-')) : null;
}

// ---------------------------------------------------------------------------------------------------- tables → polls

/** Column labels: each header row's text at that column, top to bottom, without repeats. */
function columnLabels(headerRows) {
  const width = Math.max(...headerRows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    const seen = [];
    for (const r of headerRows) {
      const t = r[i]?.text?.replace(/\[[a-z0-9]+\]/gi, '').trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    return seen;
  });
}

const PARTY = [[/^ALP$/, 'alp'], [/^(L\/NP|LNP|Coalition)$/, 'lnp'], [/^LIB$/, 'lib'], [/^NAT$/, 'nat'], [/^GRN$/, 'grn'], [/^ONP$/, 'onp'], [/^(Others?|OTH|IND|Others\/IND)$/i, 'oth']];
const partyOf = (labels) => {
  for (const l of [...labels].reverse()) for (const [re, p] of PARTY) if (re.test(l)) return p;
  return null;
};

function splitHeader(grid) {
  const first = grid.findIndex((r) => r.some((c) => c && !c.header) && r[0] && fieldDates(r[0].text, 2000));
  return first < 0 ? null : { header: grid.slice(0, first), body: grid.slice(first) };
}

/**
 * Voting intention: primaries and two-party splits. A poll reporting two contests (Labor v Coalition and Labor v
 * One Nation) spans two table rows that share the date cell; they are grouped by that shared cell.
 */
export function votingIntention(grid, year, refs) {
  const parts = splitHeader(grid);
  if (!parts) return { polls: [], rejected: [] };
  const labels = columnLabels(parts.header);
  const col = (pred) => labels.map((l, i) => (pred(l) ? i : -1)).filter((i) => i >= 0);
  const [dateC, firmC, clientC, modeC, sampleC] = ['Date', 'Polling firm', 'Client', 'Interview', 'Sample']
    .map((h) => labels.findIndex((l) => l[0]?.replace(/\s/g, '').toLowerCase().startsWith(h.replace(/\s/g, '').toLowerCase())));
  const prim = col((l) => /primary/i.test(l[0] ?? '')).map((i) => ({ i, party: partyOf(labels[i]) }));
  const tpp = col((l) => /2PP|two-party/i.test(l[0] ?? '')).map((i) => ({ i, party: partyOf(labels[i]) }));
  if ([dateC, firmC].some((i) => i < 0) || !prim.length || !tpp.length) throw new Error(`voting-intention table layout not recognised: ${JSON.stringify(labels)}`);

  const groups = new Map();
  for (const row of parts.body) {
    const dateCell = row[dateC];
    if (!dateCell || !row[firmC] || row[firmC] === dateCell) continue;
    // Event rows ("X resigns as leader") are one wide cell after the date.
    if (prim.every(({ i }) => row[i] === row[firmC])) continue;
    if (!groups.has(dateCell)) groups.set(dateCell, []);
    groups.get(dateCell).push(row);
  }

  const polls = [], rejected = [];
  for (const [dateCell, rows] of groups) {
    const r0 = rows[0];
    const pollster = r0[firmC].text.replace(/\[\d+\]/g, '').trim();
    const dates = fieldDates(dateCell.text, year);
    const label = `${dateCell.text} ${pollster}`;
    if (!dates) { rejected.push({ poll: label, reason: 'field dates not recognised' }); continue; }
    const notes = [...citedNotes(r0[firmC].html), ...(clientC >= 0 ? citedNotes(r0[clientC].html) : [])];
    const source = notes.map((n) => refs.get(n)).find(Boolean) ?? (clientC >= 0 ? externalLinks(r0[clientC].html)[0] : undefined);
    if (!source) { rejected.push({ poll: label, reason: 'no cited release' }); continue; }

    const values = {};
    // Primaries: a combined Coalition figure spans the LIB and NAT columns; separate figures are summed.
    const seen = new Set();
    let lib = null, nat = null;
    for (const { i, party } of prim) {
      const cell = r0[i];
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      const v = pct(cell.text);
      if (v == null || !party) continue;
      if (party === 'lib') lib = v; else if (party === 'nat') nat = v; else values[`primary_${party}`] = v;
    }
    if (values.primary_lnp == null && lib != null) values.primary_lnp = lib + (nat ?? 0);
    const primaries = ['alp', 'lnp', 'grn', 'onp', 'oth'].map((p) => values[`primary_${p}`]);
    if (primaries.every((v) => v != null)) {
      const sum = primaries.reduce((a, b) => a + b, 0);
      // Some pollsters report undecided voters separately, so primaries can sum well under 100; never over.
      if (sum < 85 || sum > 103.5) { rejected.push({ poll: label, reason: `primaries sum to ${sum}` }); continue; }
    }
    // Two-party splits: each row holds one contest, the two parties with figures.
    for (const row of rows) {
      const filled = tpp.map(({ i, party }) => ({ party, v: pct(row[i]?.text ?? '') })).filter((x) => x.v != null && x.party);
      if (filled.length !== 2) continue;
      const [a, b] = filled;
      if (Math.abs(a.v + b.v - 100) > 1) {
        rejected.push({ poll: label, reason: `two-party split ${a.v}+${b.v} includes undecided; not comparable, primaries kept` });
        continue;
      }
      const contest = ['alp', 'lnp', 'onp'];
      const [x, y] = [a, b].sort((p, q) => contest.indexOf(p.party) - contest.indexOf(q.party));
      values[`tpp_${x.party}_${y.party}`] = x.v;
    }
    if (!Object.keys(values).length) { rejected.push({ poll: label, reason: 'no figures' }); continue; }
    polls.push({
      table: 'vi', pollster, client: clientC >= 0 ? r0[clientC].text.replace(/^[—–-]$/, '') || null : null,
      mode: modeC >= 0 ? r0[modeC].text || null : null,
      sample_size: sampleC >= 0 ? pct(r0[sampleC].text) : null,
      field_start: dates.start, field_end: dates.end, source_url: source, values,
    });
  }
  return { polls, rejected };
}

/** "Is the country heading in the right direction?": right, wrong, unsure, checked against the table's own net. */
export function directionPolls(grid, refs) {
  const parts = splitHeader(grid);
  if (!parts) return { polls: [], rejected: [] };
  const labels = columnLabels(parts.header).map((l) => l.join(' '));
  const find = (re) => labels.findIndex((l) => re.test(l));
  const [dateC, firmC, clientC, rightC, wrongC, unsureC, netC] = [/^Date/, /Polling firm/, /Client/, /Right/, /Wrong/, /Unsure/, /Net/].map(find);
  if ([dateC, firmC, rightC, wrongC].some((i) => i < 0)) throw new Error(`direction table layout not recognised: ${JSON.stringify(labels)}`);
  const polls = [], rejected = [];
  for (const row of parts.body) {
    if (!row[dateC] || !row[firmC] || row[firmC] === row[dateC]) continue;
    const pollster = row[firmC].text.replace(/\[\d+\]/g, '').trim();
    const label = `${row[dateC].text} ${pollster}`;
    const dates = fieldDates(row[dateC].text);
    if (!dates) { rejected.push({ poll: label, reason: 'field dates not recognised' }); continue; }
    const source = citedNotes(row[firmC].html).map((n) => refs.get(n)).find(Boolean) ?? (clientC >= 0 ? externalLinks(row[clientC].html)[0] : undefined);
    if (!source) { rejected.push({ poll: label, reason: 'no cited release' }); continue; }
    const right = pct(row[rightC].text), wrong = pct(row[wrongC].text);
    const unsure = unsureC >= 0 ? pct(row[unsureC].text) : null;
    const net = netC >= 0 ? pct(row[netC].text) : null;
    if (right == null || wrong == null) { rejected.push({ poll: label, reason: 'missing figures' }); continue; }
    if (right + wrong + (unsure ?? 0) > 101) { rejected.push({ poll: label, reason: `answers sum to ${right + wrong + (unsure ?? 0)}` }); continue; }
    if (net != null && Math.abs(right - wrong - net) > 1) { rejected.push({ poll: label, reason: `net ${net} ≠ ${right} − ${wrong}` }); continue; }
    polls.push({
      table: 'dir', pollster, client: clientC >= 0 ? row[clientC].text.replace(/^[—–-]$/, '') || null : null, mode: null, sample_size: null,
      field_start: dates.start, field_end: dates.end, source_url: source,
      values: { direction_right: right, direction_wrong: wrong, ...(unsure != null ? { direction_unsure: unsure } : {}) },
    });
  }
  return { polls, rejected };
}

/** Every poll on the page, with what was rejected and why. */
export async function loadPolls({ since = '2025-05-04' } = {}) {
  const { revid, html, sections } = await fetchPage();
  const refs = referenceUrls(html);
  const vi = sections.findIndex((s) => /^Voting intention$/i.test(s.line));
  if (vi < 0) throw new Error('No "Voting intention" section on the polling page');
  const years = [];
  for (const s of sections.slice(vi + 1)) {
    if (s.level <= sections[vi].level) break;
    if (/^\d{4}$/.test(s.line)) years.push(s);
  }
  const dir = sections.find((s) => /direction/i.test(s.line));
  const polls = [], rejected = [];
  for (const s of years) {
    const t = sectionTable(html, s.anchor);
    if (!t) { rejected.push({ poll: `section ${s.line}`, reason: 'no table' }); continue; }
    const r = votingIntention(t, Number(s.line), refs);
    polls.push(...r.polls); rejected.push(...r.rejected);
  }
  if (dir) {
    const t = sectionTable(html, dir.anchor);
    if (t) { const r = directionPolls(t, refs); polls.push(...r.polls); rejected.push(...r.rejected); }
  }
  const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const kept = polls.filter((p) => {
    if (/^election$/i.test(p.pollster)) return false;
    const ok = p.field_end >= since && p.field_end <= today && p.field_start <= p.field_end;
    if (!ok) rejected.push({ poll: `${p.field_end} ${p.pollster}`, reason: `field dates ${p.field_start}–${p.field_end} out of range` });
    return ok;
  });
  return { revid, polls: kept, rejected };
}
