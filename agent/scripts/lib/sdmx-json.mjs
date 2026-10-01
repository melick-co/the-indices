/** SDMX-JSON -> [{ period, value }]. Shared by ABS and OECD watchers. */
export function parseSdmxJson(json) {
  const root = json?.data ?? json;
  const ds = root?.dataSets?.[0];
  const struct = root?.structures?.[0] ?? json?.structure;
  if (!ds || !struct) return [];
  const timeValues = (struct.dimensions?.observation ?? [])
    .find((d) => d.id === 'TIME_PERIOD' || d.role === 'time')?.values ?? [];

  const out = [];
  if (ds.series) {
    const firstKey = Object.keys(ds.series)[0];
    const obs = ds.series[firstKey]?.observations ?? {};
    for (const [idx, arr] of Object.entries(obs)) {
      const period = timeValues[Number(idx)]?.id ?? timeValues[Number(idx)]?.name;
      const value = Array.isArray(arr) ? arr[0] : arr;
      if (period != null && value != null) out.push({ period: String(period), value: Number(value) });
    }
  } else if (ds.observations) {
    for (const [key, arr] of Object.entries(ds.observations)) {
      const idx = Number(String(key).split(':').pop());
      const period = timeValues[idx]?.id;
      const value = Array.isArray(arr) ? arr[0] : arr;
      if (period != null && value != null) out.push({ period: String(period), value: Number(value) });
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

export function seriesKeys(json) {
  const root = json?.data ?? json;
  const ds = root?.dataSets?.[0];
  const struct = root?.structures?.[0] ?? json?.structure;
  if (!ds?.series || !struct) return [];
  const dims = struct.dimensions?.series ?? [];
  return Object.keys(ds.series).slice(0, 25).map((k) => {
    const parts = k.split(':').map(Number);
    const label = parts.map((p, i) => dims[i]?.values?.[p]?.name ?? '?').join(' | ');
    return { key: k, label };
  });
}

/**
 * SDMX-JSON with many series -> [{ dims: { REF_AREA, MEASURE, ... }, period, value, obsStatus }].
 * parseSdmxJson above reads only the first series; use this for cross-country pulls.
 * obsStatus is the SDMX OBS_STATUS code ('A' normal, 'E' estimated, 'P' provisional) or null.
 */
export function parseSdmxSeries(json) {
  const root = json?.data ?? json;
  const ds = root?.dataSets?.[0];
  const struct = root?.structures?.[0] ?? root?.structure ?? json?.structure;
  if (!ds?.series || !struct) return [];
  const seriesDims = struct.dimensions?.series ?? [];
  const timeValues = (struct.dimensions?.observation ?? [])
    .find((d) => d.id === 'TIME_PERIOD' || d.role === 'time')?.values ?? [];
  const obsAttrs = struct.attributes?.observation ?? [];
  const statusPos = obsAttrs.findIndex((a) => a.id === 'OBS_STATUS');

  const out = [];
  for (const [key, series] of Object.entries(ds.series)) {
    const dims = {};
    key.split(':').map(Number).forEach((p, i) => {
      if (seriesDims[i]) dims[seriesDims[i].id] = seriesDims[i].values?.[p]?.id;
    });
    for (const [idx, arr] of Object.entries(series.observations ?? {})) {
      const period = timeValues[Number(idx)]?.id;
      const value = Array.isArray(arr) ? arr[0] : arr;
      if (period == null || value == null) continue;
      const sIdx = statusPos >= 0 && Array.isArray(arr) ? arr[1 + statusPos] : null;
      const obsStatus = sIdx != null ? obsAttrs[statusPos].values?.[sIdx]?.id ?? null : null;
      out.push({ dims, period: String(period), value: Number(value), obsStatus });
    }
  }
  return out;
}
