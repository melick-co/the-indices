export type HistoryPoint = { period: string; value: number };

export type MarketKind = 'bond' | 'equity' | 'forex' | 'other';
export type MarketProvider = 'store' | 'yahoo' | 'fred' | 'frankfurter' | 'url' | 'manual';
export type MarketStatus = 'watching' | 'proposed' | 'in_store' | 'dropped';

export type MarketWatch = {
  watch_id: string;
  kind: MarketKind;
  label: string;
  symbol: string | null;
  provider: MarketProvider;
  source_url: string | null;
  org: string | null;
  unit: string | null;
  notes: string | null;
  why: string | null;
  cadence: string | null;
  proposed_tier: number | null;
  status: MarketStatus;
  builtin: boolean;
  linked_source_id: string | null;
  linked_metric_id: string | null;
  linked_suggestion: string | null;
  last_value: number | null;
  last_period: string | null;
  last_change_pct: number | null;
  last_fetched: string | null;
  history: HistoryPoint[];
};

export function formatWatchValue(watch: MarketWatch): string {
  if (watch.last_value == null) return '—';
  const n = watch.last_value;
  if (watch.unit === 'percent') return `${n.toFixed(2)}%`;
  if (watch.unit === 'index') {
    return n >= 100
      ? n.toLocaleString('en-AU', { maximumFractionDigits: 0 })
      : n.toFixed(2);
  }
  if (Math.abs(n) >= 100) return n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(4);
}

export function formatChange(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
