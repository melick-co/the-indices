/** Parse RBA statistical-table CSV exports (metadata header + data rows). */

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export function parseRbaDate(raw) {
  const s = raw.trim();
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(Date.UTC(+slash[3], +slash[2] - 1, +slash[1]));
  const dash = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dash) return new Date(Date.UTC(+dash[3], MONTHS[dash[2]], +dash[1]));
  return null;
}

export function parseRbaValue(raw) {
  const s = String(raw).trim().replace(/^\+/, '');
  if (!s) return null;
  const range = s.match(/^([\d.]+)\s+to\s+([\d.]+)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function periodFromDate(date, cadence) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (cadence === 'quarterly') return `${y}-Q${Math.ceil(m / 3)}`;
  if (cadence === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} text  raw CSV
 * @param {string} columnTitle  exact Title-row column label
 * @param {'monthly'|'quarterly'|'event'} cadence
 */
export function parseRbaCsv(text, columnTitle, cadence = 'monthly') {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const titleRow = lines.find((l) => l.startsWith('Title,'));
  if (!titleRow) throw new Error('No Title row in RBA CSV');
  const headers = splitCsvLine(titleRow);
  const colIdx = headers.findIndex((h) => h === columnTitle);
  if (colIdx < 0) throw new Error(`Column not found: ${columnTitle}`);

  const sidIdx = lines.findIndex((l) => l.startsWith('Series ID,'));
  if (sidIdx < 0) throw new Error('No Series ID row in RBA CSV');

  const raw = [];
  for (let i = sidIdx + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const date = parseRbaDate(cols[0] ?? '');
    const value = parseRbaValue(cols[colIdx]);
    if (!date || value == null) continue;
    raw.push({ date, value });
  }

  if (cadence === 'event') {
    return raw.map((r) => ({
      period: periodFromDate(r.date, 'event'),
      value: r.value,
    }));
  }

  const byPeriod = new Map();
  for (const r of raw) {
    const period = periodFromDate(r.date, cadence);
    byPeriod.set(period, r.value);
  }
  return [...byPeriod.entries()]
    .map(([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));
}
