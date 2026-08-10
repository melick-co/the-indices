/** Turns a pitch's detector + trigger rows into a plain-English line explaining
 *  how it was found. Shown in the summary so provenance is visible before
 *  anyone opens the detail. */
export function describeDerivation(detector: string, t: any): string {
  const r = t ?? {};
  switch (detector) {
    case 'rank_surprise':
      return r.rank && r.universe
        ? `Detector: Australia ranked ${r.rank} of ${r.universe} on ${pretty(r.metric)}`
        : `Detector: rank surprise on ${pretty(r.metric)}`;
    case 'step_change':
      return r.pct_change != null
        ? `Detector: ${r.entity ?? ''} ${pretty(r.metric)} moved ${fmtPct(r.pct_change)} in ${r.to?.period ?? ''}, against a typical ${fmtPct(r.typical_pct)}`.replace(/\s+/g, ' ')
        : `Detector: step change in ${pretty(r.metric)}`;
    case 'oecd_gap':
      return r.z != null
        ? `Detector: Australia ${Number(r.z) > 0 ? 'above' : 'below'} the OECD mean on ${pretty(r.metric)} by ${Math.abs(Number(r.z)).toFixed(1)} standard deviations (AUS ${r.aus}, mean ${r.oecd_mean})`
        : `Detector: gap from the OECD mean on ${pretty(r.metric)}`;
    case 'two_truths':
      return r.aus_pctile_m1 != null
        ? `Detector: opposite halves of two related measures — ${pretty(r.m1)} at the ${pct(r.aus_pctile_m1)} percentile, ${pretty(r.m2)} at the ${pct(r.aus_pctile_m2)}`
        : 'Detector: two related measures disagree';
    case 'denominator_flip':
      return `Detector: ranking reverses when the base changes${r.metric ? ` — ${pretty(r.metric)}` : ''}`;
    case 'resurface':
      return 'Resurfaced: a watched series gained new data, or a calendar date arrived';
    case 'rss_lead':
      return 'From a news feed, assessed against the charter';
    case 'inbox_idea':
      return 'Your idea, submitted via the inbox';
    case 'inbox_viral_check':
      return `Claim check: a widely shared claim tested against the data${r.case ? ` — ${r.case}` : ''}`;
    default:
      return `Detector: ${detector}`;
  }
}

const pretty = (id?: string) =>
  id ? String(id).replace(/_/g, ' ').replace(/\b(au|oecd|gdp|cpi|hsi)\b/gi, (m) => m.toUpperCase()) : 'a metric';
const fmtPct = (n: any) => (n == null ? '' : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const pct = (n: any) => `${Math.round(Number(n) * 100)}th`;
