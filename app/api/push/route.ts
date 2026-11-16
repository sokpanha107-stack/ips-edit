import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/backend/config';
import { pushConfigured } from '@/lib/backend/push';
import { requireUser } from '@/lib/backend/session';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const sub = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(100) }),
});

export async function GET() {
  const au = await requireUser(); if ('res' in au) return au.res;
  const { count } = await au.ctx.db.from('push_subscriptions').select('id', { count: 'exact', head: true });
  return NextResponse.json({ configured: pushConfigured(), publicKey: config.vapidPublic(), devices: count ?? 0 });
}

/** Saves this device's PushSubscription (VAPID payload) in push_subscriptions for the logged-in user. */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  const row = { user_id: au.ctx.userId, endpoint: parsed.data.endpoint, subscription: parsed.data, user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) };
  // A device belongs to whoever is signed in on it now: if the same browser was used by another account, hand the endpoint over.
  const db = adminClient() ?? au.ctx.db;
  const { error } = await db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  await au.ctx.db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', au.ctx.userId);
  return NextResponse.json({ ok: true });
}
