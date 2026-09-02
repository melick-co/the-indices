import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteFooter from '@/components/SiteFooter';
import InputSeriesChart from '@/components/InputSeriesChart';
import {
  DIAL_SCALES,
  formatPeriodLabel,
  loadMetricMeta,
  loadSeriesHistory,
} from '@/lib/metrics';

export const dynamic = 'force-dynamic';

const METRIC_PAGES: Record<string, { title?: string; caveat?: string; historyMonths?: number; step?: boolean }> = {
  gdp_per_capita: {
    caveat: 'Nominal USD from IMF World Economic Outlook. PPP-adjusted figures would rank differently.',
  },
  productivity_level: {
    caveat: '2023 vintage. OECD productivity releases lag national accounts by 18–24 months.',
    historyMonths: 24,
  },
  productivity_growth_10y: {
    caveat: '10-year CAGR over 2010–2020. A new vintage is due when OECD publishes 2015–2025 growth.',
    historyMonths: 24,
  },
  government_debt_gdp: {
    caveat: 'Central government gross debt as % of GDP (World Bank WDI). General government debt can differ; per-person figure is derived from nominal GDP and population.',
    historyMonths: 24,
  },
  household_debt_income_au: {
    caveat: 'RBA Table E2: household debt divided by annualised disposable income. OECD cross-country series uses a slightly different definition and lags this print.',
    historyMonths: 12,
    step: false,
  },
  years_to_buy_home: {
    caveat: 'Tier 3 composite: home prices in market USD (Numbeo), income in PPP USD (OECD). Directional only until rebuilt on an official house price index.',
    historyMonths: 24,
  },
  unemployment_rate: {
    historyMonths: 24,
  },
  inflation_rate: {
    historyMonths: 24,
  },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(METRIC_PAGES).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  if (!METRIC_PAGES[params.id]) return {};
  const meta = await loadMetricMeta(params.id);
  return { title: `${meta?.name ?? params.id} — Caveat` };
}

export default async function MetricPage({ params }: { params: { id: string } }) {
  const cfg = METRIC_PAGES[params.id];
  if (!cfg) notFound();

  const [meta, series] = await Promise.all([
    loadMetricMeta(params.id),
    loadSeriesHistory(params.id, cfg.historyMonths ?? 12, cfg.step ?? false),
  ]);
  if (!meta) notFound();

  const latest = series.length ? series[series.length - 1] : null;
  const scale = DIAL_SCALES[params.id];
  const tierLabel = meta.source_tier ? `Tier ${meta.source_tier}` : 'Tier —';

  return (
    <>
      <main className="article">
        <div className="card-kicker">Metric · Australia</div>
        <h1>{meta.name}</h1>
        <p className="measure">
          Latest reading{' '}
          {latest ? (
            <>
              <b>{formatValue(latest.value, meta.unit, scale)}</b>
              {' '}({formatPeriodLabel(latest.period)})
            </>
          ) : (
            'not yet loaded'
          )}
          . {meta.basis ?? 'See source for methodology.'}
        </p>
        <div className="byline">
          {tierLabel} · {meta.source_org ?? '—'} · {meta.period ?? '—'}
        </div>

        <div className="input-chart-grid" style={{ marginTop: '2rem' }}>
          <InputSeriesChart
            title={meta.name}
            subtitle={`${cfg.historyMonths ?? 12}-month history · ${meta.unit}`}
            unit={chartUnit(meta.unit)}
            points={series}
            step={cfg.step ?? false}
            latest={latest?.value ?? null}
          />
        </div>

        {cfg.caveat && (
          <div className="caveat-box" style={{ marginTop: '2rem' }}>
            <h3>Caveat</h3>
            <p style={{ marginBottom: 0 }}>{cfg.caveat}</p>
          </div>
        )}

        <h2>Source</h2>
        <table className="data">
          <tbody>
            <tr><th style={{ width: '30%' }}>Publisher</th><td>{meta.source_org ?? '—'}</td></tr>
            <tr><th>Dataset</th><td>{meta.source_dataset ?? '—'}</td></tr>
            <tr><th>Direction</th><td>{directionLabel(meta.direction)}</td></tr>
            <tr><th>Category</th><td>{meta.category ?? '—'}</td></tr>
            <tr>
              <th>Link</th>
              <td>
                {meta.source_url ? (
                  <a href={meta.source_url} target="_blank" rel="noreferrer"
                    style={{ borderBottom: '1px solid var(--rule)' }}>
                    {meta.source_org ?? 'Source'} ↗
                  </a>
                ) : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ marginTop: '2rem', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem' }}>
          <Link href="/indices" style={{ borderBottom: '1px solid var(--pen)' }}>
            ← Dashboard
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function directionLabel(dir: string | null) {
  if (dir === 'higher_is_more_pressure') return 'Higher = more pressure (red on dial)';
  if (dir === 'higher_is_less_pressure') return 'Higher = less pressure (green on dial)';
  return dir ?? '—';
}

function chartUnit(unit: string) {
  if (unit === 'percent' || unit === 'percent per year') return '%';
  if (unit === 'USD PPP') return 'USD';
  return unit;
}

function formatValue(value: number, unit: string, scale?: { decimals?: number; compact?: boolean }) {
  if (scale?.compact || unit === 'USD') {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }
  if (scale?.decimals != null) return `${value.toFixed(scale.decimals)} ${unit}`;
  if (unit === 'percent' || unit === 'percent per year') return `${value.toFixed(1)}%`;
  if (unit === 'years') return `${value.toFixed(1)} years`;
  return `${value} ${unit}`;
}
