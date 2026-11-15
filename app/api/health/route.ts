import { NextResponse } from 'next/server';
import { config } from '@/lib/backend/config';
import { getStore } from '@/lib/backend/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    storage: getStore().persistent ? 'supabase' : 'memory (data is lost on restart — set SUPABASE_* )',
    auth: config.accessKey() ? 'protected' : 'open (set IPS_ACCESS_KEY)',
    providers: { video: config.videoProvider(), voice: config.voiceProvider() },
    webhooks: config.publicBaseUrl().startsWith('https://') ? 'on' : 'off (polling only)',
    maxParallel: config.maxParallel(),
  });
}
