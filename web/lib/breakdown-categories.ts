/**
 * Which ABS breakdown categories are real countries. The country lists also carry residual groups the ABS marks like
 * countries: "Not stated/Inadequately described" (NI), regional remainders such as "Other South-East Asia" (OT1–OT9),
 * "…, nec" (not elsewhere classified) and the Antarctic and external territories. They must never rank as countries.
 */
export function isCountryItem(code: string, name: string, level: string): boolean {
  if (level !== 'item') return false;
  if (code === 'NI' || /^OT\d$/.test(code)) return false;
  if (/\bnec\b|not stated|inadequately described|antarctic|external territories/i.test(name)) return false;
  return true;
}
