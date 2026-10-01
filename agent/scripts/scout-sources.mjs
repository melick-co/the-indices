#!/usr/bin/env node
/**
 * Source scout: find official series for what pitches keep asking for.
 *
 *   node scripts/scout-sources.mjs            # adopt verified series into series_registry
 *   node scripts/scout-sources.mjs --dry-run  # report decisions, write nothing
 *   ... --id=<metric_id>                      # scout these ids instead of the demand list
 *                                             # (repeatable, or SCOUT_IDS, space/comma separated)
 *
 * Demand comes from pitches' trigger_rows.unlinked_metrics (ids the model asked
 * for that the store does not hold). For the most-requested ids it:
 *   1. asks Claude what the id means and how to search for it;
 *   2. searches the live ABS, OECD and World Bank (WDI) catalogues;
 *   3. lets Claude pick a dataflow and build a key from that dataflow's real codes;
 *   4. fetches the key: it must return Australian data, one series;
 *   5. asks Claude, shown the actual series labels and values, whether it is the
 *      same measure as requested. Only then is it added, with the requested id
 *      as an alias. The loaders pick it up and fix-metric-links re-links pitches.
 * Only providers we already load from are used (agreed Oct 2026). Every
 * requested id is logged in source_scout_log and not retried for RETRY_DAYS.
 */
import { createDb } from './lib/obs-loader.mjs';
import { callClaudeJson } from './lib/claude.mjs';
import { loadKnownMetrics, canonicalMetricId } from './lib/metric-ids.mjs';
import { parseSdmxJson, parseSdmxSeries, seriesKeys } from './lib/sdmx-json.mjs';
import { absFetch } from './watch-abs.mjs';
import { oecdFetch, fetchSeries } from './watch-oecd.mjs';

const MAX_TARGETS = 4;
const RETRY_DAYS = 30;
const CANDIDATES_PER_PROVIDER = 20;
const CODES_PER_DIMENSION = 40;
const STRUCTURE = 'application/vnd.sdmx.structure+json';
const dryRun = process.argv.includes('--dry-run');
const requestedIds = [
  ...process.argv.filter((a) => a.startsWith('--id=')).map((a) => a.slice(5)),
  ...(process.env.SCOUT_IDS ?? '').split(/[\s,]+/),
].filter(Boolean);
const isMain = process.argv[1]?.endsWith('scout-sources.mjs');
const db = isMain ? createDb() : null;
const log = (m) => console.log(m);

// ---------- demand ----------

async function demand(known) {
  const { data, error } = await db.from('pitches').select('headline, trigger_rows').neq('state', 'rejected');
  if (error) throw new Error(error.message);
  const counts = new Map();
  for (const p of data ?? []) {
    for (const id of p.trigger_rows?.unlinked_metrics ?? []) {
      if (known.has(canonicalMetricId(id, known))) continue;
      const entry = counts.get(id) ?? { id, pitches: 0, headlines: [] };
      entry.pitches++;
      if (entry.headlines.length < 4) entry.headlines.push(String(p.headline ?? '').slice(0, 160));
      counts.set(id, entry);
    }
  }
  const { data: tried } = await db.from('source_scout_log').select('requested_id, last_tried');
  const cutoff = Date.now() - RETRY_DAYS * 864e5;
  const recent = new Set((tried ?? []).filter((t) => Date.parse(t.last_tried) > cutoff).map((t) => t.requested_id));
  return [...counts.values()]
    .filter((e) => !recent.has(e.id))
    // Ids that read like a single fact ("ABS_WPI_Q2-2026_annual-3.0pct") are not series.
    .filter((e) => /^[a-z][a-z0-9_]{2,60}$/.test(e.id))
    .sort((a, b) => b.pitches - a.pitches);
}

// ---------- catalogues ----------

let catalogues;
async function loadCatalogues() {
  if (catalogues) return catalogues;
  // A provider that is down this run is skipped rather than failing every target.
  const attempt = async (label, fn) => {
    try { return await fn(); } catch (e) { log(`  ${label} catalogue unavailable: ${e.message}`); return null; }
  };
  const abs = await attempt('ABS', () => absFetch('/dataflow/ABS?detail=allstubs&format=jsondata', STRUCTURE));
  const oecd = await attempt('OECD', () => oecdFetch('/dataflow/all?detail=allstubs'));
  const wb = await attempt('World Bank', async () => {
    const res = await fetch('https://api.worldbank.org/v2/source/2/indicator?format=json&per_page=3000');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json())[1] ?? [];
  }) ?? [];
  catalogues = {
    abs: (abs?.data?.dataflows ?? []).map((f) => ({ flow: f.id, name: f.name ?? f.names?.en ?? '' })),
    oecd: (oecd?.data?.dataflows ?? []).map((f) => ({ flow: `${f.agencyID},${f.id},${f.version}`, name: f.name ?? '' })),
    wb: wb.map((i) => ({ flow: i.id, name: i.name ?? '' })),
  };
  log(`Catalogues: ABS ${catalogues.abs.length}, OECD ${catalogues.oecd.length}, World Bank ${catalogues.wb.length}.`);
  return catalogues;
}

function search(list, terms) {
  const t = terms.map((x) => x.toLowerCase()).filter(Boolean);
  return list
    .map((e) => {
      const hay = `${e.flow} ${e.name}`.toLowerCase();
      // Whole terms count most; individual words of multi-word terms count a little.
      const phrase = t.filter((w) => hay.includes(w)).length * 3;
      const words = new Set(t.flatMap((w) => w.split(/\s+/)).filter((w) => w.length > 3));
      return { ...e, score: phrase + [...words].filter((w) => hay.includes(w)).length };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES_PER_PROVIDER);
}

// ---------- structures ----------

/** Dimensions in key order, each with the codes that have data (OECD) or all codes (ABS). */
async function dimensionsOf(provider, flow, terms) {
  const json = provider === 'abs'
    ? await absFetch(`/datastructure/ABS/${flow}?references=children&format=jsondata`, STRUCTURE)
    : await oecdFetch(`/dataflow/${flow.split(',').join('/')}?references=all`);
  const dims = json?.data?.dataStructures?.[0]?.dataStructureComponents?.dimensionList?.dimensions ?? [];
  const cls = json?.data?.codelists ?? [];
  const actual = (json?.data?.contentConstraints ?? []).find((c) => c.type === 'Actual');
  const allowed = {};
  for (const kv of actual?.cubeRegions?.[0]?.keyValues ?? []) allowed[kv.id] = new Set(kv.values);
  // Match code labels on single words ("rents" for "rent price index"), not whole phrases.
  const t = [...new Set(terms.flatMap((x) => x.toLowerCase().split(/\s+/)).filter((w) => w.length > 3))];
  return dims.map((d) => {
    const clId = (d.localRepresentation?.enumeration ?? '').split(':').pop().split('(')[0];
    let codes = (cls.find((c) => c.id === clId)?.codes ?? []).map((c) => ({ id: c.id, name: c.name ?? c.names?.en ?? '' }));
    if (allowed[d.id]) codes = codes.filter((c) => allowed[d.id].has(c.id));
    const total = codes.length;
    if (total > CODES_PER_DIMENSION) {
      const rel = codes.filter((c) => t.some((w) => c.name.toLowerCase().includes(w)));
      const keep = new Map([...codes.slice(0, CODES_PER_DIMENSION - Math.min(rel.length, 20)), ...rel.slice(0, 20)].map((c) => [c.id, c]));
      codes = [...keep.values()];
    }
    return { id: d.id, total, codes };
  });
}

/**
 * ABS structures list every code, not which combinations exist. Keep the most
 * specific dimension of a failed key (the one with the most codes, e.g. the CPI
 * item), wildcard the rest, and list the series that really exist.
 */
async function existingAbsKeys(flow, key, dims) {
  const parts = String(key ?? '').split('.');
  if (parts.length !== dims.length) return [];
  const anchor = dims.reduce((best, d, i) => (d.total > dims[best].total ? i : best), 0);
  // Codelists can repeat a label (CPI has two "Rents" codes, only one with data): try each.
  const label = dims[anchor].codes.find((c) => c.id === parts[anchor])?.name;
  const codes = [...new Set([parts[anchor], ...dims[anchor].codes.filter((c) => label && c.name === label).map((c) => c.id)])];
  const out = [];
  for (const code of codes.slice(0, 4)) {
    const probe = parts.map((p, i) => (i === anchor ? code : '')).join('.');
    try {
      const json = await absFetch(`/data/ABS,${flow}/${probe}?lastNObservations=1&format=jsondata`);
      const root = json?.data ?? json;
      const ds = root?.dataSets?.[0];
      const sdims = (root?.structures?.[0] ?? json?.structure)?.dimensions?.series ?? [];
      for (const k of Object.keys(ds?.series ?? {}).slice(0, 30)) {
        const idx = k.split(':').map(Number);
        out.push({
          key: idx.map((n, i) => sdims[i]?.values?.[n]?.id ?? '').join('.'),
          label: idx.map((n, i) => sdims[i]?.values?.[n]?.name ?? '?').join(' | '),
        });
      }
    } catch { /* this code has no series */ }
  }
  return out;
}

// ---------- verification ----------

async function verify(provider, choice, dims) {
  const name = (dimId, code) => dims.find((d) => d.id === dimId)?.codes.find((c) => c.id === code)?.name ?? code;
  if (provider === 'abs') {
    const json = await absFetch(`/data/ABS,${choice.flow}/${choice.key}?lastNObservations=12&format=jsondata`);
    const keys = seriesKeys(json);
    if (keys.length !== 1) return { ok: false, why: `key matches ${keys.length} series, need exactly one` };
    const obs = parseSdmxJson(json);
    if (obs.length < 4) return { ok: false, why: `only ${obs.length} observations` };
    return { ok: true, label: keys[0].label, sample: obs.slice(-6), countries: ['AUS'] };
  }
  if (provider === 'oecd') {
    const rows = (await fetchSeries(choice.flow, choice.key, '2015'))
      .filter((r) => !choice.measure || r.dims.MEASURE === choice.measure);
    const aus = rows.filter((r) => r.dims.REF_AREA === 'AUS').sort((a, b) => a.period.localeCompare(b.period));
    if (!aus.length) return { ok: false, why: 'no Australian rows' };
    if (new Set(rows.map((r) => `${r.dims.REF_AREA}|${r.period}`)).size !== rows.length) {
      return { ok: false, why: 'key returns several series per country' };
    }
    const label = Object.entries(aus[0].dims).map(([k, v]) => `${k}=${name(k, v)}`).join(' | ');
    return { ok: true, label, sample: aus.slice(-6).map((r) => ({ period: r.period, value: r.value })), countries: [...new Set(rows.map((r) => r.dims.REF_AREA))] };
  }
  const res = await fetch(`https://api.worldbank.org/v2/country/AUS/indicator/${choice.flow}?format=json&date=2005:${new Date().getFullYear()}`);
  const rows = res.ok ? ((await res.json())[1] ?? []).filter((r) => r.value != null) : [];
  if (rows.length < 3) return { ok: false, why: `only ${rows.length} Australian values` };
  return { ok: true, label: rows[0].indicator?.value ?? choice.flow, sample: rows.slice(0, 6).map((r) => ({ period: r.date, value: r.value })), countries: ['AUS', '…all WDI countries'] };
}

// ---------- one target ----------

async function scout(target, known) {
  const ask = (prompt, label) => callClaudeJson(prompt, { label, maxTokens: 4000 });
  const context = target.headlines.length
    ? `Requested metric id: ${target.id}\nAsked for by ${target.pitches} pitch(es), e.g.:\n${target.headlines.map((h) => `- ${h}`).join('\n')}`
    : `Requested metric id: ${target.id} (requested by an editor)`;

  const plan = await ask(`${context}

A data-journalism desk in Australia wants to store this series. Say precisely what it measures and
give search terms to find it in official statistical catalogues (ABS, OECD, World Bank WDI).

Respond ONLY with JSON:
{"meaning":"one sentence: measure, unit, geography, frequency","search_terms":["3 to 8 short terms, e.g. 'wage price index','sector'"],"is_series":true|false}
is_series is false if the id names a one-off fact, a forecast or a policy target rather than a recurring statistic.`, 'scout plan');
  if (!plan.is_series) return { outcome: 'no_match', note: `not a recurring series: ${plan.meaning}` };

  const cats = await loadCatalogues();
  const candidates = {
    abs: search(cats.abs, plan.search_terms),
    oecd: search(cats.oecd, plan.search_terms),
    wb: search(cats.wb, plan.search_terms),
  };
  const pick = await ask(`${context}
Meaning: ${plan.meaning}

Candidate dataflows from live catalogues (provider, flow id, name):
${Object.entries(candidates).flatMap(([p, list]) => list.map((c) => `${p} | ${c.flow} | ${c.name}`)).join('\n') || '(none found)'}

Pick the single dataflow most likely to contain exactly this measure for Australia. Prefer ABS for
Australian-only measures, OECD or World Bank for cross-country comparisons. If none fits, say so.
Respond ONLY with JSON: {"provider":"abs|oecd|wb|none","flow":"exact flow id from the list","why":"..."}`, 'scout pick');
  if (!pick.provider || pick.provider === 'none' || !candidates[pick.provider]?.some((c) => c.flow === pick.flow)) {
    return { outcome: 'no_match', note: pick.why ?? 'no dataflow fits' };
  }

  let dims = [];
  let choice = { flow: pick.flow, key: null, measure: null };
  if (pick.provider !== 'wb') {
    dims = await dimensionsOf(pick.provider, pick.flow, plan.search_terms);
    const keyAnswer = await ask(`${context}
Meaning: ${plan.meaning}
Provider: ${pick.provider}, dataflow ${pick.flow}

Dimensions in key order (code = label; only codes with data are listed for OECD; long lists are trimmed):
${dims.map((d, i) => `${i + 1}. ${d.id} (${d.total} codes): ${d.codes.map((c) => `${c.id}=${c.name}`).join('; ')}`).join('\n')}

Build an SDMX key: one code per dimension joined by dots, in the order above.
${pick.provider === 'abs'
    ? 'ABS: specify every dimension so the key returns exactly ONE series, for Australia as a whole, quarterly or monthly. Prefer original or seasonally adjusted headline series and, when the request is a growth rate, the "change from corresponding period of previous year" measure.'
    : 'OECD: leave REF_AREA empty (all countries) and fix every other dimension so each country has one series. Use annual frequency unless the request implies otherwise.'}
Also describe the series for the store.

Respond ONLY with JSON:
{"key":"...","measure":"OECD MEASURE code if the key leaves MEASURE open, else null",
 "name":"short series name","unit":"e.g. percent, index, persons, AUD million, percent of GDP",
 "basis":"what exactly is measured: coverage, adjustment, frequency",
 "direction":"higher_is_more_pressure|higher_is_less_pressure|neutral","category":"prices|labour|housing|fiscal|output|productivity|people|households|other",
 "metric_id":"snake_case id for the store; end in _au if Australia only",
 "derive_annual_change": false}
${pick.provider === 'abs' ? 'ABS only: if the request is a growth rate but the dataflow publishes this item only as an index, choose the index series and set derive_annual_change true; the store will compute change on the same period a year earlier.' : ''}`, 'scout key');
    choice = { ...choice, ...keyAnswer };
  } else {
    const meta = await ask(`${context}
Meaning: ${plan.meaning}
World Bank WDI indicator: ${pick.flow}
Respond ONLY with JSON: {"name":"...","unit":"...","basis":"...","direction":"higher_is_more_pressure|higher_is_less_pressure|neutral","category":"...","metric_id":"snake_case id"}`, 'scout meta');
    choice = { ...choice, ...meta };
  }

  const attemptVerify = async () => {
    try { return await verify(pick.provider, choice, dims); }
    catch (e) { return { ok: false, why: e.message }; }
  };
  let checked = await attemptVerify();
  // One retry for a key the provider rejects or that matches several series.
  if (!checked.ok && pick.provider !== 'wb') {
    const existing = pick.provider === 'abs' ? await existingAbsKeys(pick.flow, choice.key, dims) : [];
    const fixed = await ask(`The SDMX key ${choice.key} for ${pick.provider} dataflow ${pick.flow} failed: ${checked.why}

Dimensions in key order (code = label):
${dims.map((d, i) => `${i + 1}. ${d.id}: ${d.codes.map((c) => `${c.id}=${c.name}`).join('; ')}`).join('\n')}
${existing.length ? `\nSeries that actually exist for the item you chose (key | labels):\n${existing.map((k) => `${k.key} | ${k.label}`).join('\n')}\nYou must return one of these keys exactly as listed, or null.\n` : ''}
Requested: ${target.id} (${plan.meaning}). Return a corrected key using only listed codes, or null if this
dataflow cannot provide it. If only an index exists and the request is a growth rate (ABS), pick the index
and set derive_annual_change true.
Respond ONLY with JSON: {"key":"..." | null,"measure":"OECD MEASURE code or null","derive_annual_change":true|false}`, 'scout key retry');
    if (!fixed.key) return { outcome: 'rejected', note: `${pick.flow}: ${checked.why}; no valid key` };
    if (existing.length && !existing.some((k) => k.key === fixed.key)) {
      return { outcome: 'rejected', note: `${pick.flow}: retry key ${fixed.key} is not one of the ${existing.length} series that exist` };
    }
    choice = {
      ...choice, key: fixed.key, measure: fixed.measure ?? choice.measure,
      derive_annual_change: fixed.derive_annual_change ?? choice.derive_annual_change,
    };
    checked = await attemptVerify();
  }
  if (!checked.ok) return { outcome: 'rejected', note: `${pick.provider} ${pick.flow} ${choice.key ?? ''}: ${checked.why}` };

  const derive = pick.provider === 'abs' && choice.derive_annual_change === true;
  const confirm = await ask(`Requested: ${target.id}
Meaning: ${plan.meaning}
${derive ? 'The store will convert this index to annual % change (each period vs the same period a year earlier); judge the match after that conversion.\n' : ''}
Fetched series (${pick.provider} ${pick.flow} ${choice.key ?? ''}):
Labels: ${checked.label}
Recent Australian values: ${JSON.stringify(checked.sample)}
Countries: ${checked.countries.length > 10 ? `${checked.countries.length} countries` : checked.countries.join(', ')}

Is this the same measure as requested: same concept, same coverage (e.g. sector, whole economy),
same form (level vs growth rate), plausible values? If it differs in any of these, answer false.
Not differences: frequency (a quarterly or monthly series serves an annual request; it is stored at its
native frequency) and seasonal adjustment. For Australian CPI, "weighted average of eight capital
cities" is the national CPI.
Respond ONLY with JSON: {"match":true|false,"why":"..."}`, 'scout confirm');
  if (!confirm.match) return { outcome: 'rejected', note: `${pick.flow} ${choice.key ?? ''}: ${confirm.why}` };

  const clean = (id) => String(id).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60);
  const unique = (id) => { let out = id; while (known.has(out)) out = `${out}_2`; return out; };
  // With derivation the stored series is the index; the requested id links to the derived change.
  const derivedId = derive ? unique(clean(choice.metric_id ?? target.id)) : null;
  const metricId = derive ? unique(`${derivedId.replace(/_annual(_change)?/, '')}_index`) : unique(clean(choice.metric_id ?? target.id));
  const lag = String(choice.key ?? '').endsWith('.M') ? 12 : 4;

  const row = {
    metric_id: metricId, provider: pick.provider, flow: pick.flow, key: choice.key ?? null,
    measure: choice.measure ?? null, name: choice.name, unit: choice.unit, basis: choice.basis,
    direction: ['higher_is_more_pressure', 'higher_is_less_pressure'].includes(choice.direction) ? choice.direction : 'neutral',
    category: choice.category ?? 'other', aliases: [target.id], status: 'active',
    derive: derive ? {
      metric_id: derivedId, lag,
      name: `${String(choice.name ?? target.id).replace(/,?\s*index$/i, '')}, annual change`,
      basis: `Derived: ${choice.basis}, change on the same period a year earlier`,
    } : null,
    requested_by: { id: target.id, pitches: target.pitches, headlines: target.headlines },
    scout_note: `${plan.meaning} | picked: ${pick.why} | confirmed: ${confirm.why}`.slice(0, 2000),
    verified_at: new Date().toISOString(),
  };
  if (!dryRun) {
    const { error } = await db.from('series_registry').insert(row);
    if (error) return { outcome: 'failed', note: `registry insert: ${error.message}` };
  }
  known.add(metricId);
  if (derivedId) known.add(derivedId);
  return { outcome: 'adopted', metric_id: derivedId ?? metricId, note: `${pick.provider} ${pick.flow} ${choice.key ?? ''} | ${checked.label}`.slice(0, 500) };
}

async function main() {
  const known = await loadKnownMetrics(db);
  const targets = requestedIds.length
    ? requestedIds.map((id) => ({ id, pitches: 0, headlines: [] }))
    : (await demand(known)).slice(0, MAX_TARGETS);
  if (!targets.length) { log('No unlinked series in demand.'); return; }
  log(`Scouting ${targets.length} requested series${dryRun ? ' (dry run)' : ''}:`);
  for (const t of targets) log(`  ${String(t.pitches).padStart(3)}  ${t.id}`);

  const results = [];
  for (const t of targets) {
    log(`\n${t.id}`);
    let r;
    try { r = await scout(t, known); }
    catch (e) { r = { outcome: 'failed', note: e instanceof Error ? e.message : String(e) }; }
    log(`  ${r.outcome}${r.metric_id ? ` as ${r.metric_id}` : ''}: ${r.note}`);
    results.push({ id: t.id, ...r });
    if (!dryRun) {
      await db.from('source_scout_log').upsert({
        requested_id: t.id, last_tried: new Date().toISOString(),
        outcome: r.outcome, metric_id: r.metric_id ?? null, note: r.note?.slice(0, 1000) ?? null,
      });
    }
  }
  const adopted = results.filter((r) => r.outcome === 'adopted');
  log(`\nDone. ${adopted.length} adopted, ${results.length - adopted.length} not.`);
  if (!dryRun) {
    await db.from('agent_runs').insert({
      quiet_day: adopted.length === 0,
      notes: `source scout: ${results.map((r) => `${r.id} ${r.outcome}${r.metric_id ? `→${r.metric_id}` : ''}`).join('; ')}`.slice(0, 2000),
    });
  }
}

export { loadCatalogues, search, dimensionsOf, verify };

if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
