import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/backend/session';
import { getCredential, endpointBase } from '@/lib/backend/vault';
import { mintGpuToken } from '@/lib/backend/gpuToken';

export const dynamic = 'force-dynamic';

/** The browser talks to the Atom GPU directly (big files cannot pass Vercel) with a 1-hour HMAC token. The stored key is never returned. */
export async function POST() {
  const au = await requireUser(); if ('res' in au) return au.res;
  const cred = await getCredential(au.ctx.db, au.ctx.userId, 'gpu').catch(() => null);
  if (!cred?.key || !cred.endpoint) return NextResponse.json({ ok: false, configured: false });
  const { token, exp } = mintGpuToken(cred.key, au.ctx.userId);
  return NextResponse.json({ ok: true, configured: true, base: endpointBase(cred.endpoint), token, exp });
}
