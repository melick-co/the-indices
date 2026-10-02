-- More milestones on the watch list, and recurring watch rules.
--
--  * events gains `official` (false for private sources such as Cotality: on the watch list as a reminder,
--    never a source for a published figure), `origin` (calendar, rule, foundry, manual) and `notes`.
--  * watch_rules holds recurring items the calendars don't publish ("Cotality's weekly clearance rates,
--    every Tuesday"). The nightly events-calendar run expands each active rule into events for the next
--    60 days. Foundry research adds rules and one-off events through its add_watch_item tool.

alter table events add column if not exists official boolean not null default true;
alter table events add column if not exists origin text not null default 'calendar';
alter table events add column if not exists notes text;

create table if not exists watch_rules (
  rule_id      uuid primary key default uuid_generate_v4(),
  institution  text not null,
  title        text not null,
  series       text not null,
  cadence      text not null check (cadence in ('weekly', 'fortnightly', 'monthly', 'quarterly')),
  -- weekly/fortnightly: 0 = Sunday … 6 = Saturday. monthly/quarterly: day of month.
  weekday      int check (weekday between 0 and 6),
  day_of_month int check (day_of_month between 1 and 31),
  time_local   text not null default '10:00',
  start_date   date not null default current_date,
  end_date     date,
  official     boolean not null default true,
  source_url   text,
  metric_ids   text[] not null default '{}',
  notes        text,
  origin       text not null default 'manual',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (series)
);

comment on table watch_rules is 'Recurring watch-list items (expanded into events by events-calendar).';

alter table watch_rules enable row level security;

drop policy if exists "public reads watch rules" on watch_rules;
create policy "public reads watch rules" on watch_rules
  for select to anon, authenticated
  using (true);

-- The example from the editor: Cotality (formerly CoreLogic / RP Data) weekly listings and auction clearance
-- rates for the previous weekend, published on Tuesdays. Private source: a reminder, not a citable figure.
insert into watch_rules (institution, title, series, cadence, weekday, time_local, official, notes, origin)
values ('Cotality', 'Cotality weekly listings and auction clearance rates (previous weekend)', 'cotality:clearance-weekly',
        'weekly', 2, '10:00', false,
        'Private source (formerly CoreLogic/RP Data). Context only: not an official series under the house sourcing rules.',
        'manual')
on conflict (series) do nothing;
