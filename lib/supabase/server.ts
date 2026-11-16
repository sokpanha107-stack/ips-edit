import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from './env';

/** Supabase client that acts AS THE LOGGED-IN USER (reads the session cookie). Row Level Security applies to everything it does. */
export function serverClient() {
  const jar = cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* called from a Server Component: middleware refreshes the session */ } },
    },
  });
}
