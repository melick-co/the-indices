/**
 * Read-only: print every dashboard reading (economy and quality of life) and its summary, to check coverage and wording against the
 * full data (the public site reads with the service role; local development can only see public series).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/dashboard-check.ts
 */
import { loadEconomyDashboard, loadDashboard, formatReading } from '@/lib/economy-dashboard';
import { QOL_SECTIONS } from '@/content/dashboard/quality-of-life';
import { SENTIMENT_SECTIONS } from '@/content/dashboard/sentiment';
import { currentMeasure, headToHead, loadPolls, moodCheck, pollAverage } from '@/lib/polls';
import { loadPnl } from '@/lib/pnl';

async function main() {
  const dashboards = [['Economy', await loadEconomyDashboard()], ['Quality of life', await loadDashboard(QOL_SECTIONS)], ['Sentiment', await loadDashboard(SENTIMENT_SECTIONS)]] as const;
  for (const [name, sections] of dashboards) for (const { section, headline, others } of sections) {
    console.log(`\n## ${name}: ${section.title}`);
    for (const r of [headline, ...others]) {
      const v = r.latest ? `${formatReading(r.latest.value, r.indicator.unit, r.indicator.decimals)} (${r.latest.period})` : 'NO DATA';
      console.log(`- ${r === headline ? '[headline] ' : ''}${r.indicator.label}: ${v} · ${r.verdict || r.status} [${r.status}] · history ${r.history.length}${r.peers ? ` · OECD ${r.peers.rank}/${r.peers.of} (${r.peers.period})` : ''}`);
      for (const s of r.summary) console.log(`    ${s}`);
    }
  }
  const polls = await loadPolls();
  console.log(`\n## Polls: ${polls.length} stored (${polls.filter((p) => p.table === 'vi').length} voting intention, ${polls.filter((p) => p.table === 'dir').length} direction)`);
  for (const m of ['tpp_alp_lnp', 'tpp_alp_onp', 'primary_alp', 'primary_lnp', 'primary_onp', 'primary_grn', 'primary_oth']) {
    const a = pollAverage(polls, m);
    console.log(`- ${m}: ${a ? `${a.value} (${a.n} pollsters: ${a.pollsters.join(', ')}; ${a.from} to ${a.to})` : 'none'}`);
  }
  const net = pollAverage(polls, 'direction_net', 60), wrong = pollAverage(polls, 'direction_wrong', 60);
  console.log(`- direction_net: ${net ? `${net.value} (${net.pollsters.join(', ')}; to ${net.to})` : 'none'}`);
  for (const role of ['pm', 'opposition'] as const) {
    const m = currentMeasure(polls, 'approval_net', role);
    const a = m ? pollAverage(polls, m) : null;
    console.log(`- ${m ?? `approval_net:${role}`}: ${a ? `${a.value} (${a.pollsters.join(', ')}; ${a.from} to ${a.to})` : 'none'}`);
  }
  const h2h = headToHead(polls);
  for (const role of ['pm', 'opposition'] as const) {
    const m = currentMeasure(h2h, 'ppm', role);
    const a = m ? pollAverage(h2h, m) : null;
    console.log(`- preferred PM head-to-head ${m ?? role}: ${a ? `${a.value} (${a.pollsters.join(', ')})` : 'none'}`);
  }
  const consumers = dashboards[2][1].find((s) => s.section.id === 'consumers')!;
  const check = moodCheck(consumers, net, wrong);
  console.log(`- mood check: ${check.verdict}`);
  for (const l of check.lines) console.log(`    ${l}`);
  const pnl = await loadPnl();
  if (!pnl) console.log('\n## Australia Inc.: NO DATA');
  else {
    const { now: n, prior, population, years } = pnl;
    const b = (m: number) => `${(m / 1000).toFixed(1)}bn`;
    console.log(`\n## Australia Inc.: four quarters to ${n.end} (population ${population?.value} at ${population?.period})`);
    for (const [k, v] of Object.entries(n)) if (typeof v === 'number') console.log(`- ${k}: ${b(v)}${prior && typeof (prior as Record<string, unknown>)[k] === 'number' ? ` (a year earlier ${b((prior as unknown as Record<string, number>)[k])})` : ''}`);
    const income = n.coe + n.profitsPrivate + n.profitsFinancial + n.profitsPublic + n.govSurplus + n.homes + n.smallBusiness + n.taxes + n.discrepancy;
    console.log(`- check: income lines sum ${b(income)} vs GDP ${b(n.gdp)}; GDP − paid abroad − depreciation + transfers − consumption = ${b(n.gdp - n.paidAbroad - n.depreciation + n.transfers - n.consumptionHh - n.consumptionGov)} vs saving ${b(n.saving)}`);
    console.log(`- margin by financial year: ${years.slice(-6).map((y) => `${y.fy} ${y.savingRate.toFixed(1)}%`).join(', ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
