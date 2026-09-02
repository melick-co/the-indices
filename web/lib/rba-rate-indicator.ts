import { createClient } from '@/lib/supabase-server';

export type RateProbabilities = {
  hike: number;
  hold: number;
  cut: number;
};

export type RbaRateIndicator = {
  meetingDate: string;
  meetingLabel: string;
  asOf: string | null;
  cashRate: number | null;
  cpi: number | null;
  creditGrowth12m: number | null;
  asxSymbol: string | null;
  asxImpliedYield: number | null;
  market: RateProbabilities | null;
  fundamentals: RateProbabilities | null;
  marketBasis: string | null;
  fundamentalsBasis: string | null;
};

const MARKET_IDS = {
  hike: 'rba_hike_prob_market_au',
  hold: 'rba_hold_prob_market_au',
  cut: 'rba_cut_prob_market_au',
} as const;

const FUND_IDS = {
  hike: 'rba_hike_prob_fundamentals_au',
  hold: 'rba_hold_prob_fundamentals_au',
  cut: 'rba_cut_prob_fundamentals_au',
} as const;

function fmtMeeting(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function latestMetric(supabase: ReturnType<typeof createClient>, metricId: string) {
  const { data } = await supabase.from('observations')
    .select('value, period, status')
    .eq('metric_id', metricId)
    .eq('entity', 'AUS')
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: meta } = await supabase.from('metrics')
    .select('basis, source_published')
    .eq('metric_id', metricId)
    .maybeSingle();
  return { ...data, basis: meta?.basis ?? null, published: meta?.source_published ?? null };
}

async function loadProbs(
  supabase: ReturnType<typeof createClient>,
  ids: { hike: string; hold: string; cut: string },
): Promise<{ probs: RateProbabilities | null; period: string | null; basis: string | null }> {
  const [hike, hold, cut] = await Promise.all([
    latestMetric(supabase, ids.hike),
    latestMetric(supabase, ids.hold),
    latestMetric(supabase, ids.cut),
  ]);
  if (hike?.value == null || hold?.value == null || cut?.value == null) {
    return { probs: null, period: hike?.period ?? null, basis: hike?.basis ?? null };
  }
  return {
    probs: { hike: hike.value, hold: hold.value, cut: cut.value },
    period: hike.period,
    basis: hike.basis,
  };
}

export async function loadRbaRateIndicator(): Promise<RbaRateIndicator> {
  const supabase = createClient();
  const [market, fundamentals, cash, cpi, credit, asx] = await Promise.all([
    loadProbs(supabase, MARKET_IDS),
    loadProbs(supabase, FUND_IDS),
    latestMetric(supabase, 'cash_rate_au'),
    latestMetric(supabase, 'inflation_rate'),
    latestMetric(supabase, 'credit_housing_12m_au'),
    latestMetric(supabase, 'asx_ib_implied_yield_au'),
  ]);

  const meetingDate = market.period ?? fundamentals.period ?? '';
  const asOf = new Date().toISOString().slice(0, 10);

  return {
    meetingDate,
    meetingLabel: meetingDate ? fmtMeeting(meetingDate) : 'Next RBA Board meeting',
    asOf,
    cashRate: cash?.value ?? null,
    cpi: cpi?.value ?? null,
    creditGrowth12m: credit?.value ?? null,
    asxSymbol: asx?.basis?.match(/IB[A-Z0-9]+/)?.[0] ?? null,
    asxImpliedYield: asx?.value ?? null,
    market: market.probs,
    fundamentals: fundamentals.probs,
    marketBasis: market.basis,
    fundamentalsBasis: fundamentals.basis,
  };
}

export const INDICATOR_LIST = [
  {
    id: 'rba-rate-rise',
    name: 'RBA rate rise at next meeting',
    concept: 'Market-implied and fundamentals-based probability of a 25bp hike',
    href: '/indicators/rba-rate-rise',
  },
] as const;
