-- ============================================================
-- Stage the video pipeline on story_reels.
-- Script is written first, then storyboard visuals, then the
-- prompt pack handed to the external generator.
--
-- Existing one-shot reels already carry visuals, so they land
-- on storyboard rather than looking like a script-only draft.
-- ============================================================

alter table story_reels
  add column if not exists video_stage text not null default 'storyboard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'story_reels_video_stage_check'
  ) then
    alter table story_reels
      add constraint story_reels_video_stage_check
      check (video_stage in ('script', 'storyboard', 'prompts'));
  end if;
end $$;
