/**
 * Active scout-adopted series for one provider (series_registry, migration 30).
 * Returns [] if the table does not exist yet, so loaders keep working.
 * @param {{ from: Function }} db
 * @param {'abs' | 'oecd' | 'wb'} provider
 */
export async function loadRegistry(db, provider) {
  const { data, error } = await db.from('series_registry')
    .select('metric_id, provider, flow, key, measure, name, unit, basis, direction, category')
    .eq('provider', provider).eq('status', 'active');
  if (error) return [];
  return data ?? [];
}
