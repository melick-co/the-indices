-- LinkedIn on the production queue (web/lib/social/linkedin-plan.ts, web/lib/social-post.ts).
--
-- LinkedIn runs on its own cadence: one post per weekday at about 8am Sydney (the day's lead story, else a graphic or
-- race), drafted and checked (web/lib/social/linkedin-copy.ts). In review mode (the default) each post waits on the
-- Queue page for an editor's approval; in auto mode a post that passes the checks goes out at its slot. The mode and
-- the cadence live in schedule_rules.rules (channelModes, cadence); the code supplies the defaults, so nothing needs
-- to be written there.
--
-- New post statuses: 'review' (passed the checks, waiting for approval), 'approved', 'held' (fails the checks; the
-- findings are in lint). Run in the Supabase SQL editor after 42_production_queue.sql.

alter table content_posts drop constraint if exists content_posts_status_check;
alter table content_posts add constraint content_posts_status_check
  check (status in ('planned', 'scheduled', 'posted', 'failed', 'skipped', 'not_connected', 'review', 'approved', 'held'));

alter table content_posts add column if not exists lint        jsonb not null default '[]';  -- [{ code, message }]
alter table content_posts add column if not exists approved_at timestamptz;
alter table content_posts add column if not exists approved_by uuid;                          -- profiles.id of the editor

-- LinkedIn used to be planned per piece and never posted (no account). Those rows are cleared so the new cadence
-- starts clean; anything already posted is kept.
delete from content_posts where channel = 'linkedin' and status in ('planned', 'scheduled', 'not_connected');

notify pgrst, 'reload schema';
