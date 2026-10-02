-- Official documents stored as text (RBA statements, minutes and speeches; ABS
-- release pages), so the claim audit can check what an article says a source
-- said against the source itself, not just link to it. Loaded nightly by
-- agent/scripts/load-documents.mjs and on demand when an article cites a page.
-- Public reads: these are public documents. Writes are service-role only.

create table if not exists source_documents (
  doc_id       uuid primary key default uuid_generate_v4(),
  url          text not null unique,
  publisher    text not null,
  kind         text not null
                 check (kind in ('statement', 'minutes', 'speech', 'media_release', 'release', 'page')),
  title        text,
  published    date,
  body         text not null,
  content_hash text not null,
  fetched_at   timestamptz not null default now()
);

create index if not exists source_documents_recent_idx
  on source_documents (publisher, kind, published desc);

comment on table source_documents is 'Text of official source documents, for verifying sourced statements in articles.';

alter table source_documents enable row level security;

drop policy if exists "public reads source documents" on source_documents;
create policy "public reads source documents" on source_documents
  for select to anon, authenticated
  using (true);
