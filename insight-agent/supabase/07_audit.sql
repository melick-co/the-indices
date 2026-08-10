-- ============================================================
-- Pitch audit trail.
-- A database trigger, not application code, so EVERY change is captured:
-- agent writes, studio clicks, and hand-run SQL alike.
-- ============================================================

alter table pitches add column if not exists updated_at timestamptz not null default now();

create table if not exists pitch_events (
  event_id    uuid primary key default uuid_generate_v4(),
  pitch_id    uuid not null references pitches(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       text not null default 'agent',   -- agent | editor | system
  event       text not null,                   -- created | state_change | edited | resurfaced
  from_state  text,
  to_state    text,
  changes     jsonb,
  note        text
);
create index if not exists pitch_events_pitch_idx on pitch_events(pitch_id, at desc);

-- Set `select set_config('app.actor','editor',true);` in a transaction to attribute
-- a change to the editor. Defaults to 'agent' when unset.
create or replace function log_pitch_event() returns trigger
language plpgsql security definer as $$
declare
  who text := coalesce(nullif(current_setting('app.actor', true), ''), 'agent');
  diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into pitch_events(pitch_id, actor, event, to_state, changes)
    values (new.id, who, 'created', new.state,
      jsonb_build_object('detector', new.detector, 'headline', new.headline));
    return new;
  end if;

  if new.state is distinct from old.state then
    insert into pitch_events(pitch_id, actor, event, from_state, to_state, note)
    values (new.id, who,
      case when old.state in ('dormant','rejected','watchlist')
            and new.state = 'candidate' then 'resurfaced' else 'state_change' end,
      old.state, new.state, new.resurface_on);
  end if;

  if new.headline    is distinct from old.headline    then diff := diff || jsonb_build_object('headline',    jsonb_build_array(old.headline, new.headline)); end if;
  if new.hook        is distinct from old.hook        then diff := diff || jsonb_build_object('hook',        jsonb_build_array(old.hook, new.hook)); end if;
  if new.mechanism   is distinct from old.mechanism   then diff := diff || jsonb_build_object('mechanism',   jsonb_build_array(old.mechanism, new.mechanism)); end if;
  if new.caveat      is distinct from old.caveat      then diff := diff || jsonb_build_object('caveat',      jsonb_build_array(old.caveat, new.caveat)); end if;
  if new.rank_value  is distinct from old.rank_value  then diff := diff || jsonb_build_object('rank_value',  jsonb_build_array(old.rank_value, new.rank_value)); end if;
  if new.score       is distinct from old.score       then diff := diff || jsonb_build_object('score',       jsonb_build_array(old.score, new.score)); end if;
  if new.resurface_on is distinct from old.resurface_on then diff := diff || jsonb_build_object('resurface_on', jsonb_build_array(old.resurface_on, new.resurface_on)); end if;

  if diff <> '{}'::jsonb then
    insert into pitch_events(pitch_id, actor, event, changes)
    values (new.id, who, 'edited', diff);
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_pitch_audit on pitches;
create trigger trg_pitch_audit
  before insert or update on pitches
  for each row execute function log_pitch_event();

-- Backfill a 'created' event for pitches that predate this trigger
insert into pitch_events (pitch_id, at, actor, event, to_state, changes, note)
select p.id, p.first_seen, 'agent', 'created', p.state,
       jsonb_build_object('detector', p.detector, 'headline', p.headline),
       'backfilled when the audit trail was added'
from pitches p
where not exists (select 1 from pitch_events e where e.pitch_id = p.id);

alter table pitch_events enable row level security;
drop policy if exists "auth read pitch_events" on pitch_events;
create policy "auth read pitch_events" on pitch_events for select to authenticated using (true);

-- Lets the studio attribute a change to the editor:
--   await supabase.rpc('set_actor', { who: 'editor' })
create or replace function set_actor(who text) returns void
language plpgsql security definer as $$
begin
  perform set_config('app.actor', who, true);
end $$;
grant execute on function set_actor(text) to authenticated;
