import * as FLAGS from 'country-flag-icons/string/3x2';

/**
 * A country's flag, from its ABS (or World Bank) name: an SVG data URI for <img>, or null when the item isn't a
 * single country ("Other Americas", "Total") or has no flag. Names resolve through the English names Intl knows,
 * plus the ABS spellings that differ from them.
 */
const ALIASES: Record<string, string> = {
  'england': 'GB_ENG', 'scotland': 'GB_SCT', 'wales': 'GB_WLS', 'northern ireland': 'GB_NIR',
  'united kingdom': 'GB', 'uk, cis & iom': 'GB', 'united kingdom, channel islands and isle of man': 'GB',
  'united states': 'US', 'united states of america': 'US', 'usa': 'US',
  'south korea': 'KR', 'korea, south': 'KR', 'korea, republic of (south)': 'KR', 'korea': 'KR',
  'north korea': 'KP', "korea, democratic people's republic of (north)": 'KP',
  'china': 'CN', 'china (excludes sars and taiwan)': 'CN', 'hong kong': 'HK', 'hong kong (sar of china)': 'HK',
  'macau': 'MO', 'macau (sar of china)': 'MO', 'taiwan': 'TW',
  'russia': 'RU', 'russian federation': 'RU', 'vietnam': 'VN', 'viet nam': 'VN', 'laos': 'LA', 'iran': 'IR', 'syria': 'SY',
  'türkiye': 'TR', 'turkiye': 'TR', 'turkey': 'TR', 'czechia': 'CZ', 'czech republic': 'CZ', 'slovak republic': 'SK',
  'myanmar': 'MM', 'myanmar, the republic of the union of': 'MM', 'brunei darussalam': 'BN', 'brunei': 'BN',
  'bolivia, plurinational state of': 'BO', 'venezuela, bolivarian republic of': 'VE', 'tanzania': 'TZ',
  'congo, democratic republic of': 'CD', 'congo, republic of': 'CG', "cote d'ivoire": 'CI', 'cabo verde': 'CV',
  'eswatini': 'SZ', 'palestine': 'PS', 'kosovo': 'XK', 'holy see': 'VA', 'micronesia, federated states of': 'FM',
  'samoa, american': 'AS', 'virgin islands, british': 'VG', 'virgin islands, united states': 'VI',
  'north macedonia': 'MK', 'moldova': 'MD', 'netherlands': 'NL',
};

/** Spellings vary between sources: "&" or "and", "St" or "St.", accents or none. */
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, 'and').replace(/\bst\.? /g, 'saint ').replace(/\s+/g, ' ');

let byName: Map<string, string> | null = null;
function intlNames(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of Object.keys(FLAGS)) {
    if (code.length !== 2) continue;
    try { const n = dn.of(code); if (n && n !== code) byName.set(norm(n), code); } catch { /* not a region */ }
  }
  return byName;
}

export function flagCode(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n || /^(total|other|not stated)|, nec$|\bnec\b/.test(n)) return null;
  const code = ALIASES[n] ?? intlNames().get(norm(n)) ?? intlNames().get(norm(n.replace(/ \(.*\)$/, ''))) ?? null;
  return code && code in FLAGS ? code : null;
}

export function flagSvg(name: string): string | null {
  const code = flagCode(name);
  return code ? (FLAGS as Record<string, string>)[code] : null;
}

export function flagDataUri(name: string): string | null {
  const svg = flagSvg(name);
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;
}
