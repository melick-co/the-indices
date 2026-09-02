/**
 * ASX 30-day interbank cash rate futures → market-implied meeting probabilities.
 * Prices from ASX research API; methodology per ASX rate tracker.
 */

const ASX_IB_URL =
  'https://asx.api.markitdigital.com/asx-research/1.0/derivatives/interest-rate/IB/futures?days=1&height=179&width=179';
const STEP = 0.25;

export function futuresPriceToYield(price) {
  return 100 - price;
}

/** Pick contract covering the meeting month (expires last business day of month). */
export function selectContract(contracts, meetingDate) {
  const y = meetingDate.getUTCFullYear();
  const m = meetingDate.getUTCMonth();
  const candidates = contracts
    .filter((c) => {
      const exp = new Date(`${c.dateExpiry}T00:00:00Z`);
      return exp.getUTCFullYear() === y && exp.getUTCMonth() === m;
    })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  if (!candidates.length) return null;
  const c = candidates[0];
  const price = c.priceLastTrade ?? c.priceContract ?? c.pricePreviousSettlement;
  if (price == null) return null;
  return {
    symbol: c.symbol,
    price,
    yieldPct: futuresPriceToYield(price),
    volume: c.volume ?? 0,
    expiry: c.dateExpiry,
  };
}

/**
 * Solve implied hike / hold / cut probabilities (25bp steps) from monthly futures yield.
 * @returns {{ hike: number, hold: number, cut: number, impliedPostRate: number }}
 */
export function marketProbabilities(currentRate, futuresYield, nb, na) {
  const rt = currentRate;
  const X = futuresYield;

  if (na <= 0) {
    return { hike: 0, hold: 100, cut: 0, impliedPostRate: rt };
  }

  // Average rate over month: X = rt*nb + r_post*na
  const impliedPostRate = (X - rt * nb) / na;
  const delta = impliedPostRate - rt;

  let hike = 0;
  let cut = 0;
  if (delta > 0) {
    hike = Math.min(1, delta / STEP);
  } else if (delta < 0) {
    cut = Math.min(1, -delta / STEP);
  }
  const hold = Math.max(0, 1 - hike - cut);

  return {
    hike: roundPct(hike * 100),
    hold: roundPct(hold * 100),
    cut: roundPct(cut * 100),
    impliedPostRate: round(impliedPostRate, 3),
  };
}

export async function fetchAsxIbContracts() {
  const res = await fetch(ASX_IB_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`ASX IB API ${res.status}`);
  const body = await res.json();
  return body?.data?.items ?? [];
}

function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function roundPct(n) {
  return Math.round(n * 10) / 10;
}
