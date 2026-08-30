/** Mechanical trend detection over RSS items — no AI.
 *  Groups items by keyword overlap / title similarity and flags spikes. */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'has', 'have', 'had',
  'will', 'would', 'could', 'should', 'may', 'might', 'not', 'no', 'its', 'it', 'this',
  'that', 'these', 'those', 'after', 'before', 'over', 'under', 'into', 'about', 'says',
  'said', 'new', 'latest', 'update', 'report', 'reports', 'australia', 'australian',
]);

function tokens(text) {
  return (text ?? '').toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function intersect(a = [], b = []) {
  const bs = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => bs.has(x.toLowerCase()));
}

function unionFindGroups(n, shouldLink) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (shouldLink(i, j)) unite(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()];
}

function weekFingerprint(keywords) {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  const week = d.toISOString().slice(0, 10);
  const slug = [...keywords].sort().join('|').toLowerCase().replace(/[^a-z0-9|]+/g, '-').slice(0, 80);
  return `trend:${slug}:${week}`;
}

function buildCluster(items, indices, spikeScore, labelHint) {
  const picked = indices.map((i) => items[i]);
  const keywords = [...new Set(picked.flatMap((it) => it.matched_keywords ?? []))];
  const feedIds = [...new Set(picked.map((it) => it.feed_id).filter(Boolean))];
  const itemIds = picked.map((it) => it.item_id);
  const label = labelHint
    ?? (keywords.slice(0, 3).join(', ') || picked[0]?.title?.slice(0, 80) || 'Unnamed trend');
  return {
    label,
    keywords,
    item_ids: itemIds,
    feed_ids: feedIds,
    outlet_count: feedIds.length,
    item_count: picked.length,
    spike_score: spikeScore,
    fingerprint: weekFingerprint(keywords.length ? keywords : [label.slice(0, 40)]),
    items: picked,
  };
}

function clusterBySimilarity(items) {
  if (items.length < 2) return [];
  const groups = unionFindGroups(items.length, (i, j) => {
    const a = items[i];
    const b = items[j];
    const sharedKw = intersect(a.matched_keywords, b.matched_keywords);
    if (sharedKw.length >= 2) return true;
    const ta = new Set(tokens(a.title));
    const overlap = tokens(b.title).filter((w) => ta.has(w)).length;
    return overlap >= 3;
  });
  return groups
    .filter((g) => g.length >= 2)
    .map((g) => buildCluster(items, g, g.length >= 3 ? 1.5 : 1.2));
}

function keywordSpikeClusters(recent, baseline, topics) {
  const clusters = [];
  const countKw = (list, kw) => list.filter((it) => {
    const hay = `${it.title} ${it.summary ?? ''} ${(it.matched_keywords ?? []).join(' ')}`.toLowerCase();
    return hay.includes(kw.toLowerCase());
  }).length;

  for (const topic of topics) {
    for (const kw of topic.keywords ?? []) {
      const now = countKw(recent, kw);
      const prev = countKw(baseline, kw);
      if (now < 2) continue;
      const ratio = prev > 0 ? now / prev : now;
      if (now >= 3 || ratio >= 1.5) {
        const matched = recent.filter((it) => {
          const hay = `${it.title} ${it.summary ?? ''}`.toLowerCase();
          return hay.includes(kw.toLowerCase());
        });
        if (matched.length < 2) continue;
        const indices = matched.map((it) => recent.indexOf(it));
        clusters.push(buildCluster(
          recent,
          indices,
          Math.max(ratio, now / 2),
          `${topic.label}: ${kw}`,
        ));
      }
    }
  }
  return clusters;
}

/** Detect trend clusters worth sending to the hypothesis layer. */
export function detectTrends(recentItems, baselineItems, trackedTopics = []) {
  const recent = recentItems ?? [];
  const baseline = baselineItems ?? [];
  const bySim = clusterBySimilarity(recent);
  const bySpike = keywordSpikeClusters(recent, baseline, trackedTopics);

  const seen = new Set();
  const out = [];
  for (const c of [...bySim, ...bySpike]) {
    if (seen.has(c.fingerprint)) continue;
    // Qualify: multi-outlet story OR 3+ items OR strong keyword spike
    const qualifies = (c.outlet_count >= 2 && c.item_count >= 2)
      || c.item_count >= 3
      || c.spike_score >= 1.5;
    if (!qualifies) continue;
    seen.add(c.fingerprint);
    out.push(c);
  }
  return out.sort((a, b) => b.spike_score - a.spike_score || b.item_count - a.item_count);
}
