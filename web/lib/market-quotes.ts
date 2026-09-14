export type HistoryPoint = { period: string; value: number };

export type Quote = {
  value: number;
  period: string;
  changePct: number | null;
  history: HistoryPoint[];
};

const UA = 'Caveat-Markets/0.1 (+https://the-indices.vercel.app)';
const HISTORY = 90;

async function getText(url: string, timeoutMs = 12000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/csv,application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.text();
}

async function getJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json() as Promise<T>;
}

function changePct(history: HistoryPoint[]): number | null {
  if (history.length < 2) return null;
  const prev = history[history.length - 2].value;
  const last = history[history.length - 1].value;
  if (!prev) return null;
  return ((last - prev) / prev) * 100;
}

function takeLast(points: HistoryPoint[], n = HISTORY): HistoryPoint[] {
  return points.slice(-n);
}

export async function quoteYahoo(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`;
  const data = await getJson<{
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number; regularMarketTime?: number };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  }>(url);

  const result = data.chart?.result?.[0];
  if (!result) throw new Error(data.chart?.error?.description ?? `No Yahoo chart for ${symbol}`);

  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const history: HistoryPoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const value = closes[i];
    if (value == null || !Number.isFinite(value)) continue;
    const period = new Date(stamps[i] * 1000).toISOString().slice(0, 10);
    history.push({ period, value });
  }
  const trimmed = takeLast(history);
  const last = trimmed.at(-1);
  const live = result.meta?.regularMarketPrice;
  const value = live ?? last?.value;
  if (value == null) throw new Error(`No last price for ${symbol}`);
  const period = result.meta?.regularMarketTime
    ? new Date(result.meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : last?.period ?? new Date().toISOString().slice(0, 10);
  if (last && last.period === period) trimmed[trimmed.length - 1] = { period, value };
  else trimmed.push({ period, value });
  return { value, period, changePct: changePct(trimmed), history: takeLast(trimmed) };
}

export async function quoteFred(seriesId: string): Promise<Quote> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  const text = await getText(url);
  const history = parseCsvSeries(text);
  const last = history.at(-1);
  if (!last) throw new Error(`No FRED observations for ${seriesId}`);
  return { value: last.value, period: last.period, changePct: changePct(history), history };
}

type FrankfurterLatest = {
  date: string;
  rates: Record<string, number>;
};

export async function quoteFrankfurter(base: string, quote: string): Promise<Quote> {
  const latest = await getJson<FrankfurterLatest>(
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`,
  );
  const value = latest.rates[quote];
  if (value == null) throw new Error(`No Frankfurter rate for ${base}/${quote}`);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 180);
  const startStr = start.toISOString().slice(0, 10);
  let history: HistoryPoint[] = [{ period: latest.date, value }];
  try {
    const series = await getJson<{ rates: Record<string, Record<string, number>> }>(
      `https://api.frankfurter.app/${startStr}..?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`,
    );
    history = Object.entries(series.rates)
      .map(([period, rates]) => ({ period, value: rates[quote] }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.period.localeCompare(b.period));
    if (!history.some((p) => p.period === latest.date)) {
      history.push({ period: latest.date, value });
    }
  } catch {
    /* latest print is enough */
  }
  const trimmed = takeLast(history);
  return { value, period: latest.date, changePct: changePct(trimmed), history: trimmed };
}

/** Pull a numeric series out of a CSV blob. Prefers Close / VALUE / rate columns. */
export function parseCsvSeries(text: string): HistoryPoint[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsv(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const valueIdx = pickValueColumn(header);
  const dateIdx = pickDateColumn(header);
  if (valueIdx < 0 || dateIdx < 0) return [];

  const points: HistoryPoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsv(line).map((c) => c.replace(/^"|"$/g, ''));
    const raw = cols[valueIdx]?.trim();
    const period = normalizePeriod(cols[dateIdx]?.trim());
    if (!raw || raw === '.' || raw === 'NA' || !period) continue;
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    points.push({ period, value });
  }
  return takeLast(points);
}

function pickValueColumn(header: string[]): number {
  const ranked = ['close', 'value', 'dgs10', 'rate', 'adj close', 'price', 'last'];
  const lower = header.map((h) => h.toLowerCase());
  for (const name of ranked) {
    const i = lower.indexOf(name);
    if (i >= 0) return i;
  }
  return lower.findIndex((h, i) => i !== 0 && h !== 'open' && h !== 'high' && h !== 'low' && h !== 'volume');
}

function pickDateColumn(header: string[]): number {
  const lower = header.map((h) => h.toLowerCase());
  const named = lower.findIndex((h) => h === 'date' || h === 'period' || h === 'time' || h === 'observation_date');
  return named >= 0 ? named : 0;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizePeriod(raw?: string): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function looksLikeCsv(text: string): boolean {
  const sample = text.slice(0, 400);
  if (sample.includes('<html') || sample.includes('<!DOCTYPE')) return false;
  const first = sample.split(/\r?\n/).find((l) => l.trim());
  return Boolean(first && first.includes(',') && splitCsv(first).length >= 2);
}
