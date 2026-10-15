-- Publish gate: nothing goes live, and no live story's claims change, unless that exact content passed the strict
-- check (web/lib/generate-story.ts checkStory with the claim audit: figures against stored data, house style,
-- claim audit, sourced statements, footnote links).
--
-- The app stamps a story with check_hash = story_claim_hash(its content) when the strict check passes
-- (web/lib/publish-gate.ts). This trigger is the backstop: a row that becomes published, or a published row whose
-- claims change, must carry the stamp for exactly its current content. Updates that leave the claims alone
-- (highlights, art, hero image, placement, update note, slug) pass as before.
--
-- Stories already live have no stamp and stay live: the trigger fires only on a status flip or a claim change.
-- They can be stamped later by re-checking them (story-audit, then stamping the ones that pass unchanged).
--
-- Run in the Supabase SQL editor.

alter table stories add column if not exists check_hash text;
alter table stories add column if not exists checked_at timestamptz;
-- The reason an editor put a revision live without passing the check (CLI --force with REVISION_FORCE_REASON).
alter table stories add column if not exists check_override text;

-- The claims of a story: headline, kicker, deck, caveat, hero number, body and evidence. The body's highlight panel
-- is made from the checked figures after the check and is not a claim of its own. jsonb text is canonical (keys
-- sorted, whitespace normalised), so the same content always hashes the same way.
create or replace function story_claim_hash(
  p_title text, p_kicker text, p_hook text, p_caveat text, p_one_number jsonb, p_body jsonb, p_evidence jsonb
) returns text
language sql
immutable
as $$
  select md5(jsonb_build_array(
    coalesce(p_title, ''),
    coalesce(p_kicker, ''),
    coalesce(p_hook, ''),
    coalesce(p_caveat, ''),
    coalesce(p_one_number, 'null'::jsonb),
    case when jsonb_typeof(p_body) = 'object' then p_body - 'highlights' else coalesce(p_body, 'null'::jsonb) end,
    coalesce(p_evidence, 'null'::jsonb)
  )::text);
$$;

create or replace function story_claim_hash(s stories) returns text
language sql
immutable
as $$
  select story_claim_hash(s.title, s.kicker, s.hook, s.caveat, s.one_number, s.body, s.evidence);
$$;

-- The hash Postgres will compute for a content object ({title, kicker, hook, caveat, one_number, body, evidence}),
-- so the app stamps with exactly the same hashing.
create or replace function claim_hash_of(p jsonb) returns text
language sql
immutable
as $$
  select story_claim_hash(p->>'title', p->>'kicker', p->>'hook', p->>'caveat', p->'one_number', p->'body', p->'evidence');
$$;

revoke all on function claim_hash_of(jsonb) from public, anon;
grant execute on function claim_hash_of(jsonb) to service_role, authenticated;

create or replace function stories_publish_gate() returns trigger
language plpgsql
as $$
declare
  h text;
begin
  if new.status is distinct from 'published' then
    return new;
  end if;
  h := story_claim_hash(new);
  -- Already live and the claims are unchanged: art, highlights, placement, notes and slug edits pass.
  if tg_op = 'UPDATE' and old.status = 'published' and h = story_claim_hash(old) then
    return new;
  end if;
  if new.check_hash is distinct from h then
    raise exception 'publish gate: this story has not passed the strict check for its current content (/stories/%)', new.slug
      using errcode = 'CV001',
            hint = 'Run the strict check (desk Re-check, or refresh-stories.ts --publish / --recheck) and publish again.';
  end if;
  return new;
end;
$$;

drop trigger if exists stories_publish_gate on stories;
create trigger stories_publish_gate
  before insert or update on stories
  for each row execute function stories_publish_gate();

-- publish_due_content() from 42_production_queue.sql, with the gate: a queued article whose content has not passed
-- the strict check (or was edited since) is held with a note instead of published, and the run carries on.
create or replace function publish_due_content() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
  s stories%rowtype;
  n integer := 0;
  pid uuid;
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  for q in
    select * from content_queue where status = 'scheduled' and scheduled_at <= now() order by scheduled_at for update skip locked
  loop
    begin
      if q.kind in ('article', 'breaking') then
        select * into s from stories where slug = q.ref_slug;
        if found and s.status = 'draft' and s.check_hash is distinct from story_claim_hash(s) then
          update content_queue set status = 'held', error = 'held by the publish gate: not checked (or edited since its check)',
            updated_at = now() where id = q.id;
          continue;
        end if;
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

notify pgrst, 'reload schema';
