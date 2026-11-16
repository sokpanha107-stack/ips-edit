'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './env';

let client: SupabaseClient | null = null;
/** Browser client (anon key + the user's own session). Passkeys are an experimental Supabase feature, so we opt in here. */
export function browserClient(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl(), supabaseAnonKey(), { auth: { experimental: { passkey: true } } } as never) as SupabaseClient;
  return client;
}
