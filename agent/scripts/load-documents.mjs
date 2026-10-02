#!/usr/bin/env node
/**
 * Nightly: store official documents as text (agent/supabase/33_source_documents.sql) so the claim audit can
 * check what an article says a source said against the source itself.
 *
 *   node scripts/load-documents.mjs            # RBA statements, minutes, speeches; ABS release pages
 *   node scripts/load-documents.mjs --dry-run  # list what would be fetched
 *   node scripts/load-documents.mjs --recent   # this year's RBA releases and minutes, and ABS release pages
 *
 * Unchanged documents are skipped (content hash). Pages that 404 (e.g. minutes for meetings not yet held,
 * which the RBA index already lists) are skipped quietly.
 */
import { createDb } from './lib/obs-loader.mjs';
import { fetchDocument } from './lib/html-text.mjs';
import { kindOf, storeDocument } from './lib/source-docs.mjs';

const dryRun = process.argv.includes('--dry-run');
const RBA = 'https://www.rba.gov.au';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; caveat-sources/0.1)' };
const year = new Date().getUTCFullYear();
const FIRST_YEAR = 2022;

// ABS release pages the stored series come from; each lists its next release date.
const ABS_RELEASES = [
  'economy/price-indexes-and-inflation/wage-price-index-australia',
  'economy/price-indexes-and-inflation/consumer-price-index-australia',
  'labour/employment-and-unemployment/labour-force-australia',
  'economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product',
  'economy/finance/lending-indicators',
  'industry/building-and-construction/building-approvals-australia',
  'economy/business-indicators/business-indicators-australia',
  'people/population/national-state-and-territory-population',
  'economy/price-indexes-and-inflation/total-value-dwellings',
].map((p) => `https://www.abs.gov.au/statistics/${p}/latest-release`);

async function links(indexUrl, pattern) {
  try {
    const res = await fetch(indexUrl, { headers: UA, signal: AbortSignal.timeout(25000) });
    if (!res.ok) return [];
    const html = await res.text();
    return [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => pattern.test(h)))]
      .map((h) => new URL(h, indexUrl).toString());
  } catch {
    return [];
  }
}

async function main() {
  // Decisions and minutes back to 2022 (the current tightening and easing cycles), speeches this year.
  // --recent (the events watcher): this year's releases and minutes and the ABS release pages only.
  const recent = process.argv.includes('--recent');
  const years = recent ? [year] : Array.from({ length: year - FIRST_YEAR + 1 }, (_, i) => year - i);
  const urls = [];
  for (const y of years) {
    urls.push(...await links(`${RBA}/media-releases/${y}/`, /\/media-releases\/\d{4}\/mr-\d+-\d+\.html$/));
    // The minutes index lists future meetings too; those 404 and are skipped.
    urls.push(...await links(`${RBA}/monetary-policy/rba-board-minutes/${y}/`, /\/rba-board-minutes\/\d{4}\/\d{4}-\d{2}-\d{2}\.html$/));
  }
  if (!recent) urls.push(...await links(`${RBA}/speeches/${year}/`, /\/speeches\/\d{4}\/sp-[a-z0-9-]+\.html$/));
  urls.push(...ABS_RELEASES);
  console.log(`${urls.length} candidate documents`);
  if (dryRun) { for (const u of urls) console.log(`  ${u}`); return; }

  const db = createDb();
  const counts = { new: 0, updated: 0, same: 0, skipped: 0 };
  for (const url of urls) {
    const doc = await fetchDocument(url);
    if (doc.error) { counts.skipped++; if (!/HTTP 404/.test(doc.error)) console.log(`  skip ${url}: ${doc.error}`); continue; }
    // Minutes pages are titled by date only; name them properly.
    const kind = kindOf(url, doc.title ?? '');
    const title = kind === 'minutes' ? `Minutes of the Monetary Policy Board meeting, ${doc.title}` : doc.title;
    const result = await storeDocument(db, { ...doc, kind, title });
    counts[result]++;
    if (result !== 'same') console.log(`  ${result}: ${title}`);
  }
  console.log(`Done. ${counts.new} new, ${counts.updated} updated, ${counts.same} unchanged, ${counts.skipped} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

