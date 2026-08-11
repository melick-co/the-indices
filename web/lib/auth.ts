import { createClient } from './supabase-server';

export interface Profile {
  id: string; email: string | null; role: 'admin' | 'subscriber';
  display_name: string | null; alert_topics: string[] | null;
  alert_indices: boolean; alert_stories: boolean;
}

/** Current user's profile, or null when signed out. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (data) return data as Profile;

  // Trigger should have created the row; heal if it was missed.
  const { data: created } = await supabase.from('profiles')
    .upsert({ id: user.id, email: user.email ?? null }, { onConflict: 'id' })
    .select('*').single();
  return (created as Profile) ?? null;
}

export async function isAdmin(): Promise<boolean> {
  return (await getProfile())?.role === 'admin';
}
