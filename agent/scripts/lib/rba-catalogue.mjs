/**
 * RBA statistical tables for the source scout: the table list from the tables
 * index page, and each CSV's columns (title, frequency, type, units, series id).
 * A registry row for provider 'rba' stores flow = CSV file name, key = column
 * Title, measure = cadence (monthly | quarterly | event).
 */
import { parseRbaCsv } from './rba-csv.mjs';

const SITE = 'https://www.rba.gov.au';
const UA = 'Mozilla/5.0 (compatible; caveat-indices/0.1; +https://the-indices.vercel.app)';

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`RBA ${res.status} for ${url}`);
  return res.text();
}

const decode = (s) => s.replace(/&ndash;/g, '-').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** [{ flow: 'f5-data.csv', name: 'Indicator Lending Rates - F5' }] */
export async function rbaCatalogue() {
  const html = await getText(`${SITE}/statistics/tables/`);
  const out = [];
  for (const li of html.split(/<li[\s>]/).slice(1)) {
    const title = decode(li.match(/<div class="title[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '');
    for (const m of li.matchAll(/href="\/statistics\/tables\/csv\/([a-z0-9-]+\.csv)"[^>]*>([^<]*)</g)) {
      const label = decode(m[2]);
      out.push({ flow: m[1], name: label && label !== 'Data' ? `${title} - ${label}` : title });
    }
  }
  return out.filter((t) => t.name);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function cadenceOf(frequency) {
  const f = String(frequency).toLowerCase();
  if (f.startsWith('quarter')) return 'quarterly';
  if (f.startsWith('month')) return 'monthly';
  return 'event';
}

/** Columns of an RBA CSV as scout "dimension" codes: { id: Title, name: description }. */
export async function rbaColumns(file) {
  const lines = (await getText(`${SITE}/statistics/tables/csv/${file}`)).split(/\r?\n/);
  const row = (label) => splitCsvLine(lines.find((l) => l.replace(/^﻿/, '').startsWith(`${label},`)) ?? '').slice(1);
  const titles = row('Title');
  const freq = row('Frequency');
  const type = row('Type');
  const units = row('Units');
  const ids = row('Series ID');
  return titles.map((t, i) => ({
    id: t,
    name: `${t} | ${freq[i] ?? ''} | ${type[i] ?? ''} | ${units[i] ?? ''} | ${ids[i] ?? ''}`,
    cadence: cadenceOf(freq[i]),
  })).filter((c) => c.id);
}

/** [{ entity: 'AUS', period, value }] for one column. */
export async function rbaRows(file, column, cadence) {
  const text = await getText(`${SITE}/statistics/tables/csv/${file}`);
  return parseRbaCsv(text, column, cadence).map((r) => ({ entity: 'AUS', period: r.period, value: r.value }));
}
