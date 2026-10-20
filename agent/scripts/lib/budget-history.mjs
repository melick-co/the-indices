/**
 * Treasury's historical fiscal tables: Budget Paper No. 1, Statement 11 "Historical Australian Government Data",
 * published with each Budget at budget.gov.au as a Word document (no spreadsheet or API carries it). Pure and
 * dependency-free: a minimal zip reader for the .docx, a table reader for its XML, and parsers for the two tables
 * used. Shared by agent/scripts/load-budget-history.mjs; tested by budget-history.check.mjs.
 *
 *   Table 11.1  general government receipts, payments, net Future Fund earnings and underlying cash balance
 *   Table 11.6  general government revenue, expenses, net operating balance, net capital investment and fiscal balance
 *
 * Rows marked "(e)" are estimates (the Budget year and forward estimates); every other row is an outcome from the
 * Final Budget Outcomes (Statement 11, "Data sources"). Only outcomes are kept.
 */
import { inflateRawSync } from 'node:zlib';

/** One file out of a zip archive (a .docx is one), or null. Stored and deflated entries only, which is all Word writes. */
export function unzipEntry(buf, name) {
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip central directory is damaged');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip entry ${name}: compression method ${method} not supported`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Text as printed: entities decoded, non-breaking spaces as spaces, zero-width joiners and the like removed. */
export const cleanText = (s) => s
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/[  ]/g, ' ').replace(/[​-‍⁠﻿]/g, '')
  .replace(/\s+/g, ' ').trim();

const textOf = (xml) => cleanText((xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));

/**
 * The document's tables in order, each with the last heading paragraph before it ("Table 11.6: …"), as rows of cell
 * text. Statement 11's tables are not nested.
 */
export function docxTables(documentXml) {
  const out = [];
  let heading = '';
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  for (let m; (m = re.exec(documentXml));) {
    const seg = m[0];
    if (seg.startsWith('<w:tbl>')) {
      const rows = (seg.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(textOf));
      out.push({ heading, rows });
    } else {
      const t = textOf(seg);
      if (/^Table \d+\.\d+:/.test(t)) heading = t;
    }
  }
  return out;
}

/** "-4,342" or "−4,342" → -4342; "-" (nothing) → 0; "na" → null. */
export function num(cell) {
  const c = cleanText(cell).replace(/[−–]/g, '-');
  if (c === '-' || c === '–') return 0;
  if (/^na$/i.test(c)) return null;
  if (!/^-?[\d,]+(\.\d+)?$/.test(c)) return undefined;
  return Number(c.replace(/,/g, ''));
}

/** "2024-25", "2024–25" or "2025-26 (e)" → { fy: '2024-25', estimate }; anything else → null. */
export function fyCell(cell) {
  const m = cleanText(cell).replace(/[–‑]/g, '-').match(/^(\d{4})-(\d{2})(\s*\(e\))?$/);
  if (!m) return null;
  if ((Number(m[1]) + 1) % 100 !== Number(m[2])) return null;
  return { fy: `${m[1]}-${m[2]}`, estimate: !!m[3] };
}

/** Year rows of the tables whose heading starts with `prefix` (a table and its continuation): { fy, estimate, values }. */
export function yearRows(tables, prefix) {
  const rows = [];
  for (const t of tables.filter((x) => x.heading.startsWith(prefix))) {
    for (const r of t.rows) {
      const y = fyCell(r[0] ?? '');
      if (!y) continue;
      // The numbers in the row, in order: spacer cells are empty.
      const values = r.slice(1).map((c) => cleanText(c)).filter((c) => c !== '').map(num);
      rows.push({ ...y, values });
    }
  }
  return rows;
}

const within = (a, b, tol = 2) => Math.abs(a - b) <= tol;

/**
 * Table 11.6. Each year row is revenue, % of GDP, expenses, %, net operating balance, %, net capital investment, %,
 * fiscal balance, %. A row must add up (revenue − expenses = net operating balance; that − net capital investment =
 * fiscal balance, within $2m of rounding) or the parse fails. Returns outcomes only, oldest first, plus the estimates
 * that were left out.
 */
export function parseFiscal(tables) {
  const rows = yearRows(tables, 'Table 11.6:');
  if (!rows.length) throw new Error('Table 11.6 (fiscal balance) not found');
  const out = [], estimates = [];
  for (const r of rows) {
    const v = r.values;
    if (v.length !== 10 || v.some((x) => x == null)) throw new Error(`Table 11.6 ${r.fy}: expected 10 figures, got ${JSON.stringify(v)}`);
    const [revenue, , expenses, , nob, , nci, , fb, fbPct] = v;
    if (!within(revenue - expenses, nob)) throw new Error(`Table 11.6 ${r.fy}: revenue − expenses = ${revenue - expenses} but net operating balance = ${nob}`);
    if (!within(nob - nci, fb)) throw new Error(`Table 11.6 ${r.fy}: net operating balance − net capital investment = ${nob - nci} but fiscal balance = ${fb}`);
    if (r.estimate) { estimates.push(r.fy); continue; }
    out.push({ fy: r.fy, revenue, expenses, nob, nci, fiscalBalance: fb, fiscalBalancePct: fbPct });
  }
  return check(out, estimates, 'Table 11.6');
}

/**
 * Table 11.1. Each year row is receipts, % of GDP, payments, real growth (na in the first year), % of GDP, net Future
 * Fund earnings ("-" before 2005–06), underlying cash balance, %. From 2005–06 to 2019–20 the balance is receipts −
 * payments − net Future Fund earnings; otherwise receipts − payments (the table's note (d)). Checked the same way.
 */
export function parseUnderlyingCash(tables) {
  const rows = yearRows(tables, 'Table 11.1:');
  if (!rows.length) throw new Error('Table 11.1 (underlying cash balance) not found');
  const out = [], estimates = [];
  for (const r of rows) {
    const v = r.values;
    if (v.length !== 8 || v.some((x) => x === undefined)) throw new Error(`Table 11.1 ${r.fy}: expected 8 figures, got ${JSON.stringify(v)}`);
    const [receipts, , payments, , , ff, ucb, ucbPct] = v;
    const start = Number(r.fy.slice(0, 4));
    const less = start >= 2005 && start <= 2019 ? ff : 0;
    if (!within(receipts - payments - less, ucb)) throw new Error(`Table 11.1 ${r.fy}: receipts − payments${less ? ' − net Future Fund earnings' : ''} = ${receipts - payments - less} but underlying cash balance = ${ucb}`);
    if (r.estimate) { estimates.push(r.fy); continue; }
    out.push({ fy: r.fy, receipts, payments, futureFund: ff, underlyingCash: ucb, underlyingCashPct: ucbPct });
  }
  return check(out, estimates, 'Table 11.1');
}

/** Outcomes run year after year, with no estimate before the last outcome. */
function check(out, estimates, table) {
  if (!out.length) throw new Error(`${table}: no outcome years`);
  const start = (fy) => Number(fy.slice(0, 4));
  for (let i = 1; i < out.length; i++) if (start(out[i].fy) !== start(out[i - 1].fy) + 1) throw new Error(`${table}: ${out[i - 1].fy} is followed by ${out[i].fy}`);
  if (estimates.some((e) => start(e) <= start(out.at(-1).fy))) throw new Error(`${table}: an estimate comes before the last outcome`);
  return { rows: out, estimates };
}

/** "Budget 2026–27" from the Budget Paper page's title, or null. */
export function budgetName(html) {
  const t = cleanText((html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/&ndash;/g, '–'));
  return t.match(/Budget \d{4}[–-]\d{2}/)?.[0]?.replace('-', '–') ?? null;
}

/** The Statement 11 .docx link on the Budget Paper No. 1 page, absolute, or null. */
export function statement11Url(html, base) {
  const href = html.match(/href="([^"]*bp1_bs-11\.docx)"/i)?.[1];
  return href ? new URL(href, base).toString() : null;
}

/**
 * Treasury's fiscal balance against the IMF's quarterly GFS (Commonwealth net lending, four quarters to June), by
 * financial year where both have it. Gross: off by more than 25% of the larger and by more than $2bn, which is a
 * different measure, not a revision. Returns the lines for the log and the gross years.
 */
export function reconcile(treasury, imf) {
  const lines = [], gross = [];
  for (const [fy, t] of treasury) {
    const i = imf.get(fy);
    if (i == null) continue;
    const diff = t - i, rel = Math.abs(diff) / Math.max(Math.abs(t), Math.abs(i), 1);
    const isGross = rel > 0.25 && Math.abs(diff) > 2000;
    if (isGross) gross.push(fy);
    lines.push(`${fy}: Treasury ${t.toLocaleString('en-AU')} IMF ${i.toLocaleString('en-AU')} difference ${diff.toLocaleString('en-AU')} (${(rel * 100).toFixed(1)}%)${isGross ? ' GROSS' : ''}`);
  }
  return { lines, gross };
}
