import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl } from './env';

let cached: SupabaseClient | null | undefined;
/**
 * Service-role client: bypasses RLS. Use ONLY where no user session exists (provider webhooks) and always filter by user_id yourself.
 * Never import this from client code.
 */
export function adminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  cached = supabaseUrl() && key ? createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return cached;
}
