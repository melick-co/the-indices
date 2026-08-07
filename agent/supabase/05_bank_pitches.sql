-- Bank the first crop (run of 30 Jul 2026). Story 003 approved; others banked
-- per their states with resurface conditions. Idempotent-ish: run once.
begin;

insert into pitches (headline,hook,mechanism,caveat,chart_hint,detector,trigger_rows,metric_ids,state,resurface_metrics,resurface_on,times_pitched) values
('America takes the most migrants in the world. Per person, it ranks 26th',
 'Biggest denominator flip in the dataset: USA falls 25 places when divided by population',
 'Absolute intake tracks economy size, not openness; per-capita is the openness measure',
 'Per-capita structurally favours micro-states; 8 countries use unstandardised national stats',
 'Animated rank-swap, 9:16',
 'denominator_flip','{"metric":"permanent_migration_inflow","period":"2024"}','{permanent_migration_inflow}',
 'approved','{permanent_migration_inflow}','New IMO vintage (annual, ~Nov)',1),

('Australia held its record migrant intake while New Zealand''s collapsed 56%',
 'Only step-change in the dataset: NZL -55.6% in 2024 vs typical 14.5% moves; AUS flat at its high',
 'NZ''s one-off resident-visa surge unwound; Australian settings held the new level',
 'NZ 2022-23 inflated by the one-off programme, so part of the fall is that pulse passing',
 'Dual line 2019-2024','step_change','{"metric":"permanent_migration_inflow","entities":["NZL","AUS"]}',
 '{permanent_migration_inflow}','pitched','{permanent_migration_inflow}','Next IMO vintage',1),

('The country with the lightest tax grip has the third-heaviest household debt on earth',
 'AUS 78th pctile net-kept vs 89th pctile household debt: the two-truths gap in pure form',
 'What the state does not take, the mortgage does: light income tax feeds borrowing capacity',
 'Household debt coverage is 20 countries, so third of the measured rich world',
 'Two-axis dot plot','two_truths','{"m1":"net_kept_pct","m2":"household_debt_to_income"}',
 '{net_kept_pct,household_debt_to_income}','pitched','{household_debt_to_income}','New OECD household debt vintage',1),

('Australians earn near the top of the OECD. Their wage growth ranks in the bottom half',
 '68th pctile wage level, 39th pctile 14-year real growth: high but going nowhere',
 'Level is the mining-boom legacy; stagnation is the productivity slowdown reaching pay',
 'Growth window starts at a boom peak, flattering the stagnation story slightly',
 'Level-vs-growth scatter','two_truths','{"m1":"avg_wage_ppp","m2":"real_wage_growth"}',
 '{avg_wage_ppp,real_wage_growth}','pitched','{real_wage_growth}','New OECD wages vintage (~Nov)',1),

('The one thing that''s actually cheap in Australia: petrol, 35th of 38',
 'Counter-narrative: AUS petrol sits 1.6 sd below the OECD mean',
 'Modest excise vs Europe, no fuel carbon price, proximity to Asian refining',
 'Tier-2 source, moving price, excise-cut window muddies comparison',
 'Single highlighted bar','oecd_gap','{"metric":"petrol_price"}','{petrol_price}',
 'pitched','{petrol_price,inflation_rate}','Next petrol price refresh',1),

('Where Australian wealth actually sits: eight adults'' share of the stock market buys one house',
 'Market cap 5/20 by GDP share, but the superannuation-vs-housing contrast is the real story',
 'Compulsory super builds a big equity market, yet household wealth still concentrates in property',
 'Market cap universe only 20 countries in WB 2024 vintage',
 'Ratio bar with house icon','rank_surprise','{"metric":"market_cap_gdp"}',
 '{market_cap_gdp,home_price_90m2}','dormant','{market_cap_gdp}','World Bank 2025 market-cap vintage',0),

('Rich country, unaffordable homes: the years-to-buy gap',
 'GDP/capita 78th pctile vs years-to-buy 81st pctile',
 'Income advantage smaller than the housing premium',
 'BLOCKED on mixed basis: needs single-basis house price source (OECD HPI) before headline use',
 'Scatter','two_truths','{"m1":"gdp_per_capita","m2":"years_to_buy_home"}',
 '{years_to_buy_home}','dormant',null,'Replace Numbeo with OECD house price index',0);

commit;

-- Story 004 (added 30 Jul 2026): viral-check on minimum wage / inflation spiral
begin;
insert into pitches (headline,hook,mechanism,caveat,chart_hint,detector,trigger_rows,metric_ids,state,resurface_metrics,resurface_on,times_pitched) values
('The minimum wage just jumped 6%. The last two big rises were followed by falling inflation',
 'Viral claim check with a calendar peg: rise effective 1 Jul 2026, spiral warnings circulating now',
 'Causation runs prices to wage decisions: FWC raises most after inflation has eaten real wages; its own measured pass-through of the 2024 rise was 0.36pp of wage growth',
 'Timing is not exoneration: 2022-23 disinflation owed much to rate rises; 2023 NMW 8.65% is a technical realignment, use award rates',
 'Animated timeline: decision bars onto CPI line','inbox_viral_check',
 '{"decisions":[2021,2022,2023,2024,2025,2026],"passthrough_pp":0.36}',
 '{fwc_award_increase,inflation_rate}','approved','{inflation_rate}',
 'Revisit at each ABS CPI quarterly print until mid-2027',1);
commit;

-- Stories 009-010 (added 7 Aug 2026): ACFS collapse leads
begin;
insert into pitches (headline,hook,mechanism,caveat,chart_hint,detector,trigger_rows,metric_ids,state,resurface_metrics,resurface_on,times_pitched) values
('Company collapses just hit record highs. The failure rate is still below 2012',
 'ACFS is the marquee casualty of a real enforcement wave: court liquidations tripled as the ATO resumed collection; news peg is live',
 'Two truths: absolute external administrations at records (13,413 FY25 to May, +34%) because Australia has 3.4m companies vs 2m in 2012; the RATE is 0.41% vs 0.53-0.56% at the GFC-era peak. The enforcement wave is real (court liquidations +219% in the 2024 ramp; ~19% of appointments now creditor-court-driven, ATO prominent); the "record failures" framing needs the denominator',
 'Press-release figures are rounded; proper series load must come from ASIC Series 1 downloadable data, not media summaries. Ratio peak years predate the small-company registration boom',
 'Dual view: record bars with a rate line undercutting them; ACFS as the annotated case study',
 'inbox_viral_check','{"asic_fy25_to_may":13413,"yoy_pct":34.2,"ratio_fy25":0.41,"ratio_gfc_era":[0.56,0.53],"court_liq_ramp_pct":218.8,"case":"ACFS Port Logistics, admin 2026-08-06, ~$60m ATO debt"}',
 '{}','pitched','{}','ASIC Series 1 quarterly releases; ACFS administration outcome',1),

('Will the ACFS collapse show up in supermarket prices? The maths of one container',
 'Largest private container operator in administration; confident inflation warnings circulating with no magnitudes attached',
 'Landside cartage is hundreds of dollars per container spread across thousands of retail units: even sharp spot-rate spikes add cents per item, and only if capacity exits rather than trading through as a going concern',
 'Clean tier-1 freight rate data is thin and lagged (ABS PPI road freight); honest answer likely "not measurably", which is a finding but a quiet one; fleet-size claims circulating (300 prime movers) unverified',
 'Unit-economics waterfall: container to carton to shelf item',
 'inbox_viral_check','{"case":"ACFS 850k TEU pa, admin 2026-08-06","customers":["Coles","Kmart","Bunnings"],"no_service_stoppage_confirmed":true}',
 '{inflation_rate}','watchlist','{inflation_rate}','Administration outcome (going concern vs breakup); next ABS PPI road freight print',0);
commit;
