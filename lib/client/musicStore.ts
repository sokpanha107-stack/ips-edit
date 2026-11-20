/** Background music tracks the user keeps. Stored on this device (IndexedDB) as real audio files. */
export interface MusicMeta { id: string; name: string; seconds: number; size: number; createdAt: number }
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
export async function listMusic(): Promise<MusicMeta[]> {
  const rows = await run<Row[]>('readonly', (s) => s.getAll());
  return rows.map(({ blob, ...m }) => { void blob; return m; }).sort((a, b) => b.createdAt - a.createdAt);
}
export async function getMusicBlob(id: string): Promise<Blob | null> { return (await run<Row | undefined>('readonly', (s) => s.get(id)))?.blob ?? null; }
export async function deleteMusic(ids: string[]) { for (const id of ids) await run('readwrite', (s) => s.delete(id)); }
export async function renameMusic(id: string, name: string) {
  const row = await run<Row | undefined>('readonly', (s) => s.get(id)); if (!row) return;
  await run('readwrite', (s) => s.put({ ...row, name: name.trim().slice(0, 80) || row.name }));
}
const seconds = (file: Blob): Promise<number> => new Promise((res) => {
  const a = new Audio(); const url = URL.createObjectURL(file); a.preload = 'metadata'; a.src = url;
  a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Number.isFinite(a.duration) ? a.duration : 0); };
  a.onerror = () => { URL.revokeObjectURL(url); res(0); };
});
export async function addMusic(file: File): Promise<MusicMeta> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) throw new Error('Choose an audio file (mp3, wav, m4a).');
  const meta: MusicMeta = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Track', seconds: await seconds(file), size: file.size, createdAt: Date.now() };
  await run('readwrite', (s) => s.put({ ...meta, blob: file }));
  return meta;
}
