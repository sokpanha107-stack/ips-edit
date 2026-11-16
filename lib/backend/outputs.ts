import { randomUUID } from 'crypto';
import type { Ctx } from './session';
import { publicHttpsUrl } from './endpoint';
import { notifyUser } from './push';
import { getStore } from './store';
import { deriveStatus, type Job } from './types';

export type OutputKind = 'image' | 'voice' | 'video';
export interface OutputItem { name: string; /** https URL of the worker's file, or storage://<path> inside this user's own folder */ url: string }

const MAX_BYTES = 150 * 1024 * 1024;
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
const TITLE: Record<OutputKind, string> = { image: '✅ Images Ready!', voice: '✅ Voice Generation Complete!', video: '✅ Video Render Complete!' };

async function fetchBytes(rawUrl: string): Promise<{ bytes: Buffer; mime: string }> {
  const url = publicHttpsUrl(rawUrl);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('file too large');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('file too large');
    return { bytes, mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0] };
  } finally { clearTimeout(t); }
}

/**
 * Groups a finished job's outputs into a NEW folder in the user's "Document" cloud storage, then pushes a notification to their devices.
 * Files are copied into Supabase Storage under "<uid>/<folderId>/…" (private bucket, RLS by folder).
 */
export async function fileOutputs(ctx: Ctx, input: { kind: OutputKind; title: string; items: OutputItem[] }) {
  const { db, userId } = ctx;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const folder = await db.from('documents').insert({ user_id: userId, kind: 'folder', name: safeName(`${input.title} · ${stamp}`), source: input.kind }).select('id').single();
  if (folder.error) throw new Error(folder.error.message);
  const folderId = folder.data.id as string;
  let saved = 0, failed = 0;

  const one = async (item: OutputItem, i: number) => {
    try {
      let path: string, mime: string, size: number;
      if (item.url.startsWith('storage://')) {
        path = item.url.slice('storage://'.length);
        if (!path.startsWith(`${userId}/`) || path.includes('..')) throw new Error('not your file');
        mime = path.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'; size = 0;
      } else {
        const { bytes, mime: m } = await fetchBytes(item.url);
        const ext = EXT[m] ? `.${EXT[m]}` : '';
        const base = safeName(item.name);
        path = `${userId}/${folderId}/${randomUUID().slice(0, 8)}-${base.includes('.') ? base : base + ext}`;
        const up = await db.storage.from('documents').upload(path, bytes, { contentType: m, upsert: false });
        if (up.error) throw new Error(up.error.message);
        mime = m; size = bytes.length;
      }
      const ins = await db.from('documents').insert({ user_id: userId, parent_id: folderId, kind: 'file', name: safeName(item.name), storage_path: path, mime, size_bytes: size, source: input.kind });
      if (ins.error) throw new Error(ins.error.message);
      saved += 1;
    } catch { failed += 1; }
    void i;
  };
  for (let i = 0; i < input.items.length; i += 3) await Promise.all(input.items.slice(i, i + 3).map((it, j) => one(it, i + j)));

  await notifyUser(db, userId, {
    title: TITLE[input.kind],
    body: failed ? `${saved} saved, ${failed} could not be copied. Open Document to see the folder.` : `${saved} file${saved === 1 ? '' : 's'} saved in Document → "${input.title}".`,
    url: '/?tab=documents', tag: `job-${input.kind}`,
  });
  return { folderId, saved, failed };
}

/** Called from the job engine when every scene has finished. Runs once per job (claimed atomically). */
export async function archiveFinished(ctx: Ctx, job: Job) {
  const status = deriveStatus(job);
  if (status !== 'completed' && status !== 'partial') return;
  const store = getStore(ctx.db, ctx.userId);
  if (!(await store.claimArchive(job))) return;
  const kind: OutputKind = job.engine === 'video' ? 'video' : 'voice';
  const items = job.scenes.filter((s) => s.status === 'done' && s.outputUrl).map((s) => ({
    name: `scene-${String(s.idx + 1).padStart(2, '0')}${kind === 'voice' ? '.mp3' : '.mp4'}`, url: s.outputUrl!,
  }));
  if (items.length) await fileOutputs(ctx, { kind, title: job.folder, items });
}
