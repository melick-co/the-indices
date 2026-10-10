-- Economists' commentary: feeds and approved senders' emails, reviewed against the data.
--
-- agent/scripts/run-economist-review.mjs fetches the feeds in agent/config/economists.json, and the inbound email
-- webhook files mail from approved senders here. The reviewer extracts each piece's claims (attributed), checks the
-- checkable ones against stored official series, and suggests a Caveat angle. Economists' views are tier-3 context:
-- never a headline figure, quoted only when verified. Nothing here publishes.
--
-- Run in the Supabase SQL editor.

create table if not exists economist_notes (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null,                  -- the feed or sender id in economists.json
  source_kind   text not null check (source_kind in ('feed', 'email')),
  org           text,
  author        text,                           -- the economist named in the piece, when one is
  title         text not null,
  url           text,
  external_id   text not null,                  -- feed guid/link or email message id, to skip repeats
  published_at  timestamptz,
  body          text,                           -- the text the reviewer read (trimmed)
  status        text not null default 'new'
                  check (status in ('new', 'reviewed', 'dismissed', 'pitched', 'failed')),
  relevant      boolean,                        -- about the Australian economy at all
  summary       text,
  claims        jsonb not null default '[]',    -- [{ text, kind, figure, metric_id, verdict, data_note, horizon }]
  angle         text,                           -- a possible Caveat story, if there is one
  error         text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists economist_notes_recent on economist_notes (status, published_at desc);

alter table economist_notes enable row level security;
drop policy if exists "admin all economist_notes" on economist_notes;
create policy "admin all economist_notes" on economist_notes for all to authenticated using (is_admin()) with check (is_admin());

notify pgrst, 'reload schema';
