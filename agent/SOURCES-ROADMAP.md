# Source expansion register

What we are leaving on the table, ranked by what it unlocks. Every addition lands in
`data_sources` with cadence + next_expected, and its series in `observations`.
Rule of thumb: HISTORY multiplies detectors (step-change, divergence need series,
not snapshots). Prefer depth on existing themes before breadth into new ones.

## Tier A — build next (each unlocks detectors we already have)
| Source | What | Cadence | Unlocks |
|---|---|---|---|
| ABS via SDMX | CPI, AWE wages, labour force, retail trade, dwelling approvals, HECS/tax stats | monthly-quarterly | Home-market depth; step-change on AU series; budget/RBA calendar pegs |
| OECD SDMX (history pull) | Full back-series for our 17 metrics (we hold snapshots) | annual | D3/D6 across everything, not just migration |
| RBA statistical tables | Yields (F2), household finances (E2), credit (D1), exchange rates | monthly | Divergence detector: yields vs inflation, credit vs income |
| OECD House Price Index | Real house prices, price-to-income, price-to-rent, single basis | quarterly | UNBLOCKS the dormant affordability pitch; replaces Numbeo tier-3 |
| World Bank WDI API | Population, GDP, market cap, plus ~1,400 series | rolling | Clean per-capita denominators for every flip check |

## Tier B — high value, second wave
| Source | What | Unlocks |
|---|---|---|
| IMF WEO database | Forecasts + history, debt, fiscal | 'Forecast vs outcome' detector (new archetype: who got it wrong) |
| Eurostat | EU detail incl. bond-share of debt (replaces our estimates) | Upgrades estimated values to published |
| UN Comtrade / DFAT trade | AU trade by partner/commodity | Geopolitical precursor layer for timelines |
| ABS migration detail | Visa class, state destination | Depth under the migration franchise story |
| CoreLogic/PropTrack indices (licensed) or ABS residential prices | Monthly AU dwelling prices | ARLVI groundwork; monthly step-changes |

## Tier C — texture and precursors
- GDELT / news event data: automatic precursor candidates for timeline annotation (tier 3: colour, never carry)
- Google Trends: public-attention timing signal for the Timing rubric score
- Parliamentary/budget calendars, RBA decision dates: calendar-peg table for resurfacing
- Our World in Data grapher datasets: long history for context layers (check licence, mostly CC-BY)

## Explicitly deferred
- Social sentiment (tier 3, noisy), crypto/markets tick data (not our beat),
  paid terminals (cost before need).
