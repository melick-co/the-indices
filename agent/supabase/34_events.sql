-- Events: decisions, releases and announcements, with the factors behind them,
-- and a watch list of upcoming ones (agent/EVENTS.md, web/lib/events.ts).
--
--  * Past events (RBA decisions, ABS releases) carry what was decided or published
--    and the contributing factors quoted from the source document, for timelines and
--    "what drove this" copy.
--  * Scheduled events (RBA meetings, ABS "Next release" dates) form the watch list.
--    When one falls due, the events watcher loads the new data, records the outcome,
--    refreshes articles that quote the affected series, and for significant events
--    writes and publishes a breaking story.
--
-- Public reads (these are public facts); writes are service-role only.

create table if not exists events (
  event_id      uuid primary key default uuid_generate_v4(),
  -- Stable key per occurrence, e.g. 'rba:decision:2026-09-29', 'abs:cpi:2026-10-28'.
  event_key     text not null unique,
  kind          text not null check (kind in ('decision', 'release', 'announcement')),
  institution   text not null,
  -- Release series this belongs to, e.g. 'rba:decision', 'abs:wpi', 'abs:cpi'.
  series        text not null,
  title         text not null,
  scheduled_at  timestamptz,
  occurred_on   date,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'due', 'occurred', 'processed', 'cancelled')),
  metric_ids    text[] not null default '{}',
  -- What was decided or published: e.g. {"cash_rate": 4.6, "change_bp": 25} or
  -- {"values": {"cpi_annual_au": {"period": "2026-Q3", "value": 3.9, "previous": 3.94}}}.
  outcome       jsonb,
  -- Contributing factors in the institution's words:
  -- [{"factor": "...", "direction": "up|down|risk", "quote": "verbatim", "source_url": "..."}]
  factors       jsonb not null default '[]',
  summary       text,
  source_url    text,
  significance  text check (significance in ('breaking', 'refresh', 'none')),
  -- What the watcher did: {"refreshed": [...], "applied": [...], "breaking": {...}}.
  actions       jsonb,
  attempts      int not null default 0,
  last_dispatch_at timestamptz,
  processed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists events_watch_idx on events (status, scheduled_at);
create index if not exists events_series_idx on events (series, occurred_on desc);
create index if not exists events_metrics_idx on events using gin (metric_ids);

comment on table events is 'Decisions, releases and announcements with contributing factors, plus the watch list of upcoming ones.';

alter table events enable row level security;

drop policy if exists "public reads events" on events;
create policy "public reads events" on events
  for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Exact-time trigger. GitHub's scheduled runs start hours late, so Supabase
-- checks every five minutes for events that have fallen due and dispatches the
-- events watcher straight away. It does nothing until a GitHub token is stored:
--
--   select vault.create_secret('<fine-grained token, Actions: write on melick-co/the-indices>',
--                              'github_dispatch_token');
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function dispatch_due_events() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
  if tok is null then
    return;
  end if;
  -- Due, and not dispatched in the last 20 minutes (the watcher retries a release that is late).
  if not exists (
    select 1 from events
    where status in ('scheduled', 'due') and scheduled_at <= now()
      and scheduled_at > now() - interval '3 days'
      and (last_dispatch_at is null or last_dispatch_at < now() - interval '20 minutes')
  ) then
    return;
  end if;
  update events set last_dispatch_at = now()
  where status in ('scheduled', 'due') and scheduled_at <= now() and scheduled_at > now() - interval '3 days';
  perform net.http_post(
    url := 'https://api.github.com/repos/melick-co/the-indices/actions/workflows/agent.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'caveat-events',
      'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('task', 'events-watch'))
  );
end;
$$;

revoke all on function dispatch_due_events() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-due-events') then
    perform cron.unschedule('dispatch-due-events');
  end if;
  perform cron.schedule('dispatch-due-events', '*/5 * * * *', 'select dispatch_due_events()');
end $$;
