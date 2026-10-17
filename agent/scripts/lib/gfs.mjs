/**
 * The government's profit and loss: Government Finance Statistics (GFS) statement of operations, quarterly.
 * Shared by agent/scripts/load-gfs.mjs and web/lib/gov-pnl.ts; keep it dependency-free.
 *
 * Source: IMF Quarterly Government Finance Statistics (QGFS), statement of operations (ACCOUNTS=SOO), Australia, as
 * reported by the Australian authorities (GFSM 2001/2014 basis, accrual, original, current prices). The ABS Data API
 * has no GFS dataflow, so this is the official API that carries it.
 *   cwth  S1321  Central government including social security: the Commonwealth general government sector
 *   all   S13    General government: Commonwealth, state and local combined, consolidated (transfers between
 *                levels netted out, so cwth + states ≠ all)
 */

export const SECTORS = /** @type {const} */ ({ cwth: 'S1321', all: 'S13' });

/**
 * [suffix, IMF indicator, name, optional]. Optional items (no social contributions or grants received for the
 * Commonwealth in some quarters) are left out of the release rather than published as zero; they count as zero in the
 * identities and on the page.
 */
export const ITEMS = /** @type {const} */ ([
  ['revenue', 'G1_T_XDC', 'Revenue', false],
  ['tax', 'G11_T_XDC', 'Taxation revenue', false],
  ['tax_income', 'G111_T_XDC', 'Taxes on income, profits and capital gains', false],
  ['tax_payroll', 'G112_T_XDC', 'Taxes on payroll and workforce', true],
  ['tax_property', 'G113_T_XDC', 'Taxes on property', true],
  ['tax_goods', 'G114_T_XDC', 'Taxes on goods and services (GST, excise and the like)', false],
  ['tax_trade', 'G115_T_XDC', 'Taxes on international trade (customs duty)', true],
  ['tax_other', 'G116_T_XDC', 'Other taxes', true],
  ['social_contrib', 'G12_T_XDC', 'Social contributions', true],
  ['grants_recv', 'G13_T_XDC', 'Grants received', true],
  ['other_rev', 'G14_T_XDC', 'Other revenue (sales of goods and services, interest, dividends and the like)', false],
  ['expense', 'G2_T_XDC', 'Expenses', false],
  ['employees', 'G21_T_XDC', 'Compensation of employees (wages, salaries and superannuation)', false],
  ['goods_services', 'G22_T_XDC', 'Use of goods and services', false],
  ['depreciation', 'G23_T_XDC', 'Consumption of fixed capital (depreciation)', false],
  ['interest', 'G24_T_XDC', 'Interest expense', false],
  ['subsidies', 'G25_T_XDC', 'Subsidies', true],
  ['grants_paid', 'G26_T_XDC', 'Grants paid (including to other levels of government)', false],
  ['social_benefits', 'G27_T_XDC', 'Social benefits (pensions, allowances and other personal benefit payments)', false],
  ['other_exp', 'G28_T_XDC', 'Other expenses', true],
  ['nob', 'GNOB_T_XDC', 'Net operating balance', false],
  ['net_investment', 'G31_A_T_XDC', 'Net acquisition of non-financial assets (investment less depreciation and sales)', false],
  ['nlb', 'GNLB_T_XDC', 'Net lending (+) / net borrowing (−): the fiscal balance', false],
]);

export const TAX_PARTS = ['tax_income', 'tax_payroll', 'tax_property', 'tax_goods', 'tax_trade', 'tax_other'];
export const REVENUE_PARTS = ['tax', 'social_contrib', 'grants_recv', 'other_rev'];
export const EXPENSE_PARTS = ['employees', 'goods_services', 'depreciation', 'interest', 'subsidies', 'grants_paid', 'social_benefits', 'other_exp'];
/** Lines a quarter must have to be stored at all; the rest are its breakdown. */
export const CORE = ['revenue', 'expense', 'nob', 'net_investment', 'nlb'];

const OPTIONAL = new Set(ITEMS.filter(([, , , o]) => o).map(([s]) => s));

/** Metric id for a sector and line, e.g. gfs_cwth_revenue. */
export const gfsId = (sector, suffix) => `gfs_${sector}_${suffix}`;

/** Within rounding: the source is published in whole $ millions (a few older quarters carry fractions). */
export const close = (a, b) => Math.abs(a - b) <= Math.max(5, Math.abs(b) * 0.0005);

/**
 * A line's value for one quarter, or null. Optional lines missing from a quarter that has its breakdown (taxes are
 * there) count as zero; a quarter stored as totals only has no breakdown lines at all.
 */
export function val(q, suffix) {
  const v = q?.[suffix];
  if (v != null && Number.isFinite(v)) return v;
  return OPTIONAL.has(suffix) && q?.tax != null ? 0 : null;
}

/**
 * Identity checks for one quarter ({ suffix: $m }). Core identities gate the quarter; breakdown identities gate its
 * breakdown lines. Returns { core: [failures], breakdown: [failures] }, each failure a sentence for the log.
 */
export function checkQuarter(q) {
  const core = [], breakdown = [];
  for (const s of CORE) if (val(q, s) == null) core.push(`${s} missing`);
  if (!core.length) {
    const [rev, exp, nob, ni, nlb] = CORE.map((s) => val(q, s));
    if (!close(rev - exp, nob)) core.push(`revenue − expenses = ${round(rev - exp)} but net operating balance = ${round(nob)}`);
    if (!close(nob - ni, nlb)) core.push(`net operating balance − net investment = ${round(nob - ni)} but net lending = ${round(nlb)}`);
  }
  const sum = (parts) => parts.reduce((t, s) => (t == null || val(q, s) == null ? null : t + val(q, s)), 0);
  for (const [what, parts, total] of [['taxes', TAX_PARTS, 'tax'], ['revenue', REVENUE_PARTS, 'revenue'], ['expenses', EXPENSE_PARTS, 'expense']]) {
    const s = sum(parts), t = val(q, total);
    if (s == null || t == null) breakdown.push(`${what}: a component is missing`);
    else if (!close(s, t)) breakdown.push(`${what}: components sum to ${round(s)} but the total is ${round(t)}`);
  }
  return { core, breakdown };
}

const round = (v) => Math.round(v).toLocaleString('en-AU');

export const qIndex = (p) => { const [y, q] = p.split('-Q').map(Number); return y * 4 + q - 1; };
export const qLabel = (i) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;

/** The four quarters to `end`, newest first. */
export const fourTo = (end) => Array.from({ length: 4 }, (_, k) => qLabel(qIndex(end) - k));

/** Sum of a line over the four quarters to `end`; null when a quarter is missing (optional lines count as zero). */
export function yearSum(byQuarter, suffix, end) {
  let t = 0;
  for (const p of fourTo(end)) {
    const q = byQuarter.get(p);
    if (!q || q.revenue == null) return null;
    const v = val(q, suffix);
    if (v == null) return null;
    t += v;
  }
  return t;
}

/** Financial year label for a June quarter: 2026-Q2 → "2025–26". */
export const fyLabel = (juneQuarter) => { const y = Number(juneQuarter.slice(0, 4)); return `${y - 1}–${String(y).slice(2)}`; };

/**
 * Breakdown lines that swing by more than three-quarters (and $5bn) against the same quarter a year earlier while their
 * total moves by less than a quarter: a reclassification in the source (the Commonwealth's June quarters move most taxes
 * on goods and services into other taxes) or a one-off (JobKeeper in subsidies). Reported, not enforced.
 */
export function shifts(byQuarter, parts, total) {
  const out = [];
  for (const [period, q] of byQuarter) {
    const prev = byQuarter.get(qLabel(qIndex(period) - 4));
    const t = val(q, total), tp = val(prev, total);
    if (!prev || t == null || tp == null || tp === 0 || Math.abs(t - tp) / Math.abs(tp) >= 0.25) continue;
    for (const line of parts) {
      const v = q[line], b = prev[line];
      if (v == null || b == null) continue;
      if (Math.abs(v - b) > 5000 && Math.abs(v - b) > 0.75 * Math.max(Math.abs(v), Math.abs(b))) out.push({ period, line, value: v, before: b });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * The statement for the four quarters to `end`: { suffix: $m } for every line, plus taxes on goods and services,
 * customs duty and other taxes combined as tax_goods_other (the Commonwealth's June quarters move most of the first
 * into the last, so only the sum is stable year to year), and other_rev_all = revenue − taxes. Breakdown lines are null
 * where a quarter lacks them; the whole statement is null when a core line is missing.
 * @returns {Record<string, number | null> | null}
 */
export function yearStatement(byQuarter, end) {
  /** @type {Record<string, number | null>} */
  const out = {};
  for (const [s] of ITEMS) out[s] = yearSum(byQuarter, s, end);
  if (CORE.some((s) => out[s] == null)) return null;
  const parts = ['tax_goods', 'tax_trade', 'tax_other'];
  out.tax_goods_other = parts.some((s) => out[s] == null) ? null : parts.reduce((t, s) => t + out[s], 0);
  out.other_rev_all = out.tax == null ? null : out.revenue - out.tax;
  return out;
}
