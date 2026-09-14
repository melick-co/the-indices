import { createClient } from '@/lib/supabase-server';
import { loadRecentSeries } from '@/lib/metrics';
import {
  parseCsvSeries,
  quoteFrankfurter,
  quoteFred,
  quoteYahoo,
  type Quote,
} from '@/lib/market-quotes';
import type { HistoryPoint, MarketKind, MarketProvider, MarketStatus, MarketWatch } from '@/lib/market-types';

export type { MarketKind, MarketProvider, MarketStatus, MarketWatch } from '@/lib/market-types';
export { formatChange, formatWatchValue } from '@/lib/market-types';

const STALE_MS = 15 * 60 * 1000;

function asWatch(row: Record<string, unknown>): MarketWatch {
  const history = Array.isArray(row.history) ? row.history as HistoryPoint[] : [];
  return {
    watch_id: String(row.watch_id),
    kind: row.kind as MarketKind,
    label: String(row.label),
    symbol: row.symbol ? String(row.symbol) : null,
    provider: row.provider as MarketProvider,
    source_url: row.source_url ? String(row.source_url) : null,
    org: row.org ? String(row.org) : null,
    unit: row.unit ? String(row.unit) : null,
    notes: row.notes ? String(row.notes) : null,
    why: row.why ? String(row.why) : null,
    cadence: row.cadence ? String(row.cadence) : null,
    proposed_tier: row.proposed_tier == null ? null : Number(row.proposed_tier),
    status: row.status as MarketStatus,
    builtin: Boolean(row.builtin),
    linked_source_id: row.linked_source_id ? String(row.linked_source_id) : null,
    linked_metric_id: row.linked_metric_id ? String(row.linked_metric_id) : null,
    linked_suggestion: row.linked_suggestion ? String(row.linked_suggestion) : null,
    last_value: row.last_value == null ? null : Number(row.last_value),
    last_period: row.last_period ? String(row.last_period) : null,
    last_change_pct: row.last_change_pct == null ? null : Number(row.last_change_pct),
    last_fetched: row.last_fetched ? String(row.last_fetched) : null,
    history,
  };
}

export async function loadMarketWatches(): Promise<MarketWatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('market_watches')
    .select('*')
    .neq('status', 'dropped')
    .order('kind')
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => asWatch(row as Record<string, unknown>));
}

export async function refreshStaleWatches(
  watches: MarketWatch[],
  opts: { force?: boolean } = {},
): Promise<MarketWatch[]> {
  const now = Date.now();
  const stale = watches.filter((w) => {
    if (opts.force || !w.last_fetched) return true;
    return now - new Date(w.last_fetched).getTime() > STALE_MS;
  });
  if (!stale.length) return watches;

  const updates = await Promise.allSettled(stale.map((w) => refreshWatch(w)));
  const byId = new Map(watches.map((w) => [w.watch_id, w]));
  for (const result of updates) {
    if (result.status === 'fulfilled' && result.value) {
      byId.set(result.value.watch_id, result.value);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label);
  });
}

async function refreshWatch(watch: MarketWatch): Promise<MarketWatch | null> {
  const quote = await fetchQuote(watch);
  if (!quote) return watch;
  const supabase = createClient();
  const patch = {
    last_value: quote.value,
    last_period: quote.period,
    last_change_pct: quote.changePct,
    last_fetched: new Date().toISOString(),
    history: quote.history,
    updated_at: new Date().toISOString(),
  };
  await supabase.from('market_watches').update(patch).eq('watch_id', watch.watch_id);
  return { ...watch, ...patch, history: quote.history };
}

export async function fetchQuote(watch: MarketWatch): Promise<Quote | null> {
  try {
    if (watch.provider === 'store' && watch.linked_metric_id) {
      return quoteStore(watch.linked_metric_id);
    }
    if (watch.provider === 'yahoo' && watch.symbol) {
      try {
        return await quoteYahoo(watch.symbol);
      } catch {
        const pair = yahooFxPair(watch.symbol);
        if (pair) return quoteFrankfurter(pair[0], pair[1]);
        return null;
      }
    }
    if (watch.provider === 'fred' && watch.symbol) return quoteFred(watch.symbol);
    if (watch.provider === 'frankfurter' && watch.symbol) {
      const [base, quote] = watch.symbol.split('/');
      if (!base || !quote) return null;
      return quoteFrankfurter(base, quote);
    }
    if (watch.provider === 'url' && watch.source_url) return quoteUrl(watch.source_url);
    return null;
  } catch {
    return null;
  }
}

async function quoteStore(metricId: string): Promise<Quote | null> {
  const series = await loadRecentSeries([metricId], 24);
  const points = series.get(metricId) ?? [];
  const history: HistoryPoint[] = points
    .filter((p) => Number.isFinite(p.value))
    .map((p) => ({ period: p.period, value: p.value }));
  const last = history.at(-1);
  if (!last) return null;
  const prev = history.at(-2);
  const changePct = prev && prev.value
    ? ((last.value - prev.value) / prev.value) * 100
    : null;
  return { value: last.value, period: last.period, changePct, history };
}

async function quoteUrl(url: string): Promise<Quote | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Caveat-Markets/0.1 (+https://the-indices.vercel.app)' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const text = await res.text();
  const history = parseCsvSeries(text);
  const last = history.at(-1);
  if (!last) return null;
  const prev = history.at(-2);
  const changePct = prev && prev.value
    ? ((last.value - prev.value) / prev.value) * 100
    : null;
  return { value: last.value, period: last.period, changePct, history };
}

function yahooFxPair(symbol: string): [string, string] | null {
  const m = symbol.match(/^([A-Z]{3})([A-Z]{3})=X$/);
  return m ? [m[1], m[2]] : null;
}

