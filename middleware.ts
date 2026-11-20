import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Locks the whole app. No session = no pages and no API.
 * Public: /login, /auth/*, provider webhooks (they carry their own secret token), /api/health.
 * Every API route ALSO re-checks the user itself (defense in depth), and the database enforces RLS.
 */
const PUBLIC = [/^\/login$/, /^\/auth\//, /^\/api\/webhooks\//, /^\/api\/health$/, /^\/api\/music\/complete$/];   // music/complete: the GPU worker calls it with a one-time HMAC token; the route verifies it (or a session) itself

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const isPublic = PUBLIC.some((r) => r.test(path));

  let res = NextResponse.next({ request: req });
  let user: { id: string } | null = null;
  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    user = (await supabase.auth.getUser()).data.user;   // verified with the Auth server, not just decoded
  }

  if (!user && !isPublic) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const to = req.nextUrl.clone();
    to.pathname = '/login'; to.search = path === '/' ? '' : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  if (user && path === '/login') { const to = req.nextUrl.clone(); to.pathname = '/'; to.search = ''; return NextResponse.redirect(to); }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icon.*|apple-touch-icon.*|.*\\.(?:png|jpg|jpeg|svg|webp|ico|json)$).*)'],
};
