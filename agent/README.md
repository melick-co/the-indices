# insight-agent

A background agent that hunts newsworthy, checkable data insights and pitches up to
five headlines a day. Detector-first (mechanical triggers with row-level provenance),
taste-second (Claude ranks against EDITORIAL.md), editor-final (you approve, reject,
redirect, watchlist). Ideas are never deleted: weak-today carries a resurface
condition and wakes when new data or a calendar peg arrives.

## Pieces

| Path | What |
|---|---|
| `EDITORIAL.md` | The taste charter. The most important file here. |
| `supabase/04_agent_schema.sql` | Pitch lifecycle, source release-calendar registry, inbox, feedback, run log. Run against the existing store. |
| `detectors/detectors.sql` | Six mechanical detectors (rank surprise, step change, OECD gap, two-truths, denominator flip, resurface sweep). |
| `taste/prompt-template.md` | The Claude prompt scaffold. |
| `scripts/run-daily.mjs` | The runner skeleton: due sources -> detect -> rank -> pitch -> notify. |
| `supabase/06_rss_schema.sql` | RSS watch list + item lifecycle (fetched -> prefiltered -> evaluated -> linked/converted/discarded). |
| `scripts/run-rss.mjs` | WORKING RSS watcher: fetch, dedup, keyword prefilter, Claude evaluation, bank linking. Schedule every 6-24h. |
| `scripts/run-trends.mjs` | Feed trend watcher: cluster recent items, detect keyword spikes, Claude hypotheses → `pitches` with `detector: trend_hypothesis`. Runs after RSS. |
| `scripts/run-trending-topics.mjs` | Daily RSS + X topic snapshots for the public `/trending` page. |
| `scripts/run-trending-review.mjs` | After the snapshot: match topics to the pitch bank, attach validated findings, or open a new `trending_topic` candidate. |
| `taste/rss-prompt.md` | News-lead evaluation prompt: link to banked idea, convert to new idea, or discard. |
| `taste/trends-prompt.md` | Trend cluster prompt: generate investigation hypotheses from multi-outlet / spike clusters. |
| `taste/trending-review-prompt.md` | Daily trends-versus-pitches review: attach, new pitch, or ignore. |

## Design decisions (the ones you asked for)

- **Release-cycle polling.** `data_sources.next_expected` + cadence: the watcher only
  touches a source when a release is due. Seeded with the real OECD/ABS/IMF calendar.
- **Up to five, overflow deferred.** A rich day pitches the top 5 and parks the
  surplus on the watchlist with a 2-day resurface, so simultaneous releases never
  cost you gold. Thin days are honestly quiet.
- **No idea dies.** `rejected`, `dormant` and `watchlist` all carry
  `resurface_metrics` / `resurface_after`; detector D6 sweeps them every run and
  re-candidates anything whose condition has fired.
- **You are a source.** The `inbox` accepts ideas, links, articles, images and
  datasets; the taste layer assesses them alongside detector output each run.
- **Feedback loops in.** Approve/reject/rank/comment actions land in
  `pitch_feedback` and are fed into the next run's prompt, so the ranking converges
  on your taste over time. Redirections ("angle on renters") travel with the pitch.

## The RSS layer (news leads)

News items are LEADS, never evidence: they peg, time or trigger ideas; every
published claim still rests on tier 1/2 statistical sources. The flow:

1. `run-rss.mjs` fetches active feeds (conditional GET, dedup by guid hash).
2. Keyword prefilter (global watchlist or per-feed `watch_keywords`) discards
   off-beat items cheaply before any AI call.
3. Claude evaluates survivors against the charter and the CURRENT pitch bank:
   - **link_to_pitch**: item is a timing peg for a banked idea; if that idea is
     dormant/rejected/watchlisted, the peg triggers a resurface at next ranking.
   - **convert_to_idea**: item suggests a new candidate (max 3/run); stored as a
     rabbit hole with the tier 1/2 data needed to check it, not as fact.
   - **discard**: with a one-line reason, kept for audit.
4. **Adding feeds**: paste any RSS/Atom URL into the inbox (kind `data_source` or
   `link`) and the next run auto-registers it; or insert into `rss_feeds` directly.
   Feeds that 404 five times are skipped until reactivated.

## The trend layer (hypothesis generation)

After each RSS sweep, `run-trends.mjs` looks for patterns in the last 72 hours:

1. **Mechanical clustering** — groups items by shared keywords or title overlap;
   flags multi-outlet stories (2+ feeds) and keyword spikes vs the prior 72h window.
2. **Topic spikes** — tracked topics from Studio that suddenly match more items
   than usual also become clusters. Prefilter updates `tracked_topics.last_hit`.
3. **Claude hypothesis pass** — each qualifying cluster gets one decision:
   **investigate** (new `candidate` pitch with `detector: trend_hypothesis`),
   **link_to_pitch** (revives a banked idea), or **archive** (noise).
4. **Studio surface** — active clusters appear under "Feed trends"; hypotheses
   land in the pitch bank with Ask / Brainstorm shortcuts for investigation.

Clusters are stored in `trend_clusters` (migration `12_trend_clusters.sql`).
Hypotheses feed the same daily taste pipeline as detector and RSS candidates.

## Daily trending review (topics → Foundry)

After the midnight-Sydney trending snapshot (`0 14 * * *`),
`run-trending-review.mjs` reads the latest RSS and X topic lists and the
current pitch bank:

1. **Match** — is the topic actually about a banked finding (mechanism, series,
   denominator, or a live why-now peg), not just shared theme words?
2. **Validate and attach** — if yes, write a finding onto that pitch
   (`trigger_rows.findings` + `pitch_events.trending_finding`). Dormant pitches
   that are supported, updated, or contradicted wake as candidates.
3. **New pitch** — if the topic is a charter-shaped insight that is not already
   banked, insert a `candidate` with `detector: trending_topic` (max 3 per run).
   The daily taste layer ranks it like any other candidate.

News stays a lead. The review does not invent numbers. Re-runs on the same
`period_end` + topic are no-ops. Foundry has a **Review trending topics**
button; GitHub Actions task `trending-review` runs the review without
re-snapshotting.

Schedule: same job as `run-trending-topics.mjs` at `0 14 * * *`.

## Editorial email (suggest-and-approve)

A newsroom mailbox receives forwarded newsletters, Google Alerts, and tips.
Nothing changes the watcher until you approve in Studio.

1. **Inbound** — Resend Inbound (or any POST) → `POST /api/inbox/email` on the web app.
   Stores `inbox` row (`kind: email`, `status: new`). Set `INBOUND_EMAIL_SECRET` on
   Vercel and send `Authorization: Bearer <secret>`.
2. **Review** — `run-email-review.mjs` (30 min after RSS/trends) reads new emails,
   compares against `tracked_topics` and the pitch bank, writes `topic_suggestions`
   (`status: pending`).
3. **Approve** — Studio → **Email suggestions**. Approve to merge keywords into a
   topic, create a new topic, or bank a story idea as `candidate` pitch
   (`detector: email_lead`). Reject discards the suggestion.

Migration: `13_email_suggestions.sql`. Schedule: `:30` after RSS/trends in
`.github/workflows/agent.yml`.

**Resend setup:** add domain → enable Inbound → route to
`https://the-indices.vercel.app/api/inbox/email` with bearer auth.

**Test without email:**
```bash
curl -X POST https://the-indices.vercel.app/api/inbox/email \
  -H "Authorization: Bearer $INBOUND_EMAIL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"from":"you@example.com","subject":"Stamp duty story","text":"NSW budget pressure from falling stamp duty receipts..."}'
cd agent && node scripts/run-email-review.mjs
```

## Status: working agent

Working end to end: schema, JS detectors (`scripts/detectors.mjs`, verified to
reproduce the manual run exactly), the full daily runner (resurface sweep ->
detect -> dedup by fingerprint -> taste layer -> state updates -> webhook notify
-> run log), the RSS watcher, and the GitHub Actions schedule
(`.github/workflows/agent.yml` - move `.github/` to the repo root).

Notes on the runner's design choices:
- Detectors run in JS over fetched observations (783 rows = instant); the SQL in
  `detectors/` remains the SQL-editor reference version.
- Dedup: every detector candidate carries a fingerprint in trigger_rows; a pitch
  with the same fingerprint (any state) blocks re-insertion, so known ideas are
  never duplicated - they resurface via D6 instead.
- Taste kills are parked as dormant with a 30-day resurface, not deleted.
- The notification payload includes a Slack-compatible `text` field, so a Slack
  incoming webhook works with zero formatting glue; NOTIFY_WEBHOOK absent = skip.

## The ABS watcher

`scripts/watch-abs.mjs` pulls Australian series from the ABS Data API (SDMX) into
`observations`, giving the detectors real history to fire on.

**Verify the dataKeys before trusting a load.** `scripts/abs-config.mjs` ships
best-effort keys that have NOT been tested against the live API. Discovery
commands are built in:

```bash
node scripts/watch-abs.mjs discover cpi          # find dataflow ids
node scripts/watch-abs.mjs structure CPI         # dimensions + codes, in dataKey order
node scripts/watch-abs.mjs peek CPI 3.10001.10.50.Q   # preview, writes nothing
node scripts/watch-abs.mjs load                  # fetch all configured series and upsert
```

`peek` prints the series keys when a query returns more than one, so you can narrow
a wildcard key down to the exact series you want. Edit `abs-config.mjs` and re-peek
until the numbers look right, then `load`.

Two API facts worth knowing, both of which break naive clients:
- The base URL changed in Nov 2024 to `https://data.api.abs.gov.au/rest/`
- A `User-Agent` header is **required**; without one the API returns 403

Scheduled at midday Sydney (ABS releases at 11:30am Canberra), so a release lands in
the store before the next morning's pitch run. New periods trigger the resurface
sweep, so a fresh CPI print can wake a parked pitch by itself.

## Source orchestrator

`scripts/load-sources.mjs` runs every configured connector in sequence (ABS SDMX,
World Bank WDI, RBA CSV). GitHub Actions calls this on the 02:00 UTC schedule.

```bash
node scripts/load-sources.mjs          # all connectors
node scripts/load-sources.mjs wb       # World Bank only
node scripts/load-sources.mjs rba      # RBA only
```

Scripts auto-load `agent/.env` when present (copy from `.env.example`).

### World Bank WDI

`scripts/watch-wb.mjs` pulls annual history for population, GDP, market cap,
inflation, and unemployment across all entities in the store (2000–present).

### RBA CSV

`scripts/watch-rba.mjs` pulls cash rate, housing credit growth, household
debt-to-income, and 10-year zero-coupon yields from RBA CSV exports. Edit
`rba-config.mjs` to add series; column titles must match the CSV Title row exactly.

### OECD SDMX (discovery only)

`scripts/watch-oecd.mjs discover <term>` lists OECD dataflows. Full back-series
load is not wired yet — dimension keys still need verification.

Still unbuilt: OECD SDMX automated load, OECD House Price Index.
