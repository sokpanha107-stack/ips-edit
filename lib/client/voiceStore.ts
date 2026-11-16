/** Voice samples the user uploads. Kept on this device (IndexedDB) as real audio files, so nothing is invented and nothing leaves the phone until a job is sent. */
export interface VoiceMeta { id: string; name: string; type: string; seconds: number; size: number; createdAt: number }
const DB = 'ips-voices', STORE = 'voices';
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;   // sent inside the job request (Vercel body limit 4.5 MB)

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
type Row = VoiceMeta & { blob: Blob };

export async function listVoices(): Promise<VoiceMeta[]> {
  const rows = await run<Row[]>('readonly', (s) => s.getAll());
  return rows.map(({ blob, ...m }) => { void blob; return m; }).sort((a, b) => a.createdAt - b.createdAt);
}
export async function getVoiceBlob(id: string): Promise<Blob | null> { return (await run<Row | undefined>('readonly', (s) => s.get(id)))?.blob ?? null; }
export async function deleteVoices(ids: string[]) { for (const id of ids) await run('readwrite', (s) => s.delete(id)); }

export function audioSeconds(file: Blob): Promise<number> {
  return new Promise((res) => {
    const a = new Audio(); const url = URL.createObjectURL(file);
    a.preload = 'metadata'; a.src = url;
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Number.isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { URL.revokeObjectURL(url); res(0); };
  });
}
export async function addVoice(file: File, type: string): Promise<VoiceMeta> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) throw new Error('Choose an audio file (mp3, wav, m4a).');
  if (file.size > MAX_VOICE_BYTES) throw new Error('Voice sample is too big. Keep it under 3 MB (about 30 seconds).');
  const meta: VoiceMeta = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Voice', type, seconds: await audioSeconds(file), size: file.size, createdAt: Date.now() };
  await run('readwrite', (s) => s.put({ ...meta, blob: file }));
  return meta;
}
export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
export const fmtLen = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
