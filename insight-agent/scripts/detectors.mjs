// Mechanical detectors, JS implementation. Mirrors detectors/detectors.sql
// (the SQL file remains the reference/SQL-editor version). Pure functions over
// fetched rows; no AI, no side effects. Each candidate carries a fingerprint
// for dedup and the trigger rows for provenance.

const AUS = 'AUS';

function groupSeries(observations) {
  // metric -> entity -> [{period, value}] sorted by period
  const m = new Map();
  for (const o of observations) {
    if (!m.has(o.metric_id)) m.set(o.metric_id, new Map());
    const em = m.get(o.metric_id);
    if (!em.has(o.entity)) em.set(o.entity, []);
    em.get(o.entity).push({ period: o.period, value: o.value, status: o.status });
  }
  for (const em of m.values())
    for (const arr of em.values()) arr.sort((a, b) => a.period.localeCompare(b.period));
  return m;
}

function latestCross(em) {
  const xs = new Map();
  for (const [e, arr] of em) xs.set(e, arr[arr.length - 1].value);
  return xs;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function runDetectors(observations, metricsById) {
  const series = groupSeries(observations);
  const out = [];

  // D2 rank surprise: AUS in top/bottom 5, universe >= 15
  for (const [mid, em] of series) {
    const xs = latestCross(em);
    if (!xs.has(AUS) || xs.size < 15) continue;
    const ranked = [...xs.entries()].sort((a, b) => b[1] - a[1]);
    const n = ranked.length, r = ranked.findIndex(([e]) => e === AUS) + 1;
    if (r <= 5 || r > n - 5) {
      out.push({
        detector: 'rank_surprise',
        fingerprint: `d2:${mid}:${AUS}`,
        headline: `Australia ranks ${r} of ${n} on ${metricsById.get(mid)?.name ?? mid}`,
        trigger_rows: { metric: mid, entity: AUS, rank: r, universe: n, value: xs.get(AUS) },
        metric_ids: [mid],
      });
    }
  }

  // D3 step change: latest |YoY| > 3x median of own prior |YoY|s, >= 3 changes
  for (const [mid, em] of series) {
    for (const [e, arr] of em) {
      if (arr.length < 4) continue;
      const chgs = [];
      for (let i = 1; i < arr.length; i++)
        if (arr[i - 1].value) chgs.push(Math.abs(arr[i].value / arr[i - 1].value - 1));
      if (chgs.length < 3) continue;
      const prior = chgs.slice(0, -1), last = chgs[chgs.length - 1];
      const med = median(prior);
      if (med > 0 && last > 3 * med) {
        const a = arr[arr.length - 2], b = arr[arr.length - 1];
        out.push({
          detector: 'step_change',
          fingerprint: `d3:${mid}:${e}:${b.period}`,
          headline: `${e} ${metricsById.get(mid)?.name ?? mid}: ${a.value} to ${b.value} in ${b.period}`,
          trigger_rows: { metric: mid, entity: e, from: a, to: b,
            pct_change: +((b.value / a.value - 1) * 100).toFixed(1),
            typical_pct: +(med * 100).toFixed(1) },
          metric_ids: [mid],
        });
      }
    }
  }

  // D4 OECD gap: AUS z-score vs others >= 1.5
  for (const [mid, em] of series) {
    const xs = latestCross(em);
    if (!xs.has(AUS) || xs.size < 15) continue;
    const others = [...xs.entries()].filter(([e]) => e !== AUS).map(([, v]) => v);
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    const sd = Math.sqrt(others.reduce((a, b) => a + (b - mean) ** 2, 0) / (others.length - 1));
    if (!sd) continue;
    const z = (xs.get(AUS) - mean) / sd;
    if (Math.abs(z) >= 1.5) {
      out.push({
        detector: 'oecd_gap',
        fingerprint: `d4:${mid}:${AUS}`,
        headline: `Australia sits ${z > 0 ? 'far above' : 'far below'} the OECD on ${metricsById.get(mid)?.name ?? mid}`,
        trigger_rows: { metric: mid, aus: xs.get(AUS), oecd_mean: +mean.toFixed(2), z: +z.toFixed(2) },
        metric_ids: [mid],
      });
    }
  }

  // D5 two-truths: curated pairs, AUS in opposite halves (or both high)
  const PAIRS = [
    ['net_kept_pct', 'household_debt_to_income', 'light tax load vs heavy household debt'],
    ['productivity_level', 'productivity_growth_10y', 'high level vs weak growth'],
    ['gdp_per_capita', 'years_to_buy_home', 'rich country vs unaffordable homes'],
    ['avg_wage_ppp', 'real_wage_growth', 'high wages vs stagnant wage growth'],
    ['market_cap_gdp', 'household_debt_to_income', 'equity market vs housing-debt extreme'],
  ];
  const pctile = (mid, e) => {
    const em = series.get(mid);
    if (!em) return null;
    const xs = latestCross(em);
    if (!xs.has(e) || xs.size < 2) return null;
    const vals = [...xs.values()];
    return vals.filter((v) => v < xs.get(e)).length / (vals.length - 1);
  };
  for (const [m1, m2, label] of PAIRS) {
    const a = pctile(m1, AUS), b = pctile(m2, AUS);
    if (a == null || b == null) continue;
    if ((a >= 0.6 && b <= 0.4) || (a <= 0.4 && b >= 0.6) || (a >= 0.6 && b >= 0.6)) {
      out.push({
        detector: 'two_truths',
        fingerprint: `d5:${m1}:${m2}`,
        headline: label,
        trigger_rows: { m1, m2, aus_pctile_m1: +a.toFixed(2), aus_pctile_m2: +b.toFixed(2) },
        metric_ids: [m1, m2],
      });
    }
  }

  return out;
}
