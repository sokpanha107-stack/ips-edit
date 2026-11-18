import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { deleteCredential, endpointBase, listVault, recordStatus, saveCredential, SERVICES, testCredential } from '@/lib/backend/vault';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({
  service: z.enum(['runpod', 'voice_api', 'gemini']),
  key: z.string().trim().max(500).optional(),
  endpoint: z.string().trim().max(500).optional(),
});

/** Masked status only: the real key never leaves the server. */
export async function GET() {
  const au = await requireUser(); if ('res' in au) return au.res;
  try { return NextResponse.json({ services: await listVault(au.ctx.db) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}

/** "Save & Test Connection": encrypts + stores the key, then checks it live and returns 🟢/🔴. */
export async function PUT(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const { service, key, endpoint } = parsed.data;
  try {
    if (endpoint) endpointBase(endpoint);   // reject unsafe URLs before saving
    const cred = await saveCredential(au.ctx.db, au.ctx.userId, service, key, endpoint);
    const result = await testCredential(service, cred);
    await recordStatus(au.ctx.db, au.ctx.userId, service, result.ok);
    return NextResponse.json({ ok: result.ok, message: result.message, services: await listVault(au.ctx.db) });
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : 'failed' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const service = new URL(req.url).searchParams.get('service');
  if (!SERVICES.includes(service as never)) return NextResponse.json({ error: 'bad service' }, { status: 400 });
  try { await deleteCredential(au.ctx.db, au.ctx.userId, service as 'runpod'); return NextResponse.json({ ok: true, services: await listVault(au.ctx.db) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }); }
}
