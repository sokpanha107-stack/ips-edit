import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireUser } from '@/lib/backend/session';
import { makeMusicToken, musicTokenReady } from '@/lib/backend/musicToken';

export const dynamic = 'force-dynamic';

const body = z.object({ filename: z.string().trim().min(1).max(100) });
const clean = (n: string) => n.replace(/\.mp3$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Song';

/**
 * Step 1 of the Music Engine: JSON only (no audio passes through Vercel).
 * Returns a short-lived Supabase Storage signed upload URL for "<uid>/music/<id>-<Title>.mp3" and a one-time completion token for the GPU worker.
 */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  if (!musicTokenReady()) return NextResponse.json({ error: 'Set MUSIC_TOKEN_SECRET (or VAULT_ENCRYPTION_KEY) in Vercel env first.' }, { status: 503 });
  const name = `${clean(parsed.data.filename)}.mp3`;
  const path = `${au.ctx.userId}/music/${randomUUID().slice(0, 8)}-${name}`;
  const up = await au.ctx.db.storage.from('documents').createSignedUploadUrl(path);
  if (up.error || !up.data) return NextResponse.json({ error: up.error?.message ?? 'Could not create an upload slot' }, { status: 500 });
  const token = makeMusicToken({ u: au.ctx.userId, p: path, n: name });
  return NextResponse.json({ ok: true, name, path, uploadUrl: up.data.signedUrl, token });
}
