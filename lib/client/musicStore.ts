/**
 * Background music tracks the user keeps. v2.4: Cloud-synced. The IndexedDB copy is only a LOCAL CACHE (iOS Safari may wipe it after ~7 days of inactivity);
 * the real copy lives in the user's private Supabase Storage folder `<uid>/music-library/` (owner-only RLS) with a small manifest.json.
 */
import { browserClient } from '@/lib/supabase/browser';
export interface MusicMeta { id: string; name: string; seconds: number; size: number; createdAt: number; ext?: string; /** where the audio is: both = cached + in the cloud */ where?: 'both' | 'local' | 'cloud' }
interface Manifest { tracks: { id: string; name: string; seconds: number; size: number; createdAt: number; ext: string }[] }
const BUCKET = 'documents';
let uidCache = '';
async function uid(): Promise<string> { if (uidCache) return uidCache; const { data } = await browserClient().auth.getUser(); uidCache = data.user?.id ?? ''; return uidCache; }
const extOf = (f: { name: string; type?: string }) => (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.exec(f.name)?.[1] ?? (f.type?.includes('wav') ? 'wav' : 'mp3')).toLowerCase();
async function readManifest(): Promise<Manifest | null> {
  try {
    const u = await uid(); if (!u) return null;
    const r = await browserClient().storage.from(BUCKET).download(`${u}/music-library/manifest.json`);
    if (r.error || !r.data) return r.error && /not.?found|does not exist|404/i.test(r.error.message) ? { tracks: [] } : r.error ? null : { tracks: [] };
    const j = JSON.parse(await r.data.text()) as Manifest; return Array.isArray(j.tracks) ? j : { tracks: [] };
  } catch { return null; }
}
async function writeManifest(m: Manifest): Promise<boolean> {
  try { const u = await uid(); if (!u) return false; return !(await browserClient().storage.from(BUCKET).upload(`${u}/music-library/manifest.json`, new Blob([JSON.stringify(m)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })).error; } catch { return false; }
}
/** Read-modify-write with verify: two devices writing at once could drop a track, so after writing we re-read and retry (max 4) until our change is really in the manifest. */
async function updateManifest(change: (m: Manifest) => Manifest, applied: (m: Manifest) => boolean): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    const cur = await readManifest(); if (!cur) return false;
    if (!(await writeManifest(change(cur)))) return false;
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    const chk = await readManifest(); if (chk && applied(chk)) return true;
  }
  return false;
}
async function pushTrack(meta: MusicMeta, blob: Blob): Promise<boolean> {
  try {
    const u = await uid(); if (!u) return false; const ext = meta.ext ?? 'mp3';
    const up = await browserClient().storage.from(BUCKET).upload(`${u}/music-library/${meta.id}.${ext}`, blob, { upsert: true, contentType: blob.type || 'audio/mpeg' });
    if (up.error) return false;
    const entry = { id: meta.id, name: meta.name, seconds: meta.seconds, size: meta.size, createdAt: meta.createdAt, ext };
    return updateManifest((m) => ({ ...m, tracks: [...m.tracks.filter((t) => t.id !== meta.id), entry] }), (m) => m.tracks.some((t) => t.id === meta.id));
  } catch { return false; }
}
const DB = 'ips-music', STORE = 'tracks';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise((res, rej) => { const rq = fn(db.transaction(STORE, mode).objectStore(STORE)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
};
type Row = MusicMeta & { blob: Blob };
const localRows = async () => (await run<Row[]>('readonly', (s) => s.getAll()).catch(() => [] as Row[]));
/** Local cache + cloud manifest, merged. A track missing locally (evicted by iOS, or added on another device) shows as cloud-only and is downloaded when played. */
export async function listMusic(): Promise<MusicMeta[]> {
  const rows = await localRows();
  const man = await readManifest();
  const cloud = new Map((man?.tracks ?? []).map((t) => [t.id, t]));
  const out: MusicMeta[] = rows.map(({ blob, ...m }) => { void blob; return { ...m, ext: m.ext ?? cloud.get(m.id)?.ext, where: man ? (cloud.has(m.id) ? 'both' : 'local') : undefined } as MusicMeta; });
  for (const t of Array.from(cloud.values())) if (!rows.some((r) => r.id === t.id)) out.push({ ...t, where: 'cloud' });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
/** Uploads local-only tracks (older ones, or ones added offline) to the cloud. Returns how many were uploaded. */
export async function syncMusic(): Promise<number> {
  const man = await readManifest(); if (!man) return 0;
  let n = 0;
  for (const r of await localRows()) {
    if (man.tracks.some((t) => t.id === r.id)) continue;
    const { blob, ...meta } = r;
    if (await pushTrack({ ...meta, ext: meta.ext ?? extOf({ name: meta.name, type: blob.type }) }, blob)) n += 1;
  }
  return n;
}
export async function getMusicBlob(id: string): Promise<Blob | null> {
  const row = await run<Row | undefined>('readonly', (s) => s.get(id));
  if (row?.blob) return row.blob;
  try {   // not in the local cache (iOS cleared it / another device): fetch from the private cloud copy and cache it again
    const man = await readManifest(); const t = man?.tracks.find((x) => x.id === id); const u = await uid(); if (!t || !u) return null;
    const r = await browserClient().storage.from(BUCKET).download(`${u}/music-library/${id}.${t.ext}`); if (r.error || !r.data) return null;
    await run('readwrite', (s) => s.put({ ...t, blob: r.data })).catch(() => undefined);
    return r.data;
  } catch { return null; }
}
export async function deleteMusic(ids: string[]) {
  for (const id of ids) await run('readwrite', (s) => s.delete(id)).catch(() => undefined);
  try {
    const u = await uid(); const man = await readManifest(); if (!u || !man) return;
    const gone = man.tracks.filter((t) => ids.includes(t.id));
    if (gone.length) await browserClient().storage.from(BUCKET).remove(gone.map((t) => `${u}/music-library/${t.id}.${t.ext}`));
    await updateManifest((m) => ({ ...m, tracks: m.tracks.filter((t) => !ids.includes(t.id)) }), (m) => !m.tracks.some((t) => ids.includes(t.id)));
  } catch { /* the local delete already happened; the cloud copy is removed on the next try */ }
}
export async function renameMusic(id: string, name: string) {
  const clean = name.trim().slice(0, 80);
  const row = await run<Row | undefined>('readonly', (s) => s.get(id));
  if (row) await run('readwrite', (s) => s.put({ ...row, name: clean || row.name }));
  const man = await readManifest(); if (man && clean) await updateManifest((m) => ({ ...m, tracks: m.tracks.map((t) => (t.id === id ? { ...t, name: clean } : t)) }), (m) => m.tracks.some((t) => t.id === id && t.name === clean));
}
const seconds = (file: Blob): Promise<number> => new Promise((res) => {
  const a = new Audio(); const url = URL.createObjectURL(file); a.preload = 'metadata'; a.src = url;
  a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Number.isFinite(a.duration) ? a.duration : 0); };
  a.onerror = () => { URL.revokeObjectURL(url); res(0); };
});
export async function addMusic(file: File): Promise<MusicMeta> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) throw new Error('Choose an audio file (mp3, wav, m4a).');
  const meta: MusicMeta = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Track', seconds: await seconds(file), size: file.size, createdAt: Date.now() };
  meta.ext = extOf(file);
  await run('readwrite', (s) => s.put({ ...meta, blob: file }));
  void pushTrack(meta, file);          // background cloud copy (owner-only); the local cache already works offline
  return meta;
}
