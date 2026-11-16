/** Public Supabase settings (safe for the browser). These are the only keys the app needs in .env. */
export const supabaseUrl = () => (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
export const supabaseAnonKey = () => (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
export const supabaseConfigured = () => !!supabaseUrl() && !!supabaseAnonKey();
