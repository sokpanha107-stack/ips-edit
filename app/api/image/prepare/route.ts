import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireUser } from '@/lib/backend/session';
import { makeMusicToken, musicTokenReady } from '@/lib/backend/musicToken';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const body = z.object({ folder: z.string().trim().min(1).max(100), scenes: z.number().int().min(1).max(2000), pad: z.number().int().min(2).max(4).default(3), folderId: z.string().uuid().optional(), from: z.number().int().min(0).max(5000).default(0) });

/**
 * Image Engine, step 1 (JSON only): creates the Document folder, a gpu_jobs row and one signed upload URL per scene
 * (deterministic "scene-001.png"), plus a 50-minute HMAC token so the GPU can register each file itself while the phone is locked.
 */
export async function POST(req: Request) {
  const au = await requireUser(); if ('res' in au) return au.res;
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  if (!musicTokenReady()) return NextResponse.json({ error: 'Set MUSIC_TOKEN_SECRET (or VAULT_ENCRYPTION_KEY) in Vercel env first.' }, { status: 503 });
  const { db, userId } = au.ctx; const { folder, scenes, pad, from } = p.data;
  let folderId = p.data.folderId ?? null;
  if (!folderId) {
    const f = await db.from('documents').insert({ user_id: userId, parent_id: null, kind: 'folder', name: folder, source: 'image' }).select('id').single();
    if (f.error) return NextResponse.json({ error: f.error.message }, { status: 500 });
    folderId = f.data.id as string;
  }
  const jobId = randomUUID();
  await db.from('gpu_jobs').insert({ id: jobId, user_id: userId, kind: 'image', title: folder, status: 'queued', total: scenes }).then(() => undefined, () => undefined);   // optional table (supabase/v2.4.sql)
  const prefix = `${userId}/image/${jobId.slice(0, 8)}/`;
  const slots: { index: number; name: string; uploadUrl: string; path: string }[] = [];
  for (let i = 0; i < scenes; i += 20) {
    await Promise.all(Array.from({ length: Math.min(20, scenes - i) }, async (_, k) => {
      const index = from + i + k + 1, name = `scene-${String(index).padStart(pad, '0')}.png`, path = `${prefix}${name}`;
      const up = await db.storage.from('documents').createSignedUploadUrl(path, { upsert: true });
      if (up.error || !up.data) throw new Error(up.error?.message ?? 'upload slot failed');
      slots[i + k] = { index, name, uploadUrl: up.data.signedUrl, path };
    })).catch((e) => { throw e; });
  }
  const token = makeMusicToken({ u: userId, p: prefix, n: folder, t: folder, f: folderId, j: jobId }, 50 * 60);
  return NextResponse.json({ ok: true, jobId, folderId, slots, token });
}
