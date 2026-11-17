import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/supabase/env';

/** Who is calling and the database handle to use. For a user request `db` is bound to that user, so RLS isolates their rows. */
export interface Ctx { db: SupabaseClient; userId: string; accessToken?: string }

/** Verified user for an API route, or the 401 response to return. Never trusts anything except the Auth server's answer. */
export async function requireUser(): Promise<{ ctx: Ctx } | { res: NextResponse }> {
  if (!supabaseConfigured()) return { res: NextResponse.json({ error: 'Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).' }, { status: 503 }) };
  try {
    const db = serverClient();
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
    const accessToken = (await db.auth.getSession()).data.session?.access_token;
    return { ctx: { db, userId: data.user.id, accessToken } };
  } catch (e) {
    // Always answer with JSON so the screen can show the real reason instead of a bare "500".
    return { res: NextResponse.json({ error: `Auth check failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) };
  }
}
