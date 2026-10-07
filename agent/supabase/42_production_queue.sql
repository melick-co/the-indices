-- Production queue and content scheduling.
--
-- Generators (auto-articles, generate-visuals, render-races) no longer publish on the spot: a finished piece goes into
-- content_queue as 'ready'. The scheduling assistant (web/scripts/schedule-content.ts) gives each ready piece a time
-- within the rules in schedule_rules (caps, slots, gaps, event days) and plans a post per channel in content_posts.
-- At the scheduled time, publish_due_content() (pg_cron, every five minutes) publishes it on the site. Social channels
-- stay 'not_connected' until each account is connected. Breaking stories bypass the queue.
--
-- Run in the Supabase SQL editor. Turn the queue off (generators publish on the spot again) with:
--   update schedule_rules set rules = jsonb_set(rules, '{enabled}', 'false') where id = 1;

create table if not exists content_queue (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('article', 'visual', 'race', 'breaking', 'hero_video', 'reel')),
  ref_slug      text not null,                    -- stories.slug (article, breaking) or visuals.slug (visual, race)
  title         text not null,
  summary       text,
  media         jsonb not null default '{}',      -- poster, videos, hero image: what a channel post can carry
  status        text not null default 'ready'
                  check (status in ('ready', 'scheduled', 'published', 'held', 'cancelled', 'failed')),
  priority      integer not null default 0,
  scheduled_at  timestamptz,
  published_at  timestamptz,
  scheduled_by  text check (scheduled_by in ('assistant', 'editor')),
  reason        text,                             -- the assistant's note on why this slot
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (kind, ref_slug)
);

create index if not exists content_queue_status on content_queue (status, scheduled_at);

create table if not exists content_posts (
  id            uuid primary key default gen_random_uuid(),
  queue_id      uuid not null references content_queue(id) on delete cascade,
  channel       text not null check (channel in ('site', 'youtube', 'tiktok', 'instagram', 'facebook', 'x', 'linkedin')),
  status        text not null default 'planned'
                  check (status in ('planned', 'scheduled', 'posted', 'failed', 'skipped', 'not_connected')),
  scheduled_at  timestamptz,
  posted_at     timestamptz,
  caption       text,
  external_url  text,
  error         text,
  updated_at    timestamptz not null default now(),
  unique (queue_id, channel)
);

create table if not exists schedule_rules (
  id          integer primary key default 1 check (id = 1),
  rules       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Times are Sydney time. Caps count published and scheduled pieces together.
insert into schedule_rules (id, rules) values (1, '{
  "enabled": true,
  "timezone": "Australia/Sydney",
  "horizonDays": 7,
  "minGapMinutes": 90,
  "eventBufferMinutes": 120,
  "caps":  { "article": { "perDay": 2 }, "visual": { "perDay": 1 }, "race": { "perWeek": 1 } },
  "slots": { "article": ["07:00", "12:30"], "visual": ["09:30", "15:00"], "race": ["18:00"] },
  "days":  { "race": ["tue", "wed", "thu"] },
  "channels": {
    "article": ["site", "x", "linkedin", "facebook"],
    "visual":  ["site", "instagram", "facebook", "x", "linkedin"],
    "race":    ["site", "youtube", "tiktok", "instagram", "facebook", "x", "linkedin"]
  }
}'::jsonb) on conflict (id) do nothing;

alter table content_queue enable row level security;
alter table content_posts enable row level security;
alter table schedule_rules enable row level security;

drop policy if exists "admin all content_queue" on content_queue;
create policy "admin all content_queue" on content_queue for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin all content_posts" on content_posts;
create policy "admin all content_posts" on content_posts for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin all schedule_rules" on schedule_rules;
create policy "admin all schedule_rules" on schedule_rules for all to authenticated using (is_admin()) with check (is_admin());

-- Publish what has fallen due, on the site. Articles go live the way goLiveFromPitch does it (story published today,
-- pitch marked published, a note in pitch_feedback); visuals and races flip to published.
create or replace function publish_due_content() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
  n integer := 0;
  pid uuid;
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  for q in
    select * from content_queue where status = 'scheduled' and scheduled_at <= now() order by scheduled_at for update skip locked
  loop
    begin
      if q.kind in ('article', 'breaking') then
        update stories set status = 'published', published = today, updated_at = now()
          where slug = q.ref_slug and status = 'draft' returning pitch_id into pid;
        if pid is not null then
          update pitches set state = 'published', state_changed = now(), last_evaluated = now() where id = pid;
          insert into pitch_feedback (pitch_id, action, comment) values (pid, 'comment', 'Published story: /stories/' || q.ref_slug);
        end if;
      elsif q.kind in ('visual', 'race') then
        update visuals set status = 'published', published_at = now() where slug = q.ref_slug and status = 'draft';
      end if;
      update content_queue set status = 'published', published_at = now(), updated_at = now() where id = q.id;
      update content_posts set status = 'posted', posted_at = now(), updated_at = now() where queue_id = q.id and channel = 'site';
      n := n + 1;
    exception when others then
      update content_queue set status = 'failed', error = sqlerrm, updated_at = now() where id = q.id;
    end;
  end loop;
  return n;
end;
$$;

revoke all on function publish_due_content() from public, anon, authenticated;

create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'publish-due-content') then
    perform cron.unschedule('publish-due-content');
  end if;
  perform cron.schedule('publish-due-content', '*/5 * * * *', 'select publish_due_content()');
end $$;

notify pgrst, 'reload schema';
