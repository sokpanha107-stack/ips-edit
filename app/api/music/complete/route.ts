import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireUser } from '@/lib/backend/session';
import { readMusicToken } from '@/lib/backend/musicToken';
import { adminClient } from '@/lib/supabase/admin';
import { handleComplete } from '@/lib/backend/gpuComplete';

export const dynamic = 'force-dynamic';

const body = z.object({ token: z.string().max(2000).optional(), path: z.string().max(400).optional(), name: z.string().max(120).optional(), duration_sec: z.number().optional() });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });

/** Registers the finished .mp3 (already in Storage) as a file in Document. Idempotent: the same path is never inserted twice. */
async function register(db: SupabaseClient, userId: string, path: string, name: string) {
  const dir = path.slice(0, path.lastIndexOf('/')), base = path.slice(path.lastIndexOf('/') + 1);
  const ls = await db.storage.from('documents').list(dir, { search: base, limit: 5 });
  const obj = ls.data?.find((o) => o.name === base);
  if (!obj) return { status: 404, error: 'The .mp3 is not in Storage yet.' };
  const have = await db.from('documents').select('id').eq('user_id', userId).eq('storage_path', path).maybeSingle();
  if (have.data) return { status: 200, id: have.data.id as string, already: true };
  const ins = await db.from('documents').insert({ user_id: userId, parent_id: null, kind: 'file', name, storage_path: path, mime: 'audio/mpeg', size_bytes: Number((obj.metadata as { size?: number } | null)?.size ?? 0), source: 'voice' }).select('id').single();
  if (ins.error) return { status: 500, error: ins.error.message };
  return { status: 200, id: ins.data.id as string };
}

/** Called by the RunPod worker (one-time HMAC token, no session) or by the signed-in browser (fallback upload). */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  if (raw && typeof raw === 'object' && 'token' in raw && ('event' in raw || !('path' in raw))) return handleComplete('music', new Request(req.url, { method: 'POST', body: JSON.stringify(raw) }));
  const parsed = body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400, headers: CORS });
  const { token, path, name } = parsed.data;
  if (token) {
    const claims = readMusicToken(token);
    if (!claims) return NextResponse.json({ error: 'invalid or expired token' }, { status: 401, headers: CORS });
    const admin = adminClient();
    if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 503, headers: CORS });
    const r = await register(admin, claims.u, claims.p, claims.n);
    return NextResponse.json(r.error ? { error: r.error } : { ok: true, id: r.id }, { status: r.status, headers: CORS });
  }
  const au = await requireUser(); if ('res' in au) return au.res;
  if (!path || !name || !path.startsWith(`${au.ctx.userId}/music/`) || path.includes('..')) return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  const r = await register(au.ctx.db, au.ctx.userId, path, name);
  return NextResponse.json(r.error ? { error: r.error } : { ok: true, id: r.id }, { status: r.status });
}
