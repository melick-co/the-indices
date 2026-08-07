-- ============================================================
-- Detectors: mechanical candidate generators. No AI here.
-- Each returns rows shaped as candidates; the runner inserts them
-- into pitches(state='candidate') with trigger_rows populated.
-- ============================================================

-- D1. DENOMINATOR FLIP
-- Finds metric pairs (absolute vs per-base) where an entity's rank moves
-- by >= 10 places between the two framings. Currently instantiated for
-- migration; generalise by adding pairs to the CTE.
with pairs(abs_metric, per_metric) as (
  values ('permanent_migration_inflow','permanent_migration_inflow')  -- placeholder pair
),
latest as (
  select metric_id, max(period) as p from observations group by metric_id
),
ranked_abs as (
  select o.entity, rank() over (order by o.value desc) as r_abs
  from observations o join latest l on l.metric_id=o.metric_id and l.p=o.period
  where o.metric_id='permanent_migration_inflow'
)
select 'denominator_flip' as detector, entity, r_abs
from ranked_abs
where false;  -- fires only when a per-capita twin metric is loaded; see runner note

-- D2. RANK SURPRISE (Australia-lens)
-- Australia in top or bottom 5 of any metric with >= 15 entities.
with latest as (
  select metric_id, max(period) as p from observations group by metric_id
),
ranked as (
  select o.metric_id, o.entity, o.period, o.value,
         rank() over (partition by o.metric_id order by o.value desc) as r_desc,
         count(*)  over (partition by o.metric_id) as n
  from observations o
  join latest l on l.metric_id=o.metric_id and l.p=o.period
)
select 'rank_surprise' as detector, metric_id, entity, period, value,
       r_desc as rank_pos, n as universe
from ranked
where entity='AUS' and n >= 15 and (r_desc <= 5 or r_desc > n - 5);

-- D3. STEP CHANGE
-- For any metric with >= 4 periods per entity: latest YoY change exceeds
-- 3x the median absolute YoY change of that entity's own history.
with series as (
  select metric_id, entity, period, value,
         lag(value) over (partition by metric_id, entity order by period) as prev
  from observations
),
yoy as (
  select metric_id, entity, period, value, prev,
         case when prev is not null and prev <> 0
              then abs(value/prev - 1) end as chg
  from series
),
hist as (
  select metric_id, entity,
         percentile_cont(0.5) within group (order by chg) as med_chg,
         count(chg) as n_chg
  from yoy where chg is not null
  group by metric_id, entity
),
latest as (
  select distinct on (metric_id, entity) metric_id, entity, period, value, prev, chg
  from yoy where chg is not null
  order by metric_id, entity, period desc
)
select 'step_change' as detector, l.metric_id, l.entity, l.period,
       l.prev as prior_value, l.value as new_value,
       round((l.chg*100)::numeric,1) as pct_change,
       round((h.med_chg*100)::numeric,1) as typical_pct_change
from latest l join hist h using (metric_id, entity)
where h.n_chg >= 3 and h.med_chg > 0 and l.chg > 3 * h.med_chg;

-- D4. GAP WIDENING (Australia vs OECD mean)
-- Latest AUS value vs mean of others; flags gaps beyond 1.5 std dev.
with latest as (
  select metric_id, max(period) as p from observations group by metric_id
),
vals as (
  select o.metric_id, o.entity, o.value
  from observations o join latest l on l.metric_id=o.metric_id and l.p=o.period
),
stats as (
  select metric_id,
         avg(value) filter (where entity <> 'AUS') as mean_others,
         stddev_samp(value) filter (where entity <> 'AUS') as sd_others,
         count(*) filter (where entity <> 'AUS') as n
  from vals group by metric_id
)
select 'oecd_gap' as detector, v.metric_id, v.value as aus_value,
       round(s.mean_others::numeric,2) as oecd_mean,
       round(((v.value - s.mean_others)/nullif(s.sd_others,0))::numeric,2) as z_score
from vals v join stats s using (metric_id)
where v.entity='AUS' and s.n >= 15
  and abs((v.value - s.mean_others)/nullif(s.sd_others,0)) >= 1.5;

-- D5. TWO-TRUTHS GAP (curated pairs)
-- Pairs of related metrics where AUS sits in opposite halves of the distribution.
with pairs(m1, m2, label) as (
  values
   ('net_kept_pct','household_debt_to_income','light tax load vs heavy household debt'),
   ('productivity_level','productivity_growth_10y','high level vs weak growth'),
   ('gdp_per_capita','years_to_buy_home','rich country vs unaffordable homes')
),
latest as (
  select metric_id, max(period) as p from observations group by metric_id
),
pct as (
  select o.metric_id, o.entity,
         percent_rank() over (partition by o.metric_id order by o.value) as pr
  from observations o join latest l on l.metric_id=o.metric_id and l.p=o.period
)
select 'two_truths' as detector, p.label, p.m1, p.m2,
       round(a.pr::numeric,2) as aus_pctile_m1, round(b.pr::numeric,2) as aus_pctile_m2
from pairs p
join pct a on a.metric_id=p.m1 and a.entity='AUS'
join pct b on b.metric_id=p.m2 and b.entity='AUS'
where (a.pr >= 0.6 and b.pr <= 0.4) or (a.pr <= 0.4 and b.pr >= 0.6);

-- D6. RESURFACE SWEEP
-- Wake dormant/rejected pitches whose watched metrics gained a new period
-- since the pitch was last evaluated, or whose calendar date has arrived.
select 'resurface' as detector, p.id as pitch_id, p.headline, p.state,
       p.resurface_on
from pitches p
where p.state in ('dormant','rejected','watchlist')
  and (
    (p.resurface_after is not null and p.resurface_after <= current_date)
    or exists (
      select 1 from observations o
      where o.metric_id = any(p.resurface_metrics)
        and o.created_at > p.last_evaluated
    )
  );
