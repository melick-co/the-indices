/**
 * Read-only: print every economy-dashboard reading and its summary, to check coverage and wording against the
 * full data (the public site reads with the service role; local development can only see public series).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/dashboard-check.ts
 */
import { loadEconomyDashboard, formatReading } from '@/lib/economy-dashboard';

async function main() {
  for (const { section, headline, others } of await loadEconomyDashboard()) {
    console.log(`\n## ${section.title}`);
    for (const r of [headline, ...others]) {
      const v = r.latest ? `${formatReading(r.latest.value, r.indicator.unit)} (${r.latest.period})` : 'NO DATA';
      console.log(`- ${r === headline ? '[headline] ' : ''}${r.indicator.label}: ${v} · ${r.verdict || r.status} · history ${r.history.length}${r.peers ? ` · OECD ${r.peers.rank}/${r.peers.of} (${r.peers.period})` : ''}`);
      for (const s of r.summary) console.log(`    ${s}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
