import { createSessionClient } from './supabase-server';

export interface Profile {
  id: string; email: string | null; role: 'admin' | 'subscriber';
  display_name: string | null; alert_topics: string[] | null;
  alert_indices: boolean; alert_stories: boolean;
}

/** Current user's profile, or null when signed out. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = createSessionClient();
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

/**
 * Throw unless the caller is a signed-in admin.
 * Server actions can be invoked from any route, so middleware alone does not
 * protect them: call this first in every admin action and route handler.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getProfile();
  if (profile?.role !== 'admin') throw new Error('Not authorised.');
  return profile;
}
