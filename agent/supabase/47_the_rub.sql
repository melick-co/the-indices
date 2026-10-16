-- The Rub (Column 8): the column moves from the static array in web/content/the-rub/seed.ts to this table.
--
-- web/scripts/rub-draft.ts drafts one column a week (workflow task rub-draft): a peg from what is trending, a word or
-- number people use loosely, and a stored series that settles it. The draft runs the strict check (the figure check
-- and the claim audit stories use, plus the column's own rules) and is saved as 'pending' (passed) or 'draft'
-- (failed, with the issues). Nothing publishes on its own: an editor approves it at /foundry/rub.
--
-- The site reads published rows (web/lib/the-rub.ts) and falls back to the static seed until this has run.
-- The six pieces already in the seed are inserted as published 'legacy' rows: they predate the strict check.
--
-- Run in the Supabase SQL editor.

create table if not exists rubs (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  keywords    text[] not null default '{}',
  peg         text,                                  -- the trend or story the column hangs on
  paragraphs  jsonb not null default '[]'            -- string array; the last is the closing line
                check (jsonb_typeof(paragraphs) = 'array'),
  metric_ids  text[] not null default '{}',          -- the stored series that settle its claims (re-checked on edit)
  status      text not null default 'draft'
                check (status in ('draft', 'pending', 'published', 'rejected')),
  "check"     jsonb not null default '{}',           -- { ok, audited, issues, warnings, claims, checked_at, legacy? }
  source      jsonb not null default '{}',           -- what prompted it: trend topics, story, links, the loose word
  published   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);

create index if not exists rubs_status_published on rubs (status, published desc);

-- Publish gate. A row can be published only when its strict check passed with the claim audit run
-- ("check".ok and "check".audited), or when it is one of the seeded legacy pieces. Changing the title or paragraphs
-- without writing a new check marks the old check stale (not ok), so edited copy cannot ride an earlier pass.
create or replace function rubs_gate() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE'
     and (new.title, new.paragraphs) is distinct from (old.title, old.paragraphs)
     and new."check" is not distinct from old."check" then
    new."check" := coalesce(old."check", '{}'::jsonb)
      || jsonb_build_object('ok', false, 'audited', false, 'legacy', false, 'stale', true);
  end if;
  if new.status = 'published' then
    if not (
      (coalesce(new."check"->>'ok', 'false') = 'true' and coalesce(new."check"->>'audited', 'false') = 'true')
      or (new."check"->>'legacy' = 'true' and new.slug in (
        'cash-rate-theatre', 'migration-headcount', 'house-price-cheer', 'inflation-is-not-the-coles-receipt',
        'gdp-grew-so-what', 'productivity-sermon'))
    ) then
      raise exception 'rubs: "%" cannot be published: it has not passed the strict check for its current copy', new.slug
        using errcode = 'CV002', hint = 'Re-check it at /foundry/rub (save the edit form) and approve it there.';
    end if;
    if new.published is null then
      new.published := (now() at time zone 'Australia/Sydney')::date;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rubs_gate on rubs;
create trigger rubs_gate
  before insert or update on rubs
  for each row execute function rubs_gate();

alter table rubs enable row level security;

drop policy if exists "public reads published rubs" on rubs;
create policy "public reads published rubs" on rubs
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "admin all rubs" on rubs;
create policy "admin all rubs" on rubs
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- The pieces from web/content/the-rub/seed.ts, word for word, marked legacy (they predate the strict check).
insert into rubs (slug, title, keywords, peg, paragraphs, status, "check", published)
values
  ($r$cash-rate-theatre$r$, $r$The cash rate held. That is not your mortgage.$r$,
   array[$r$rba$r$, $r$cash rate$r$, $r$interest rate$r$, $r$reserve bank$r$, $r$rate hold$r$, $r$rate cut$r$, $r$rate rise$r$]::text[],
   null,
   jsonb_build_array(
     $r$I do wish people would stop treating the cash rate as if it were a weather report for the household. It is an overnight rate between banks. It is not the thing on your statement, and it is certainly not the price of a house in a postcode you cannot afford.$r$,
     $r$What the Reserve Bank actually sets is the cost of money for a few hours. What you pay is a contract written years ago, plus a bank margin, plus whatever you borrowed against a dwelling that only works if wages, prices and luck keep agreeing with each other. Those are different instruments. Mixing them up is how a Tuesday press conference becomes a national mood.$r$,
     $r$Nobody went broke because the cash rate sat still for another meeting. They went broke because they treated a policy rate as a personal guarantee. If you want the household story, look at the debt, not the theatre.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-09-22'::date),
  ($r$migration-headcount$r$, $r$We counted the arrivals. We forgot to divide.$r$,
   array[$r$migration$r$, $r$immigration$r$, $r$nom$r$, $r$population$r$, $r$visa$r$, $r$asylum$r$]::text[],
   null,
   jsonb_build_array(
     $r$There is a habit, and I find it rather sloppy, of waving a very large number and calling it a conclusion. America takes the most migrants. Australia is "full". Someone has drawn an arrow. The comments then do what comments do.$r$,
     $r$Absolute intake measures the size of an economy. Openness is a per-person question. Those are not the same chart, and they will not rank countries in the same order. The United States leads on the first measure and sits well down the list on the second. Australia looks different again once you stop treating a continent as a queue.$r$,
     $r$If an argument cannot survive a division sign, it was not an argument. It was a poster with a number on it.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-09-15'::date),
  ($r$house-price-cheer$r$, $r$Your house went up. That is not the same as getting richer.$r$,
   array[$r$housing$r$, $r$house price$r$, $r$home$r$, $r$mortgage$r$, $r$property$r$, $r$rent$r$]::text[],
   null,
   jsonb_build_array(
     $r$People say "house prices are up again" with the quiet satisfaction usually reserved for a decent harvest. I should like to fuss about the vocabulary. A higher sticker on a house you still need to sleep in is a mood, not a dividend. If you do not own the thing, it is a locked door.$r$,
     $r$A dwelling is not a share. You cannot spend a capital gain while you continue to occupy the asset. The stock is dear because we built too few of them and lent too much against the ones we have. That is not a productivity miracle. That is a queue with interest attached.$r$,
     $r$The popular take calls this wealth. The receipt calls it a transfer from the young and the renting to whoever arrived first.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-09-08'::date),
  ($r$inflation-is-not-the-coles-receipt$r$, $r$Inflation fell. Your shop still hurts. Both can be true.$r$,
   array[$r$inflation$r$, $r$cpi$r$, $r$cost of living$r$, $r$prices$r$, $r$coles$r$, $r$woolworths$r$]::text[],
   null,
   jsonb_build_array(
     $r$The Consumer Price Index is a very polite average. It does not do your shopping, and it does not pay your rent. It weights a basket so that the country can have one number to wave at the Reserve Bank. That is a useful job. It is not a household ledger.$r$,
     $r$When that number falls, television treats it as a refund. It is not. It means prices are rising more slowly than they were, from a higher floor, in a basket that is not your basket. Rent and insurance may still be having an evening of their own.$r$,
     $r$The viral chart says inflation is beaten. The household asks why Tuesday costs more than Tuesday last year. The answer, I am afraid, is that a rate of change and a level are different animals, and we keep introducing them as twins.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-09-01'::date),
  ($r$gdp-grew-so-what$r$, $r$The economy grew. Did anyone you know?$r$,
   array[$r$gdp$r$, $r$economy$r$, $r$growth$r$, $r$recession$r$, $r$national accounts$r$]::text[],
   null,
   jsonb_build_array(
     $r$Gross domestic product is the country's favourite scoreboard, and like most scoreboards it is only as honest as the thing it is measuring. If the number is up, the treasurer smiles. If it is down, someone has to go on radio and say "technical." I have known speedometers that behaved like this when the wheels were the wrong size.$r$,
     $r$GDP counts activity. It does not count who received the activity. A mining boom, a population surge and a rebuild after a flood all look like growth. One of them is a dividend. One of them is more people sharing the same pie. One of them is putting the house back. They are not interchangeable, however tidy the press release.$r$,
     $r$Per person, the story often changes sign. That is the version that belongs on the front page. We print the other one because it is larger and, inconveniently, happier.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-08-25'::date),
  ($r$productivity-sermon$r$, $r$They said productivity. They meant you should work harder.$r$,
   array[$r$productivity$r$, $r$output$r$, $r$labour$r$, $r$wages$r$, $r$efficiency$r$]::text[],
   null,
   jsonb_build_array(
     $r$Productivity is the most abused word in Canberra after "sustainable," which is saying something. Properly used, it means more output from the same hours and kit. In the wild it means a lecture about lunch breaks, delivered by people who have never had to time one.$r$,
     $r$Australia's level of output per hour is not the scandal. The scandal is how slowly that level has been moving, while houses, rents and the interest bill have been doing laps. If pay does not follow output, someone else collected the difference. That is not a sermon. That is arithmetic.$r$,
     $r$Working longer is not productivity. That is simply a longer day. The chart you want is output per hour, not a homily about grit.$r$,
     $r$Which, if we are being precise, is the rub.$r$
   ),
   'published', '{"ok": false, "audited": false, "legacy": true, "issues": [], "warnings": ["Seeded from the static column; it predates the strict check."]}'::jsonb, '2026-08-18'::date)
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
