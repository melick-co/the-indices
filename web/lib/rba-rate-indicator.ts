import { createClient } from '@/lib/supabase-server';

export type RateProbabilities = {
  hike: number;
  hold: number;
  cut: number;
};

export type InputSeriesPoint = { period: string; value: number };

export type InputSeries = {
  metricId: string;
  title: string;
  role: string;
  unit: string;
  step?: boolean;
  subtitle?: string;
  points: InputSeriesPoint[];
  latest: number | null;
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
  inputSeries: InputSeries[];
};

const INPUT_METRICS = [
  {
    metricId: 'cash_rate_au',
    title: 'Cash rate target',
    role: 'Current RBA target (A2)',
    unit: '%',
    step: true,
  },
  {
    metricId: 'inflation_rate',
    title: 'Headline CPI / inflation',
    role: 'Fundamentals: vs 2–3% band',
    unit: '%',
    subtitle: 'Annual vintage where monthly is unavailable',
  },
  {
    metricId: 'credit_housing_12m_au',
    title: 'Housing credit growth (12m)',
    role: 'Fundamentals: demand pulse',
    unit: '%',
  },
  {
    metricId: 'asx_ib_implied_yield_au',
    title: 'ASX IB implied monthly OCR',
    role: 'Market: futures-implied yield',
    unit: '%',
    subtitle: 'Updated when the indicator compute runs',
  },
] as const;

function parsePeriod(period: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return new Date(`${period}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(period)) return new Date(`${period}-01T00:00:00Z`);
  if (/^\d{4}$/.test(period)) return new Date(`${period}-07-01T00:00:00Z`);
  return new Date(period);
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

async function loadSeriesHistory(
  supabase: ReturnType<typeof createClient>,
  metricId: string,
  step = false,
): Promise<InputSeriesPoint[]> {
  const { data } = await supabase.from('observations')
    .select('period, value')
    .eq('metric_id', metricId)
    .eq('entity', 'AUS')
    .order('period', { ascending: true })
    .limit(500);
  const all = (data ?? []).filter((r) => r.value != null) as InputSeriesPoint[];
  const cutoff = monthsAgo(12).getTime();
  const inWindow = all.filter((r) => parsePeriod(r.period).getTime() >= cutoff);
  if (step) {
    const before = all.filter((r) => parsePeriod(r.period).getTime() < cutoff);
    if (before.length && inWindow.length) {
      return [before[before.length - 1], ...inWindow];
    }
    if (before.length && !inWindow.length) {
      return before.slice(-2);
    }
  }
  if (inWindow.length) return inWindow;
  return all.slice(-Math.min(4, all.length));
}

async function loadInputSeries(
  supabase: ReturnType<typeof createClient>,
  asxSymbol: string | null,
): Promise<InputSeries[]> {
  const series = await Promise.all(
    INPUT_METRICS.map(async (def) => {
      const step = 'step' in def ? def.step : false;
      const points = await loadSeriesHistory(supabase, def.metricId, step);
      const latest = points.length ? points[points.length - 1].value : null;
      let subtitle: string | undefined = 'subtitle' in def ? def.subtitle : undefined;
      if (def.metricId === 'asx_ib_implied_yield_au' && asxSymbol) {
        subtitle = `${asxSymbol} · ${subtitle ?? 'ASX futures'}`;
      }
      return {
        ...def,
        points,
        latest,
        subtitle,
      };
    }),
  );
  return series;
}

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
  const inputSeries = await loadInputSeries(supabase, asx?.basis?.match(/IB[A-Z0-9]+/)?.[0] ?? null);

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
    inputSeries,
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
