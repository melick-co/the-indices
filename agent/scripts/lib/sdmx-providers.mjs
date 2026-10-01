/**
 * BIS and IMF SDMX endpoints for the source scout and the registry loader.
 * Both are official, keyless APIs:
 *   BIS  https://stats.bis.org/api/v1      SDMX 2.1, ISO2 country codes
 *   IMF  https://api.imf.org/external/sdmx/3.0  SDMX 3.0 (JSON 2.0), ISO3 codes, `*` wildcards
 * Every function returns the same shapes as the ABS/OECD helpers in scout-sources.mjs.
 */
import { parseSdmxSeries } from './sdmx-json.mjs';

const UA = 'caveat-indices/0.1 (+https://the-indices.vercel.app)';

// ISO 3166 alpha-2 to alpha-3 for the countries BIS reports. Aggregates (5R, XM...) are dropped.
const ISO2_TO_3 = {
  AR: 'ARG', AT: 'AUT', AU: 'AUS', BE: 'BEL', BG: 'BGR', BR: 'BRA', CA: 'CAN', CH: 'CHE', CL: 'CHL',
  CN: 'CHN', CO: 'COL', CR: 'CRI', CY: 'CYP', CZ: 'CZE', DE: 'DEU', DK: 'DNK', EE: 'EST', ES: 'ESP',
  FI: 'FIN', FR: 'FRA', GB: 'GBR', GR: 'GRC', HK: 'HKG', HR: 'HRV', HU: 'HUN', ID: 'IDN', IE: 'IRL',
  IL: 'ISR', IN: 'IND', IS: 'ISL', IT: 'ITA', JP: 'JPN', KR: 'KOR', LT: 'LTU', LU: 'LUX', LV: 'LVA',
  MA: 'MAR', MK: 'MKD', MT: 'MLT', MX: 'MEX', MY: 'MYS', NL: 'NLD', NO: 'NOR', NZ: 'NZL', PE: 'PER',
  PH: 'PHL', PL: 'POL', PT: 'PRT', RO: 'ROU', RS: 'SRB', RU: 'RUS', SA: 'SAU', SE: 'SWE', SG: 'SGP',
  SI: 'SVN', SK: 'SVK', TH: 'THA', TR: 'TUR', TW: 'TWN', UA: 'UKR', US: 'USA', ZA: 'ZAF',
};

async function getJson(url, accept, attempts = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { accept, 'user-agent': UA }, signal: AbortSignal.timeout(120000) });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (!(res.status >= 500 || res.status === 429) || i >= attempts) {
      throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(5000 * 2 ** (i - 1), 60000)));
  }
}

const PROVIDERS = {
  bis: {
    base: 'https://stats.bis.org/api/v1',
    structureAccept: 'application/vnd.sdmx.structure+json;version=1.0.0',
    dataAccept: 'application/vnd.sdmx.data+json;version=1.0.0',
    areaDim: 'REF_AREA',
    wildcard: '',
    toIso3: (code) => ISO2_TO_3[code] ?? null,
    catalogueUrl: (b) => `${b}/dataflow/BIS/all/latest`,
    // flow is the BIS dataflow id, e.g. WS_SPP
    structureUrl: (b, flow) => `${b}/dataflow/BIS/${flow}/latest?references=all`,
    dataUrl: (b, flow, key, start) => `${b}/data/${flow}/${key}?startPeriod=${start}`,
    flowOf: (f) => f.id,
    keep: () => true,
  },
  imf: {
    base: 'https://api.imf.org/external/sdmx/3.0',
    structureAccept: 'application/json',
    dataAccept: 'application/json',
    areaDim: 'COUNTRY',
    wildcard: '*',
    toIso3: (code) => (/^[A-Z]{3}$/.test(code) ? code : null),
    catalogueUrl: (b) => `${b}/structure/dataflow/all/*/+`,
    // flow is "AGENCY,ID", e.g. IMF.STA,QGFS
    structureUrl: (b, flow) => { const [a, id] = flow.split(','); return `${b}/structure/dataflow/${a}/${id}/+?references=all`; },
    // The time filter only works in the series' own period format, so filter by period after fetching.
    dataUrl: (b, flow, key) => { const [a, id] = flow.split(','); return `${b}/data/dataflow/${a}/${id}/+/${key}`; },
    flowOf: (f) => `${f.agencyID},${f.id}`,
    // Frozen release vintages and projection datasets (WEO, Fiscal Monitor) are not observations.
    keep: (f) => !/_VINTAGE$/.test(f.id) && !/^(WEO|FM)$/.test(f.id),
  },
};

export const SDMX_PROVIDERS = Object.keys(PROVIDERS);

/** [{ flow, name }] for the provider's live catalogue. */
export async function catalogue(provider) {
  const p = PROVIDERS[provider];
  const json = await getJson(p.catalogueUrl(p.base), p.structureAccept);
  return (json?.data?.dataflows ?? [])
    .filter(p.keep)
    .map((f) => ({ flow: p.flowOf(f), name: f.name ?? f.names?.en ?? '' }));
}

/** Codelist id for a dimension: inline representation (SDMX 2.1) or via its concept (SDMX 3.0). */
function codelistIdOf(dim, data) {
  const direct = dim.localRepresentation?.enumeration;
  const urn = direct ?? (() => {
    const m = String(dim.conceptIdentity ?? '').match(/Concept=([^:]+):([^(]+)\([^)]*\)\.(.+)$/);
    if (!m) return null;
    const scheme = (data.conceptSchemes ?? []).find((s) => s.id === m[2]);
    return scheme?.concepts?.find((c) => c.id === m[3])?.coreRepresentation?.enumeration ?? null;
  })();
  return String(urn ?? '').match(/Codelist=[^:]+:([^(]+)\(/)?.[1] ?? null;
}

/** Dimensions in key order with codes ({ id, total, codes: [{id, name}] }), trimmed by search words. */
export async function dimensions(provider, flow, words, limit = 40) {
  const p = PROVIDERS[provider];
  const json = await getJson(p.structureUrl(p.base, flow), p.structureAccept);
  const data = json?.data ?? {};
  const dims = data.dataStructures?.[0]?.dataStructureComponents?.dimensionList?.dimensions ?? [];
  const actual = [...(data.contentConstraints ?? []), ...(data.dataConstraints ?? [])].find((c) => /actual/i.test(c.type ?? c.role ?? ''));
  const allowed = {};
  for (const kv of actual?.cubeRegions?.[0]?.keyValues ?? []) allowed[kv.id] = new Set(kv.values?.map((v) => v.value ?? v));
  return dims.map((d) => {
    const clId = codelistIdOf(d, data) ?? (d.id === 'FREQUENCY' || d.id === 'FREQ' ? 'CL_FREQ' : `CL_${d.id}`);
    let codes = ((data.codelists ?? []).find((c) => c.id === clId)?.codes ?? [])
      .map((c) => ({ id: c.id, name: c.name ?? c.names?.en ?? '' }));
    // BIS publishes an incomplete "actual" constraint (WS_SPP lists only nominal, yet real data exists),
    // so it is not used to filter BIS codes.
    if (allowed[d.id] && provider !== 'bis') codes = codes.filter((c) => allowed[d.id].has(c.id));
    const total = codes.length;
    if (total > limit) {
      const rel = codes.filter((c) => words.some((w) => c.name.toLowerCase().includes(w)));
      const keep = new Map([...codes.slice(0, limit - Math.min(rel.length, 20)), ...rel.slice(0, 20)].map((c) => [c.id, c]));
      codes = [...keep.values()];
    }
    return { id: d.id, total, codes };
  });
}

export function wildcardOf(provider) {
  return PROVIDERS[provider].wildcard;
}

/**
 * Observations for a key, with entities as ISO3 codes:
 * [{ entity, period, value, obsStatus, dims }]. Rows for unmapped areas are dropped.
 */
export async function fetchRows(provider, flow, key, startPeriod = '2000') {
  const p = PROVIDERS[provider];
  const json = await getJson(p.dataUrl(p.base, flow, key, startPeriod), p.dataAccept);
  return parseSdmxSeries(json)
    .map((r) => ({ ...r, entity: p.toIso3(r.dims[p.areaDim]) }))
    // "2015", "2015-Q1" and "2015-01" all compare correctly as strings against a year.
    .filter((r) => r.entity && Number.isFinite(r.value) && r.period >= startPeriod);
}
