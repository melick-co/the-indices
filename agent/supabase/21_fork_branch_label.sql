-- Record which branch a fork came from on the fork itself.
--
-- Forking used to write the new session's id back into the parent's messages
-- array so the parent could draw the branch chip as a link. That rewrote the
-- whole transcript of the session the editor wanted left alone, through a
-- field allowlist that silently drops anything it does not know about. The
-- fork already stores parent_session_id and fork_from_message_id; adding the
-- branch label lets the parent resolve its chips by reading its children, so
-- forking never has to touch the source session again.

alter table research_sessions
  add column if not exists fork_branch_label text;

create index if not exists research_sessions_parent_idx
  on research_sessions (parent_session_id)
  where parent_session_id is not null;
