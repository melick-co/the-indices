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
| `taste/rss-prompt.md` | News-lead evaluation prompt: link to banked idea, convert to new idea, or discard. |

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

Still deliberately unbuilt: statistical-source watchers (ABS/OECD SDMX pulls) -
the release-calendar registry is seeded and waiting; build these next to give the
detectors more history to fire on.
