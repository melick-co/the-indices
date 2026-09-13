-- Append a completed turn without overwriting the transcript.
--
-- The run route read the transcript when the run started and wrote the whole
-- array back when it finished, up to two minutes later. Two overlapping runs,
-- or a second tab, therefore raced: the later save replaced the array with its
-- own stale snapshot plus its own pair, and the other run's answer was gone.
-- Appending in the database instead means a save can only ever add to whatever
-- is stored at that moment.

create or replace function append_session_messages(
  sid uuid,
  new_messages jsonb,
  new_answer text default null,
  new_verdict text default null,
  new_tools jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  merged jsonb;
begin
  update research_sessions
     set messages = coalesce(messages, '[]'::jsonb) || coalesce(new_messages, '[]'::jsonb),
         answer = coalesce(new_answer, answer),
         verdict = coalesce(new_verdict, verdict),
         tools_used = coalesce((
           select jsonb_agg(distinct t)
           from jsonb_array_elements(
             coalesce(tools_used, '[]'::jsonb) || coalesce(new_tools, '[]'::jsonb)
           ) as t
         ), '[]'::jsonb),
         status = 'complete',
         updated_at = now()
   where session_id = sid
   returning messages into merged;

  return merged;
end;
$$;
