-- Frame checks: stories that correct a widely shared frame.
alter table stories add column if not exists frame_check boolean not null default false;
create index if not exists stories_frame_check_idx on stories(frame_check) where status = 'published';
