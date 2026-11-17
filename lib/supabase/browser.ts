'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './env';

let real: SupabaseClient | null = null;
function create(): SupabaseClient {
  // Passkeys are an experimental Supabase feature, so we opt in here.
  real ??= createBrowserClient(supabaseUrl(), supabaseAnonKey(), { auth: { experimental: { passkey: true } } } as never) as SupabaseClient;
  return real;
}
/**
 * Browser client (anon key + the user's own session). Created lazily on first use, so a page can be
 * prerendered at build time even before the Supabase env vars exist (the real client is only needed in the browser).
 */
const lazy = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = create() as unknown as Record<PropertyKey, unknown>;
    const v = c[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});
export function browserClient(): SupabaseClient { return lazy; }
