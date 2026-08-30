-- Fix banking pitches from Studio Ask.
-- BEFORE INSERT trigger tried to log pitch_events while the pitch row
-- did not exist yet, violating pitch_events_pitch_id_fkey.

create or replace function log_pitch_event_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function log_pitch_event_after() returns trigger
language plpgsql security definer set search_path = public as $$
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

  return new;
end $$;

drop trigger if exists trg_pitch_audit on pitches;
create trigger trg_pitch_audit_before
  before update on pitches
  for each row execute function log_pitch_event_before();

create trigger trg_pitch_audit_after
  after insert or update on pitches
  for each row execute function log_pitch_event_after();
