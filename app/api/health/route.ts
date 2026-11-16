import { NextResponse } from 'next/server';
import { config } from '@/lib/backend/config';
import { pushConfigured } from '@/lib/backend/push';
import { supabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

/** Public, secret-free status: which parts of the server are configured. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    supabase: supabaseConfigured(),
    vault: config.vaultSecret().length >= 24,
    push: pushConfigured(),
    webhooks: config.publicBaseUrl().startsWith('https://'),
  });
}
