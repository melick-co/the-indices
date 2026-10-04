/**
 * Read-only: print every dashboard reading (economy and quality of life) and its summary, to check coverage and wording against the
 * full data (the public site reads with the service role; local development can only see public series).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/dashboard-check.ts
 */
import { loadEconomyDashboard, loadDashboard, formatReading } from '@/lib/economy-dashboard';
import { QOL_SECTIONS } from '@/content/dashboard/quality-of-life';

async function main() {
  const dashboards = [['Economy', await loadEconomyDashboard()], ['Quality of life', await loadDashboard(QOL_SECTIONS)]] as const;
  for (const [name, sections] of dashboards) for (const { section, headline, others } of sections) {
    console.log(`\n## ${name}: ${section.title}`);
    for (const r of [headline, ...others]) {
      const v = r.latest ? `${formatReading(r.latest.value, r.indicator.unit)} (${r.latest.period})` : 'NO DATA';
      console.log(`- ${r === headline ? '[headline] ' : ''}${r.indicator.label}: ${v} · ${r.verdict || r.status} · history ${r.history.length}${r.peers ? ` · OECD ${r.peers.rank}/${r.peers.of} (${r.peers.period})` : ''}`);
      for (const s of r.summary) console.log(`    ${s}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
