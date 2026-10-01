-- The source scout can adopt series from the RBA statistical tables, BIS and
-- IMF as well as ABS, OECD and World Bank (all official, keyless APIs).
-- For provider 'rba': flow = CSV file, key = column Title, measure = cadence.

alter table series_registry drop constraint if exists series_registry_provider_check;
alter table series_registry add constraint series_registry_provider_check
  check (provider in ('abs', 'oecd', 'wb', 'rba', 'bis', 'imf'));

update data_sources set org = 'Various (ABS, OECD, World Bank, RBA, BIS, IMF)'
where source_id = 'scout_registry';
