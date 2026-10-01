/**
 * Figures in prose: which numbers a piece of copy states, and whether each one
 * traces to source data. Shared by the pitch revision guard and the article
 * fact check. Signs are dropped on both sides ("-0.2%" reads as 0.2), so
 * compare values that went through numbersIn.
 */

const YEAR = (n) => Number.isInteger(n) && n >= 1900 && n <= 2100;

// Words that introduce an identifier rather than a figure: "ABS 6345.0", "cat. no. 5206.0", "Table D2".
const IDENT_BEFORE = /(?:\bABS|\bcat(?:alogue)?\.?(?:\s*no\.?)?|\btable|\bseries(?:\s*id)?)\s*$/i;

export function numbersIn(text) {
  const out = [];
  const src = String(text ?? '');
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|pp|per ?cent|bps?|basis points)?/gi;
  for (const m of src.matchAll(re)) {
    const n = Number((m[1] + (m[2] ?? '')).replace(/,/g, ''));
    const unit = m[3];
    const before = src.slice(Math.max(0, m.index - 16), m.index);
    // Digits inside a code are not figures: "A2325846C", "Q2", "D2".
    if (/[A-Za-z]$/.test(before)) continue;
    if (!unit && IDENT_BEFORE.test(before)) continue;
    // ABS catalogue numbers are written "6345.0".
    if (!unit && /^\d{4}$/.test(m[1]) && m[2] === '.0' && !/\$\s*$/.test(before)) continue;
    // Small bare integers are counts ("three hikes", "5 suburbs"); years are dates.
    if (!unit && Number.isInteger(n) && n <= 12) continue;
    if (YEAR(n) && !unit) continue;
    out.push(n);
  }
  return out;
}

/** Every number in the source material, plus thousand/million/billion rescalings. */
export function allowedNumbers(...sources) {
  const set = [];
  for (const src of sources) {
    for (const n of numbersIn(typeof src === 'string' ? src : JSON.stringify(src ?? ''))) {
      set.push(n, n / 1e3, n / 1e6, n / 1e9, n * 100);
    }
  }
  return set;
}

/** True when n matches an allowed value, allowing 1 dp rounding or rounding to an integer. */
export function isSupported(n, allowed) {
  return allowed.some((a) => Math.abs(a - n) < 0.051 || Math.round(a) === n);
}
