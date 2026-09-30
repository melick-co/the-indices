'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSessionClient } from '@/lib/supabase-server';

export async function updatePreferences(prefs: {
  display_name: string; alert_topics: string[];
  alert_indices: boolean; alert_stories: boolean;
}) {
  const supabase = createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('profiles').update(prefs).eq('id', user.id);
  revalidatePath('/account');
}

export async function signOut() {
  const supabase = createSessionClient();
  await supabase.auth.signOut();
  redirect('/');
}
