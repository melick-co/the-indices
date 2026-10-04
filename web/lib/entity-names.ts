import { createClient } from '@/lib/supabase-server';
import { CPI_ENTITY_NAMES } from '../../agent/scripts/lib/cpi-components.mjs';

/** Display names for entity codes: countries from the entities table, plus the CPI component names. */
export async function entityNames(): Promise<Map<string, string>> {
  const { data: ents } = await createClient().from('entities').select('code, name');
  return new Map<string, string>([...Object.entries(CPI_ENTITY_NAMES), ...(ents ?? []).map((e) => [String(e.code).trim(), e.name] as [string, string])]);
}
