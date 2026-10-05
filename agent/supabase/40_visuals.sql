-- Visuals: Visual Capitalist-style graphics for The Indices (/indices/visuals), generated from stored official data.
--
-- web/scripts/generate-visuals.ts picks a dataset and a template, computes the chart data from the stored series,
-- has the model write a headline and takeaways from those numbers only, checks every number in the text against the
-- data, and publishes (under a daily cap). The page draws the chart from `spec`, so the graphic always matches the
-- numbers it was checked against.

create table if not exists visuals (
  slug          text primary key,
  dataset_key   text not null,                 -- what was charted (e.g. rank:hsl_11_1, mix:pnl_income), for rotation
  template      text not null check (template in ('ranked', 'treemap', 'change')),
  title         text not null,
  subtitle      text,
  takeaways     jsonb not null default '[]',   -- 3 to 5 short sentences
  alt           text,                          -- screen-reader description of the graphic
  spec          jsonb not null,                -- rows, unit, period, highlight, median: everything the chart draws
  sources       jsonb not null default '[]',   -- [{ org, dataset, url }]
  checks        jsonb not null default '{}',   -- what the number check found
  status        text not null default 'published' check (status in ('draft', 'published', 'withdrawn')),
  videos        jsonb not null default '{}',   -- bar-race renders by format: { "9:16": url, "16:9": url, "1:1": url }
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists visuals_published on visuals (status, published_at desc);

alter table visuals enable row level security;

drop policy if exists "public reads published visuals" on visuals;
create policy "public reads published visuals" on visuals for select to anon, authenticated using (status = 'published');

notify pgrst, 'reload schema';
