import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Google (and magic-link) sign-in lands here with ?code=…; we swap it for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const rawNext = url.searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
  if (code) {
    const { error } = await serverClient().auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=signin_failed', url.origin));
}
