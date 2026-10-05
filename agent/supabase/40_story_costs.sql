-- ============================================================
-- What a video costs. One row per billable call made for a
-- story: every Anthropic call that writes a stage, every
-- ElevenLabs picture, clip and read, every runner minute for
-- a cut. Regenerations are more rows, so a story's total is
-- the sum of everything ever spent on it, not the last take.
--
-- Prices live in story_cost_price and are copied onto each
-- row at write time, so a later price change does not rewrite
-- history. A row whose sku has no price yet is kept with
-- cost_usd null and shows up as "unpriced" rather than as 0.
-- ============================================================

create table if not exists story_cost_price (
  sku            text primary key,
  provider       text not null,
  unit           text not null,
  unit_price_usd numeric,
  note           text not null default '',
  source         text,
  priced_on      date not null,
  updated_at     timestamptz not null default now()
);

create table if not exists story_costs (
  cost_id        uuid primary key default uuid_generate_v4(),
  story_slug     text not null,
  render_id      uuid references story_reel_renders(render_id) on delete set null,
  -- script | storyboard | prompts | still | chart | clip | chart_video | voice | cut
  -- | hero_image | hero_video | hero_voice
  stage          text not null,
  provider       text not null,
  model          text,
  sku            text references story_cost_price(sku),
  quantity       numeric not null,
  unit           text not null,
  unit_price_usd numeric,
  cost_usd       numeric,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists story_costs_slug_idx on story_costs (story_slug, created_at desc);

alter table story_cost_price enable row level security;
alter table story_costs enable row level security;

drop policy if exists "admin all story_cost_price" on story_cost_price;
create policy "admin all story_cost_price" on story_cost_price
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin all story_costs" on story_costs;
create policy "admin all story_costs" on story_costs
  for all to authenticated using (is_admin()) with check (is_admin());

-- Per story, stage and provider: how many calls, how much of the unit, what it cost, and how many
-- rows could not be priced. The reel page reads this.
create or replace view v_story_cost_by_stage as
select
  story_slug,
  stage,
  provider,
  unit,
  count(*)::int                                   as calls,
  sum(quantity)                                   as quantity,
  coalesce(sum(cost_usd), 0)                      as cost_usd,
  count(*) filter (where cost_usd is null)::int   as unpriced,
  max(created_at)                                 as last_at
from story_costs
group by story_slug, stage, provider, unit;

-- List prices read on 5 October 2026. ElevenLabs bills in credits and the USD per credit depends on
-- the plan: Pro, Scale and Business all come to about $0.000165 a credit ($99 for 600k, $299 for
-- 1.8M, $990 for 6M); Creator is $22 for 121k, about $0.000182. Set the credit price to the plan in
-- use. Credits per image and per second of video are not on the public price list and are left
-- unpriced until read from the account's usage page.
insert into story_cost_price (sku, provider, unit, unit_price_usd, note, source, priced_on) values
  ('anthropic:claude-sonnet-4-6:input',       'anthropic',  'token',     0.000003,   'Claude Sonnet 4.6 input, $3 per million tokens',          'https://docs.anthropic.com/en/docs/about-claude/pricing', '2026-10-05'),
  ('anthropic:claude-sonnet-4-6:output',      'anthropic',  'token',     0.000015,   'Claude Sonnet 4.6 output, $15 per million tokens',        'https://docs.anthropic.com/en/docs/about-claude/pricing', '2026-10-05'),
  ('anthropic:claude-sonnet-4-6:cache_read',  'anthropic',  'token',     0.0000003,  'Claude Sonnet 4.6 cache read, $0.30 per million tokens',  'https://docs.anthropic.com/en/docs/about-claude/pricing', '2026-10-05'),
  ('anthropic:claude-sonnet-4-6:cache_write', 'anthropic',  'token',     0.00000375, 'Claude Sonnet 4.6 cache write, $3.75 per million tokens', 'https://docs.anthropic.com/en/docs/about-claude/pricing', '2026-10-05'),
  ('elevenlabs:credit',                       'elevenlabs', 'credit',    0.000165,   'One credit; text to speech (multilingual v2) is one credit a character. Plan rate: Pro, Scale and Business are about $0.000165, Creator $0.000182.', 'https://elevenlabs.io/pricing', '2026-10-05'),
  ('elevenlabs:image:gemini-3-pro-image',     'elevenlabs', 'image',     null,       'Credits per image are not on the public price list. Set from the account usage page: credits per image times the credit price.', 'https://elevenlabs.io/pricing', '2026-10-05'),
  ('elevenlabs:video:veo-3.1-fast',           'elevenlabs', 'second',    null,       'Credits per second of 720p video are not on the public price list. Set from the account usage page.', 'https://elevenlabs.io/pricing', '2026-10-05'),
  ('github:actions:linux-2core',              'github',     'minute',    0,          'GitHub-hosted Linux runner. Free for a public repository; $0.006 a minute if the repository goes private.', 'https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions', '2026-10-05')
on conflict (sku) do nothing;
