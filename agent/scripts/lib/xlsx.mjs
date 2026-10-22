/**
 * A minimal, dependency-free reader for Excel workbooks (.xlsx: a zip of XML parts). Enough for the official
 * government spreadsheets the loaders read (agent/scripts/load-official-workbooks.mjs): sheet names, and each sheet's
 * cells as cached values (text, numbers, booleans; formulas give their last calculated value, which is what Excel
 * shows). Styles, charts, external links and the like are ignored. Treats the file as data only: nothing in it runs.
 * Tested by xlsx.check.mjs.
 */
import { unzipEntry } from './budget-history.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** XML text: entities decoded, Excel's _xHHHH_ escapes decoded. */
export const xmlText = (s) => String(s ?? '')
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e])
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** Text of a shared or inline string: every <t> run joined (rich text has several), phonetic runs left out. */
const stringItem = (si) => xmlText((si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>|<t\/>/g) ?? [])
  .map((t) => t.replace(/<[^>]+>/g, '')).join(''));

/** "A1" → { row: 0, col: 0 }; "AB12" → { row: 11, col: 27 }. */
export function cellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref ?? '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** Column letters for a 0-based index: 0 → A, 27 → AB. */
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Rows of a worksheet's XML as arrays of values (null for an empty cell), given the shared strings. */
export function sheetRows(xml, shared = []) {
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let nextRow = 0;
  for (let rm; (rm = rowRe.exec(xml));) {
    const rAttr = attr(rm[1], 'r');
    const r = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = r + 1;
    const out = rows[r] ?? (rows[r] = []);
    let nextCol = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (let cm; (cm = cellRe.exec(rm[2] ?? ''));) {
      const pos = cellRef(attr(cm[1], 'r'));
      const c = pos ? pos.col : nextCol;
      nextCol = c + 1;
      const t = attr(cm[1], 't') ?? 'n';
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = null;
      if (t === 's') value = v == null ? null : shared[Number(v)] ?? null;
      else if (t === 'inlineStr') value = stringItem(body.match(/<is>[\s\S]*?<\/is>/)?.[0] ?? '');
      else if (t === 'str') value = v == null ? null : xmlText(v);
      else if (t === 'b') value = v == null ? null : v === '1';
      else if (t === 'e') value = null; // #N/A, #REF! and the like: no value
      else if (v != null && v !== '') value = Number(v);
      out[c] = value;
    }
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
  return rows;
}

/**
 * Open a workbook: { names, sheet(name) } where names are the sheet names in workbook order and sheet(name) returns
 * the rows (arrays of values), or null for a sheet that is not there.
 */
export function readWorkbook(buf) {
  const part = (p) => unzipEntry(buf, p)?.toString('utf8') ?? null;
  const wb = part('xl/workbook.xml');
  if (!wb) throw new Error('not an Excel workbook (no xl/workbook.xml)');
  const rels = part('xl/_rels/workbook.xml.rels') ?? '';
  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), t = attr(m[0], 'Target');
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = xmlText(attr(m[0], 'name') ?? '');
    const rid = m[0].match(/\sr:id="([^"]*)"/)?.[1] ?? attr(m[0], 'id');
    if (name && rid && target.has(rid)) sheets.push({ name, path: target.get(rid) });
  }
  const sst = part('xl/sharedStrings.xml');
  const shared = sst ? (sst.match(/<si>[\s\S]*?<\/si>|<si\/>/g) ?? []).map(stringItem) : [];
  const cache = new Map();
  return {
    names: sheets.map((s) => s.name),
    sheet(name) {
      const s = sheets.find((x) => x.name === name);
      if (!s) return null;
      if (!cache.has(name)) {
        const xml = part(s.path);
        cache.set(name, xml ? sheetRows(xml, shared) : null);
      }
      return cache.get(name);
    },
  };
}

/** An Excel date serial (1900 system) as an ISO date: 45748 → 2025-04-01. */
export function excelDate(serial) {
  if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 864e5).toISOString().slice(0, 10);
}

/** Cell text for matching labels: trimmed, spaces collapsed, non-breaking spaces as spaces. */
export const label = (v) => (v == null ? '' : String(v).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim());
