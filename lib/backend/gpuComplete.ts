import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readMusicToken } from './musicToken';
import { adminClient } from '@/lib/supabase/admin';
import { notifyAll } from './notify';

export type Kind = 'image' | 'music' | 'video';
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

const body = z.object({
  token: z.string().max(2000),
  event: z.enum(['scene', 'done', 'failed']).default('done'),
  files: z.array(z.object({ path: z.string().max(400), name: z.string().max(160), size: z.number().optional() })).max(50).optional(),
  step: z.number().optional(), total: z.number().optional(), error: z.string().max(500).optional(),
});
const MIME: Record<Kind, string> = { image: 'image/png', music: 'audio/mpeg', video: 'video/mp4' };
const SOURCE: Record<Kind, string> = { image: 'image', music: 'voice', video: 'video' };

async function register(db: SupabaseClient, uid: string, kind: Kind, parent: string | null, f: { path: string; name: string; size?: number }) {
  const have = await db.from('documents').select('id').eq('user_id', uid).eq('storage_path', f.path).maybeSingle();
  if (have.data) return;                                          // idempotent: deterministic names + retries never duplicate
  const dir = f.path.slice(0, f.path.lastIndexOf('/')), base = f.path.slice(f.path.lastIndexOf('/') + 1);
  const ls = await db.storage.from('documents').list(dir, { search: base, limit: 5 });
  const obj = ls.data?.find((o) => o.name === base);
  if (!obj) throw new Error(`${f.name} is not in Storage yet`);
  const ins = await db.from('documents').insert({ user_id: uid, parent_id: parent, kind: 'file', name: f.name, storage_path: f.path, mime: MIME[kind], size_bytes: Number((obj.metadata as { size?: number } | null)?.size ?? f.size ?? 0), source: SOURCE[kind] });
  if (ins.error) throw new Error(ins.error.message);
}

/** Shared /api/<engine>/complete: called by the GPU with the job's HMAC token (no session, no service key on the Pod). */
export async function handleComplete(kind: Kind, req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400, headers: CORS });
  const claims = readMusicToken(parsed.data.token);
  if (!claims) return NextResponse.json({ error: 'invalid or expired token' }, { status: 401, headers: CORS });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server.' }, { status: 503, headers: CORS });
  const { event, files = [], step, total, error } = parsed.data;
  const title = claims.t ?? claims.n;
  try {
    const list = kind === 'music' && event === 'done' && !files.length ? [{ path: claims.p, name: claims.n }] : files;   // music: one file, named in the token
    for (const f of list) {
      if (!f.path.startsWith(claims.p) || f.path.includes('..')) return NextResponse.json({ error: 'path not allowed for this job' }, { status: 403, headers: CORS });
      await register(admin, claims.u, kind, claims.f ?? null, f);
    }
    if (claims.j) await admin.from('gpu_jobs').update({ status: event === 'failed' ? 'failed' : event === 'done' ? 'done' : 'running', step: step ?? null, total: total ?? null, detail: error ?? null, updated_at: new Date().toISOString() }).eq('id', claims.j).eq('user_id', claims.u);
    if (event === 'done') {
      const msg = kind === 'image' ? `✅ Atom Edit: រូបភាព "${title}" (${total ?? files.length}/${total ?? files.length} Scenes) ចូលដេកក្នុង Document ហើយ! Pod បិទអូតូ។`
        : kind === 'music' ? `✅ Atom Edit: ចម្រៀង "${title}" ចូលដេកក្នុង Document ហើយ! Pod បិទអូតូ។` : `✅ Atom Edit: វីដេអូ "${title}" Render រួចរាល់ក្នុង Document ហើយ! Pod បិទអូតូ។`;
      await notifyAll(admin, claims.u, 'Atom Edit', msg, `job-${kind}`);
    } else if (event === 'failed') {
      await notifyAll(admin, claims.u, 'Atom Edit', `⚠️ Atom Edit: Job "${title}" ឈប់/មានបញ្ហាត្រង់ ${kind === 'image' ? 'Scene' : 'Step'} ${step ?? '?'} — ចុចពិនិត្យ។ ${error ?? ''}`.trim(), `job-${kind}-fail`);
    }
    return NextResponse.json({ ok: true }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500, headers: CORS }); }
}
