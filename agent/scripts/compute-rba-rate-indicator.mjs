/**
 * Compute RBA next-meeting rate probabilities (market + fundamentals) and upsert to Supabase.
 *
 *   node scripts/compute-rba-rate-indicator.mjs
 */
import { createDb, upsertSeries } from './lib/obs-loader.mjs';
import { nextRbaMeeting, meetingDayFractions } from './lib/rba-meetings.mjs';
import {
  fetchAsxIbContracts,
  selectContract,
  marketProbabilities,
} from './lib/asx-ir.mjs';
import { fundamentalsProbabilities } from './lib/rba-fundamentals.mjs';

const ENTITY = 'AUS';

const MARKET_METRICS = [
  { metric_id: 'rba_hike_prob_market_au', name: 'RBA hike probability (market)', field: 'hike' },
  { metric_id: 'rba_hold_prob_market_au', name: 'RBA hold probability (market)', field: 'hold' },
  { metric_id: 'rba_cut_prob_market_au', name: 'RBA cut probability (market)', field: 'cut' },
];

const FUND_METRICS = [
  { metric_id: 'rba_hike_prob_fundamentals_au', name: 'RBA hike probability (fundamentals)', field: 'hike' },
  { metric_id: 'rba_hold_prob_fundamentals_au', name: 'RBA hold probability (fundamentals)', field: 'hold' },
  { metric_id: 'rba_cut_prob_fundamentals_au', name: 'RBA cut probability (fundamentals)', field: 'cut' },
];

async function latestObs(db, metricId) {
  const { data, error } = await db.from('observations')
    .select('value, period, status')
    .eq('metric_id', metricId)
    .eq('entity', ENTITY)
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertProbSeries(db, defs, probs, period, basis, source) {
  for (const def of defs) {
    await upsertSeries(db, {
      metric_id: def.metric_id,
      name: def.name,
      unit: 'percent probability',
      basis,
      direction: 'neutral',
      category: 'monetary',
      source_org: source.org,
      source_dataset: source.dataset,
      source_url: source.url,
      source_tier: source.tier,
    }, [{
      metric_id: def.metric_id,
      entity: ENTITY,
      period,
      value: probs[def.field],
      status: 'derived',
    }]);
  }
}

async function main() {
  const db = createDb();
  const meeting = nextRbaMeeting(new Date());
  const { nb, na } = meetingDayFractions(meeting.date);
  const period = meeting.iso;

  const cashObs = await latestObs(db, 'cash_rate_au');
  if (cashObs?.value == null) {
    throw new Error('No cash_rate_au observation — run watch-rba.mjs first');
  }
  const cashRate = cashObs.value;

  let cpiObs = await latestObs(db, 'inflation_rate');
  if (!cpiObs) cpiObs = await latestObs(db, 'cpi_au');
  const creditObs = await latestObs(db, 'credit_housing_12m_au');

  const contracts = await fetchAsxIbContracts();
  const contract = selectContract(contracts, meeting.date);
  if (!contract) {
    throw new Error(`No ASX IB contract for meeting month ${period}`);
  }

  const market = marketProbabilities(cashRate, contract.yieldPct, nb, na);
  const fundamentals = fundamentalsProbabilities({
    cashRate,
    cpi: cpiObs?.value ?? 3.0,
    creditGrowth12m: creditObs?.value ?? null,
  });

  const marketBasis =
    `Market-implied from ASX ${contract.symbol} (${contract.yieldPct.toFixed(3)}% implied ` +
    `monthly OCR avg). Meeting ${period}, nb=${nb.toFixed(3)}, na=${na.toFixed(3)}. ` +
    `Assumes 25bp steps. Post-meeting implied ${market.impliedPostRate}%.`;
  const fundBasis =
    `Derived model: CPI gap vs 2.5% target, real rate (cash − CPI), housing credit growth. ` +
    `Not an RBA forecast. Score ${fundamentals.score}.`;

  await upsertProbSeries(db, MARKET_METRICS, market, period, marketBasis, {
    org: 'ASX',
    dataset: '30-day interbank cash rate futures',
    url: 'https://www.asx.com.au/markets/trade-our-derivatives-market/futures-market/rba-rate-tracker',
    tier: 2,
  });

  await upsertProbSeries(db, FUND_METRICS, fundamentals, period, fundBasis, {
    org: 'Caveat',
    dataset: 'RBA rate indicator fundamentals model',
    url: 'https://the-indices.vercel.app/indicators/rba-rate-rise',
    tier: 2,
  });

  await upsertSeries(db, {
    metric_id: 'asx_ib_implied_yield_au',
    name: 'ASX IB implied monthly OCR yield',
    unit: 'percent per annum',
    basis: `${contract.symbol} last ${contract.price}`,
    direction: 'neutral',
    category: 'monetary',
    source_org: 'ASX',
    source_url: 'https://asx.api.markitdigital.com/asx-research/1.0/derivatives/interest-rate/IB/futures',
    source_tier: 2,
  }, [{
    metric_id: 'asx_ib_implied_yield_au',
    entity: ENTITY,
    period,
    value: contract.yieldPct,
    status: 'derived',
  }]);

  console.log(JSON.stringify({
    meeting: period,
    cash_rate: cashRate,
    cpi: cpiObs?.value ?? null,
    credit_12m: creditObs?.value ?? null,
    asx: { symbol: contract.symbol, price: contract.price, yield: contract.yieldPct },
    market,
    fundamentals,
  }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
