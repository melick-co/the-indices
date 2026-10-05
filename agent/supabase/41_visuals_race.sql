-- Bar-chart-race videos (web/scripts/render-races.ts) publish as visuals of template 'race'; their videos (9:16,
-- 16:9, 1:1) are in the public visual-videos storage bucket, which the render script creates if it is missing.
alter table visuals drop constraint if exists visuals_template_check;
alter table visuals add constraint visuals_template_check check (template in ('ranked', 'treemap', 'change', 'race'));

notify pgrst, 'reload schema';
