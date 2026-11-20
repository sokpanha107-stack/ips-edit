import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireUser } from '@/lib/backend/session';
import { makeMusicToken, musicTokenReady } from '@/lib/backend/musicToken';

export const dynamic = 'force-dynamic';
const body = z.object({ title: z.string().trim().min(1).max(100) });
const clean = (n: string) => n.replace(/\.mp4$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Video';

/** Timeline Render, step 1 (JSON only): signed upload URL for "<Title>.mp4" + 25-minute HMAC completion token (no service key on the Pod). */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  if (!musicTokenReady()) return NextResponse.json({ error: 'Set MUSIC_TOKEN_SECRET (or VAULT_ENCRYPTION_KEY) in Vercel env first.' }, { status: 503 });
  const { db, userId } = au.ctx;
  const name = `${clean(p.data.title)}.mp4`, jobId = randomUUID(), path = `${userId}/render/${jobId.slice(0, 8)}-${name}`;
  const up = await db.storage.from('documents').createSignedUploadUrl(path, { upsert: true });
  if (up.error || !up.data) return NextResponse.json({ error: up.error?.message ?? 'upload slot failed' }, { status: 500 });
  await db.from('gpu_jobs').insert({ id: jobId, user_id: userId, kind: 'video', title: name, status: 'queued' }).then(() => undefined, () => undefined);
  const token = makeMusicToken({ u: userId, p: path, n: name, t: name, j: jobId }, 25 * 60 + 300);
  return NextResponse.json({ ok: true, jobId, name, path, uploadUrl: up.data.signedUrl, token });
}
